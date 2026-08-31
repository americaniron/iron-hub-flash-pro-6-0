
import { CustomerAccount, SavedQuote, InvoiceData, Payment, RecurringInvoice, InvoiceTemplate, InventoryPart } from '../types.ts';
import { hubApiFetch } from './hubApi.ts';

/**
 * Enterprise Cloud Repository Service — V2 (Server-Backed)
 *
 * PRIMARY: Cloudflare D1 database via /api/data endpoints (permanent, cross-device)
 * FALLBACK: IndexedDB for offline/iframe scenarios where server is unreachable
 *
 * On every read: tries server first, falls back to IndexedDB cache
 * On every write: writes to server first, then mirrors to IndexedDB cache
 * On startup: checks server availability and migrates any local-only data up
 */

const API_BASE = '/api/data';
const API_STATUS = '/api/data-status';
const DELAY = 0; // No artificial delay needed — server latency is real
const DB_NAME = 'AmericanIronHubDB_V1';
const DB_VERSION = 3;
const STORE_NAMES = ['accounts', 'quotes', 'invoices', 'payments', 'credits', 'drafts', 'recurring_invoices', 'templates', 'parts_image_pool', 'inventory'];
const INTERNAL_STORE_NAMES = [...STORE_NAMES, 'sync_outbox'];
const CANONICAL_STORES = new Set(['accounts', 'quotes', 'invoices', 'payments', 'inventory']);
const CANONICAL_SYNC_BATCH_SIZE = 50;

// The canonical Suite inventory endpoint only accepts https:// or Suite asset
// URLs in imageUrl and rejects the ENTIRE batch otherwise (HTTP 422:
// "Every item imageUrl must be an HTTPS URL or a Suite asset URL"). PDF-extracted
// and AI-generated images are base64 data: URLs, so they must never be sent to
// the server for the inventory store. They remain in the local cache and in the
// parts_image_pool store, which does accept base64 payloads.
const HTTPS_URL_PATTERN = /^https:\/\//i;

export function sanitizeInventoryForServer(parts: InventoryPart[]): Array<Omit<InventoryPart, 'originalImages'>> {
  return parts.map((part) => {
    const { originalImages: _dropped, ...rest } = part;
    const clean: Omit<InventoryPart, 'originalImages'> = { ...rest };
    if (typeof clean.imageUrl === 'string' && !HTTPS_URL_PATTERN.test(clean.imageUrl)) {
      delete clean.imageUrl;
    }
    return clean;
  });
}

const poolKeyFor = (partNo: string, description: string): string =>
  `${partNo}_${description}`.replace(/[^a-zA-Z0-9_]/g, '_');

/**
 * The part-number half of a pool key, with its separator.
 *
 * Images were addressed by part number AND description, so ANY edit to a description orphaned
 * every image already stored for that part — the app then silently regenerated them, and a quote
 * that had pictures a moment ago came back bare. Cleaning supplier metadata out of descriptions
 * did exactly that to the whole pool at once.
 *
 * A part number identifies the part. The description is volatile text about it, and must not
 * decide whether a cached image can be found. The trailing separator keeps 524-5565 from matching
 * 524-55651.
 */
const poolPartPrefix = (partNo: string): string =>
  `${partNo}_`.replace(/[^a-zA-Z0-9_]/g, '_');

const findPooledImage = (
  pool: Record<string, string>,
  partNo: string,
  description: string,
): string | null => {
  const exact = pool[poolKeyFor(partNo, description)];
  if (exact) return exact;
  if (!partNo.trim()) return null;
  const prefix = poolPartPrefix(partNo);
  for (const key of Object.keys(pool)) {
    if (key.startsWith(prefix) && pool[key]) return pool[key];
  }
  return null;
};

export type CloudWriteResult = {
  synced: boolean;
  cached: boolean;
};

export type DataImportResult = {
  synced: boolean;
  cached: boolean;
  unsynchronizedStores: string[];
  failedStores: string[];
};

type PendingCanonicalWrites = Partial<Record<string, unknown>>;

// ---- Server availability state ----
let serverAvailable: boolean | null = null; // null = not checked yet
let lastServerCheck = 0;
const SERVER_CHECK_INTERVAL = 30000; // Re-check every 30s if server was down

async function checkServerAvailability(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && serverAvailable !== null && (now - lastServerCheck) < SERVER_CHECK_INTERVAL) {
    return serverAvailable;
  }

  try {
    const res = await hubApiFetch(API_STATUS, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const json = await res.json();
      serverAvailable = json.serverStorage === true;
    } else {
      serverAvailable = false;
    }
  } catch {
    serverAvailable = false;
  }
  lastServerCheck = now;
  return serverAvailable;
}

// ---- Server API helpers ----
async function serverGet<T>(username: string, store: string): Promise<T | null> {
  try {
    const res = await hubApiFetch(`${API_BASE}?username=${encodeURIComponent(username)}&store=${encodeURIComponent(store)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.success ? json.data : null;
  } catch {
    return null;
  }
}

async function serverSet(username: string, store: string, data: any): Promise<boolean> {
  // Canonical Suite resources are upserts only. An empty collection cannot
  // safely imply deletion, so report it as unsynchronized instead of lying.
  if (CANONICAL_STORES.has(store) && Array.isArray(data) && data.length === 0) {
    return false;
  }
  const payload = store === 'inventory' && Array.isArray(data)
    ? sanitizeInventoryForServer(data as InventoryPart[])
    : data;
  const batches = CANONICAL_STORES.has(store) && Array.isArray(payload)
    ? Array.from({ length: Math.ceil(payload.length / CANONICAL_SYNC_BATCH_SIZE) }, (_, index) => payload.slice(index * CANONICAL_SYNC_BATCH_SIZE, (index + 1) * CANONICAL_SYNC_BATCH_SIZE))
    : [payload];

  let allDelivered = true;
  for (const batch of batches) {
    let delivered = false;
    let rejectedByValidation = false;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let rateLimited = false;
      try {
        const res = await hubApiFetch(API_BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, store, data: batch }),
          signal: AbortSignal.timeout(30000),
        });
        if (res.ok) {
          delivered = true;
          break;
        }
        if (res.status === 409 || res.status === 422) {
          // Permanent validation rejection — retrying the same payload cannot
          // succeed, and one bad batch must not block the batches after it
          // (that is how newly indexed parts were silently lost).
          rejectedByValidation = true;
          break;
        }
        if (res.status === 429) {
          // The Suite Worker rate-limits hub synchronization per 15-minute
          // window. Verified live: bulk saves returned 429 "Too many iron hub
          // synchronization requests", which the old code treated as a permanent
          // failure — that is what blocked invoice creation with a selected
          // customer. Back off and retry before giving up.
          rateLimited = true;
        } else if (res.status < 500) {
          return false;
        }
      } catch {
        // Retry transient network and Worker failures before using local fallback.
      }
      await new Promise((resolve) => setTimeout(resolve, (rateLimited ? 1500 : 300) * (attempt + 1)));
    }
    if (rejectedByValidation) {
      allDelivered = false;
      continue;
    }
    if (!delivered) return false;
  }
  return allDelivered;
}

async function serverGetAll(username: string): Promise<Record<string, any> | null> {
  try {
    const res = await hubApiFetch(`${API_BASE}?username=${encodeURIComponent(username)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.success ? json.data : null;
  } catch {
    return null;
  }
}

// ---- IndexedDB (local cache / fallback) ----
let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject('IndexedDB not supported');
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        db.onclose = () => { dbPromise = null; };
        resolve(db);
      };
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        INTERNAL_STORE_NAMES.forEach(storeName => {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: 'username' });
          }
        });
      };
    });
  }
  return dbPromise;
}

async function localGet<T>(storeName: string, username: string): Promise<T | null> {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(username);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
    });
  } catch {
    return null;
  }
}

async function localSet<T>(storeName: string, username: string, data: T): Promise<boolean> {
  try {
    const db = await getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put({ username, data });
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve();
    });
    return true;
  } catch {
    return false;
  }
}

async function pendingCanonicalWrites(username: string): Promise<PendingCanonicalWrites> {
  const pending = await localGet<PendingCanonicalWrites>('sync_outbox', username);
  return pending && typeof pending === 'object' && !Array.isArray(pending) ? pending : {};
}

async function rememberPendingCanonicalWrite(username: string, storeName: string, data: unknown): Promise<void> {
  if (!CANONICAL_STORES.has(storeName) || !Array.isArray(data) || data.length === 0) return;
  const pending = await pendingCanonicalWrites(username);
  pending[storeName] = data;
  await localSet('sync_outbox', username, pending);
}

async function clearPendingCanonicalWrite(username: string, storeName: string): Promise<void> {
  const pending = await pendingCanonicalWrites(username);
  if (!(storeName in pending)) return;
  delete pending[storeName];
  await localSet('sync_outbox', username, pending);
}

async function flushPendingCanonicalWrites(username: string): Promise<void> {
  const pending = await pendingCanonicalWrites(username);
  for (const storeName of CANONICAL_STORES) {
    const data = pending[storeName];
    if (!Array.isArray(data) || data.length === 0) continue;
    if (await serverSet(username, storeName, data)) {
      delete pending[storeName];
    }
  }
  await localSet('sync_outbox', username, pending);
}

// ---- Helpers to detect default/empty values ----
const D1_MAX_STORE_SIZE = 900_000; // ~900KB safe limit for D1 row values

function isEmptyDefault(storeName: string, data: any): boolean {
  if (data === null || data === undefined) return true;
  if (storeName === 'credits' && data === 1000) return true;
  if (storeName === 'drafts' && data === null) return true;
  if (Array.isArray(data) && data.length === 0) return true;
  if (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0) return true;
  return false;
}

// ---- Canonical merge ------------------------------------------------------
//
// A canonical read used to REPLACE the local cache with whatever the server returned. Three
// things made that lossy:
//   * the Suite capped a canonical document read at 100 rows, so document 101 onwards vanished
//     from this app the moment it read them back;
//   * the projection back into hub shape is narrower than what is held locally, so a record that
//     round-tripped came back thinner than it went out;
//   * a record that had been written locally but rejected by the server was simply gone.
//
// Reads now merge. Nothing local is ever deleted by a read; a record the server has not got is
// kept and queued to be pushed again.

type CanonicalRecord = Record<string, unknown> & { id?: unknown };

function recordKey(record: unknown): string {
  if (!record || typeof record !== 'object') return '';
  const value = (record as CanonicalRecord).id;
  return value === undefined || value === null ? '' : String(value);
}

function recordMtime(record: unknown): number {
  if (!record || typeof record !== 'object') return 0;
  const source = record as Record<string, unknown>;
  for (const field of ['updatedAt', 'timestamp', 'date']) {
    const parsed = Date.parse(String(source[field] ?? ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export type CanonicalMergeResult<T> = {
  records: T[];
  /** Records this browser holds that the server did not return — never dropped, always re-queued. */
  localOnly: T[];
};

export function mergeCanonicalRecords<T>(serverRecords: unknown, localRecords: unknown): CanonicalMergeResult<T> {
  const server = Array.isArray(serverRecords) ? serverRecords : [];
  const local = Array.isArray(localRecords) ? localRecords : [];
  const merged = new Map<string, unknown>();
  const order: string[] = [];

  const remember = (record: unknown, key: string) => {
    if (!merged.has(key)) order.push(key);
    merged.set(key, record);
  };

  for (const record of server) {
    const key = recordKey(record);
    if (key) remember(record, key);
  }

  const localOnly: unknown[] = [];
  for (const record of local) {
    const key = recordKey(record);
    if (!key) continue;
    const existing = merged.get(key);
    if (existing === undefined) {
      // The server has never seen this one, or no longer returns it. Keep it and push it again.
      remember(record, key);
      localOnly.push(record);
      continue;
    }
    // Last write wins on the record's own mtime. A tie keeps the server copy, which is the one
    // the rest of the organization can see.
    if (recordMtime(record) > recordMtime(existing)) remember(record, key);
  }

  return {
    records: order.map((key) => merged.get(key)) as T[],
    localOnly: localOnly as T[],
  };
}

async function getCanonicalData<T>(storeName: string, username: string, defaultVal: T): Promise<T> {
  const localData = await localGet<unknown>(storeName, username);
  const pending = await pendingCanonicalWrites(username);
  const pendingRecords = Array.isArray(pending[storeName]) ? (pending[storeName] as unknown[]) : [];
  const isUp = await checkServerAvailability();

  // Offline, or the server errored: this browser's own copy plus anything still queued IS the
  // truth. Returning the queue alone — which is what this used to do — hid every record that had
  // already been confirmed.
  const localTruth = () => {
    const merged = mergeCanonicalRecords<unknown>(localData, pendingRecords);
    return (merged.records.length > 0 ? merged.records : localData ?? defaultVal) as T;
  };

  if (!isUp) return localTruth();

  const serverData = await serverGet<unknown>(username, storeName);
  if (serverData === null) {
    // The read failed. A failed read must never look like an empty organization.
    if (localData !== null || pendingRecords.length > 0) {
      void serverSet(username, storeName, localTruth());
      return localTruth();
    }
    return defaultVal;
  }

  const withLocal = mergeCanonicalRecords<unknown>(serverData, localData);
  const withPending = mergeCanonicalRecords<unknown>(withLocal.records, pendingRecords);
  const records = withPending.records;
  // Anything the server did not return is still owed to it. Queue exactly those, push them, and
  // clear the queue only when the push is confirmed.
  const unsent = [...withLocal.localOnly, ...withPending.localOnly];
  await localSet(storeName, username, records);
  if (unsent.length > 0) {
    await rememberPendingCanonicalWrite(username, storeName, unsent);
    void serverSet(username, storeName, unsent).then(async (synced) => {
      if (synced) await clearPendingCanonicalWrite(username, storeName);
    });
  } else if (pendingRecords.length > 0) {
    // Everything queued has come back from the server; the queue is genuinely empty.
    await clearPendingCanonicalWrite(username, storeName);
  }
  return records as unknown as T;
}

// ---- Unified read/write: server-first, local-fallback ----
async function getData<T>(storeName: string, username: string, defaultVal: T): Promise<T> {
  if (CANONICAL_STORES.has(storeName)) return getCanonicalData<T>(storeName, username, defaultVal);
  const isUp = await checkServerAvailability();

  if (isUp) {
    const serverData = await serverGet<T>(username, storeName);
    if (serverData !== null) {
      if (isEmptyDefault(storeName, serverData)) {
        const localData = await localGet<T>(storeName, username);
        if (localData !== null && !isEmptyDefault(storeName, localData)) {
          // Local has real data that the server does not — use local and push it up.
          void serverSet(username, storeName, localData);
          return localData;
        }
      }
      void localSet(storeName, username, serverData);
      return serverData;
    }
  }

  const localData = await localGet<T>(storeName, username);
  if (localData !== null) {
    if (isUp) void serverSet(username, storeName, localData);
    return localData;
  }

  return defaultVal;
}

/**
 * Stamp `updatedAt` on canonical records whose content actually changed.
 *
 * The Suite decides a sync conflict by comparing mtimes, so a record that is edited here without
 * a fresh mtime looks older than the Suite's copy and its edit gets refused. Comparing against
 * the cached copy means an unchanged record keeps its original mtime and does not masquerade as
 * a fresh edit every time the store is rewritten.
 */
function stampCanonicalMtimes(records: unknown, cached: unknown): unknown {
  if (!Array.isArray(records)) return records;
  const previous = new Map<string, unknown>();
  if (Array.isArray(cached)) {
    for (const record of cached) {
      const key = recordKey(record);
      if (key) previous.set(key, record);
    }
  }
  const now = new Date().toISOString();
  return records.map((record) => {
    if (!record || typeof record !== 'object') return record;
    const key = recordKey(record);
    const before = key ? previous.get(key) : undefined;
    const withoutMtime = (value: unknown) => {
      if (!value || typeof value !== 'object') return value;
      const { updatedAt: _ignored, ...rest } = value as Record<string, unknown>;
      return rest;
    };
    const unchanged = before !== undefined && JSON.stringify(withoutMtime(before)) === JSON.stringify(withoutMtime(record));
    const existingMtime = (record as Record<string, unknown>).updatedAt;
    if (unchanged && typeof existingMtime === 'string' && existingMtime) return record;
    if (unchanged) {
      const inherited = (before as Record<string, unknown> | undefined)?.updatedAt;
      return { ...(record as Record<string, unknown>), updatedAt: typeof inherited === 'string' && inherited ? inherited : now };
    }
    return { ...(record as Record<string, unknown>), updatedAt: now };
  });
}

async function setData<T>(storeName: string, username: string, data: T): Promise<CloudWriteResult> {
  const canonical = CANONICAL_STORES.has(storeName);
  if (canonical) {
    const cached = await localGet<unknown>(storeName, username);
    data = stampCanonicalMtimes(data, cached) as T;
  }
  const isUp = await checkServerAvailability(canonical);

  if (isUp) {
    // Server handles chunking for large data — always try server first
    const ok = await serverSet(username, storeName, data);
    const cached = await localSet(storeName, username, data);
    if (canonical) {
      if (ok) await clearPendingCanonicalWrite(username, storeName);
      else await rememberPendingCanonicalWrite(username, storeName, data);
    }
    return { synced: ok, cached };
  }

  // The cache can keep the user productive, but it is not a Suite sync.
  const cached = await localSet(storeName, username, data);
  if (canonical) await rememberPendingCanonicalWrite(username, storeName, data);
  return { synced: false, cached };
}

// ---- Migration: push local IndexedDB data to server on first connect ----
let migrationDone = new Set<string>();

async function migrateLocalToServer(username: string): Promise<void> {
  if (migrationDone.has(username)) return;

  const isUp = await checkServerAvailability();
  if (!isUp) return;

  try {
    // Check each store individually: if server is empty but local has data, push it up
    const serverData = await serverGetAll(username);

    for (const store of STORE_NAMES) {
      // Canonical Suite stores are server-owned. Pending writes are flushed
      // separately; never resurrect an old browser copy into a live tenant
      // just because the authoritative collection is currently empty.
      if (CANONICAL_STORES.has(store)) continue;
      const sData = serverData ? serverData[store] : null;
      const serverHasData = sData !== null && !isEmptyDefault(store, sData);

      if (serverHasData) continue; // Server already has this store — skip

      // Server is empty for this store — check if local has data
      const localData = await localGet(store, username);
      if (localData === null || isEmptyDefault(store, localData)) continue;

      // Local has data that server doesn't — push it up.
      await serverSet(username, store, localData);
    }

    migrationDone.add(username);
  } catch {
    // A later initialize call retries migration after a transient failure.
  }
}


// ========================================================
// PUBLIC API — same interface as before, now server-backed
// ========================================================

export const dbService = {
  // ---- Initialization: call this after login ----
  async initialize(username: string): Promise<{ serverConnected: boolean }> {
    const isUp = await checkServerAvailability();
    if (isUp) {
      await flushPendingCanonicalWrites(username);
      await migrateLocalToServer(username);
    }
    return { serverConnected: isUp };
  },

  // Re-check before an event-driven or scheduled reconciliation. The normal
  // availability cache avoids excess network traffic during routine reads;
  // this explicit path lets a recovered Worker be used immediately.
  async refreshConnection(username: string): Promise<{ serverConnected: boolean }> {
    const isUp = await checkServerAvailability(true);
    if (isUp) await flushPendingCanonicalWrites(username);
    return { serverConnected: isUp };
  },

  // --- Customer Account Operations ---
  async getCustomerAccounts(username: string): Promise<CustomerAccount[]> {
    return getData<CustomerAccount[]>('accounts', username, []);
  },

  async saveCustomerAccounts(username: string, accounts: CustomerAccount[]): Promise<CloudWriteResult> {
    return setData('accounts', username, accounts);
  },

  /**
   * Upsert a single customer account. The canonical Suite endpoint is
   * upsert-based, so syncing one changed record costs 1 request instead of the
   * whole collection (3+ batches) — which matters because the Worker
   * rate-limits hub writes per 15-minute window (verified live: bulk account
   * saves returned HTTP 429 and blocked invoice creation). The full collection
   * is still cached locally, and queued for a later full sync only on failure.
   */
  async upsertCustomerAccount(username: string, account: CustomerAccount, allAccounts: CustomerAccount[]): Promise<CloudWriteResult> {
    const isUp = await checkServerAvailability(true);
    const cached = await localSet('accounts', username, allAccounts);
    if (!isUp) {
      await rememberPendingCanonicalWrite(username, 'accounts', allAccounts);
      return { synced: false, cached };
    }
    const synced = await serverSet(username, 'accounts', [account]);
    if (!synced) await rememberPendingCanonicalWrite(username, 'accounts', allAccounts);
    return { synced, cached };
  },

  // --- Quote Archive Operations ---
  async getQuotes(username: string): Promise<SavedQuote[]> {
    return getData<SavedQuote[]>('quotes', username, []);
  },

  async saveQuote(username: string, quote: Omit<SavedQuote, 'id' | 'timestamp' | 'author'>): Promise<{ quote: SavedQuote; sync: CloudWriteResult }> {
    const quotes = await this.getQuotes(username);
    const newQuote: SavedQuote = {
      ...quote,
      id: `SQ-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
      timestamp: new Date().toISOString(),
      author: username
    };
    quotes.unshift(newQuote);
    // This used to write `quotes.slice(0, 100)`. Saving the 101st quote therefore deleted the
    // oldest one from this browser AND from the payload sent to the Suite — the archive silently
    // capped itself and the dropped quote was gone from both sides.
    const sync = await setData('quotes', username, quotes);
    return { quote: newQuote, sync };
  },

  async saveAllQuotes(username: string, quotes: SavedQuote[]): Promise<CloudWriteResult> {
    return setData('quotes', username, quotes);
  },

  async deleteQuote(username: string, quoteId: string): Promise<CloudWriteResult> {
    const quotes = await this.getQuotes(username);
    const filtered = quotes.filter(q => q.id !== quoteId);
    return setData('quotes', username, filtered);
  },

  // --- Invoice & Payment Operations ---
  async getInvoices(username: string): Promise<InvoiceData[]> {
    return getData<InvoiceData[]>('invoices', username, []);
  },

  async saveInvoices(username: string, invoices: InvoiceData[]): Promise<CloudWriteResult> {
    return setData('invoices', username, invoices);
  },

  async getPayments(username: string): Promise<Payment[]> {
    return getData<Payment[]>('payments', username, []);
  },

  async savePayments(username: string, payments: Payment[]): Promise<CloudWriteResult> {
    return setData('payments', username, payments);
  },

  // --- Recurring Invoices ---
  async getRecurringInvoices(username: string): Promise<RecurringInvoice[]> {
    return getData<RecurringInvoice[]>('recurring_invoices', username, []);
  },

  async saveRecurringInvoices(username: string, recurring: RecurringInvoice[]): Promise<CloudWriteResult> {
    return setData('recurring_invoices', username, recurring);
  },

  // --- Invoice Templates ---
  async getTemplates(username: string): Promise<InvoiceTemplate[]> {
    return getData<InvoiceTemplate[]>('templates', username, []);
  },

  async saveTemplates(username: string, templates: InvoiceTemplate[]): Promise<CloudWriteResult> {
    return setData('templates', username, templates);
  },

  // --- Draft Persistence ---
  async getDraft(username: string): Promise<any | null> {
    return getData<any>('drafts', username, null);
  },

  async saveDraft(username: string, data: any): Promise<CloudWriteResult> {
    return setData('drafts', username, data);
  },

  // --- Billing & Resource Control ---
  async getUserCredits(username: string): Promise<number> {
    return getData<number>('credits', username, 1000);
  },

  async deductCredits(username: string, amount: number): Promise<number> {
    const current = await this.getUserCredits(username);
    const updated = Math.max(0, current - amount);
    await setData('credits', username, updated);
    return updated;
  },

  // --- Data Portability ---
  async exportAllUserData(username: string): Promise<Record<string, any>> {
    const isUp = await checkServerAvailability();
    const exportedData: Record<string, any> = {};

    // Merge server + local to get complete picture (large stores live locally only)
    let serverData: Record<string, any> | null = null;
    if (isUp) {
      serverData = await serverGetAll(username);
    }

    for (const storeName of STORE_NAMES) {
      // Check server first
      const sData = serverData ? serverData[storeName] : null;
      // Check local
      const lData = await localGet(storeName, username);

      // Use whichever has real (non-empty) data; prefer local for large stores
      if (lData !== null && !isEmptyDefault(storeName, lData)) {
        exportedData[storeName] = lData;
      } else if (sData !== null && !isEmptyDefault(storeName, sData)) {
        exportedData[storeName] = sData;
      } else {
        // Both empty — use default
        if (storeName === 'credits') exportedData[storeName] = 1000;
        else if (storeName === 'drafts') exportedData[storeName] = null;
        else if (storeName === 'parts_image_pool') exportedData[storeName] = {};
        else exportedData[storeName] = [];
      }
    }
    return exportedData;
  },

  async markCanonicalStoresSynchronized(username: string, stores: string[]): Promise<void> {
    for (const storeName of stores) {
      if (CANONICAL_STORES.has(storeName)) await clearPendingCanonicalWrite(username, storeName);
    }
  },

  async importAllUserData(username: string, data: Record<string, any>): Promise<DataImportResult> {
    const unsynchronizedStores: string[] = [];
    const failedStores: string[] = [];

    // Import store-by-store so every canonical write retains its retry outbox.
    for (const [store, storeData] of Object.entries(data)) {
      if (!STORE_NAMES.includes(store)) continue;
      const result = await setData(store, username, storeData);
      if (!result.synced) unsynchronizedStores.push(store);
      if (!result.cached) failedStores.push(store);
    }

    return {
      synced: unsynchronizedStores.length === 0,
      cached: failedStores.length === 0,
      unsynchronizedStores,
      failedStores,
    };
  },

  // --- Inventory Operations ---
  async getInventory(username: string): Promise<InventoryPart[]> {
    const parts = await getData<InventoryPart[]>('inventory', username, []);
    if (parts.length === 0 || parts.every(p => p.imageUrl)) return parts;
    // The canonical server store strips base64 image fields, so parts coming
    // back from the server have no photos. Rehydrate them from the
    // parts_image_pool, which persists base64 images server-side.
    try {
      const pool = await this.getPartsImagePool(username);
      if (pool && Object.keys(pool).length > 0) {
        return parts.map(part => {
          if (part.imageUrl) return part;
          const pooled = findPooledImage(pool, part.partNo, part.description);
          return pooled ? { ...part, imageUrl: pooled } : part;
        });
      }
    } catch {
      // Hydration is cosmetic — never let it break inventory reads.
    }
    return parts;
  },

  async saveInventory(username: string, inventory: InventoryPart[]): Promise<CloudWriteResult> {
    return setData('inventory', username, inventory);
  },

  async addOrUpdateInventoryParts(username: string, newParts: InventoryPart[]): Promise<CloudWriteResult> {
    if (newParts.length === 0) return { synced: true, cached: true };
    const currentInventory = await this.getInventory(username);
    const inventoryMap = new Map(currentInventory.map(p => [p.partNo, p]));

    for (const part of newParts) {
      if (inventoryMap.has(part.partNo)) {
        const existing = inventoryMap.get(part.partNo)!;
        if (part.imageUrl && !existing.imageUrl) {
          existing.imageUrl = part.imageUrl;
        }
        if (part.originalImages && part.originalImages.length > 0) {
          existing.originalImages = part.originalImages;
        }
        existing.originalPrice = part.originalPrice;
        existing.description = part.description;
      } else {
        inventoryMap.set(part.partNo, part);
      }
    }

    const fullInventory = Array.from(inventoryMap.values());
    // The canonical Suite endpoint is upsert-based, so only the parts from THIS
    // quote need to go over the wire — 1 request instead of re-posting the
    // whole (1000+ part) inventory in 20+ batches, which burned through the
    // Worker's 15-minute rate limit (verified live: HTTP 429) and made later
    // saves like accounts/invoices fail.
    const isUp = await checkServerAvailability();
    const cached = await localSet('inventory', username, fullInventory);
    if (!isUp) {
      await rememberPendingCanonicalWrite(username, 'inventory', fullInventory);
      return { synced: false, cached };
    }
    const synced = await serverSet(username, 'inventory', newParts);
    if (!synced) await rememberPendingCanonicalWrite(username, 'inventory', fullInventory);
    return { synced, cached };
  },

  // --- Parts Image Pool Operations ---
  async getPartsImagePool(username: string): Promise<Record<string, string>> {
    return getData<Record<string, string>>('parts_image_pool', username, {});
  },

  async savePartsImagePool(username: string, pool: Record<string, string>): Promise<CloudWriteResult> {
    return setData('parts_image_pool', username, pool);
  },

  async addImageToPool(username: string, partNo: string, description: string, imageUrl: string): Promise<CloudWriteResult> {
    return this.addImagesToPool(username, [{ partNo, description, imageUrl }]);
  },

  async addImagesToPool(username: string, images: { partNo: string, description: string, imageUrl: string }[]): Promise<CloudWriteResult> {
    if (images.length === 0) return { synced: true, cached: true };
    const pool = await this.getPartsImagePool(username);
    for (const img of images) {
      pool[poolKeyFor(img.partNo, img.description)] = img.imageUrl;
    }
    return this.savePartsImagePool(username, pool);
  },

  async findImageInPool(username: string, partNo: string, description: string): Promise<string | null> {
    const pool = await this.getPartsImagePool(username);
    return findPooledImage(pool, partNo, description);
  }
};
