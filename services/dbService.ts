
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
  const batches = CANONICAL_STORES.has(store) && Array.isArray(data)
    ? Array.from({ length: Math.ceil(data.length / CANONICAL_SYNC_BATCH_SIZE) }, (_, index) => data.slice(index * CANONICAL_SYNC_BATCH_SIZE, (index + 1) * CANONICAL_SYNC_BATCH_SIZE))
    : [data];

  for (const batch of batches) {
    let delivered = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
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
        if (res.status < 500 && res.status !== 409 && res.status !== 422) return false;
      } catch {
        // Retry transient network and Worker failures before using local fallback.
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
    if (!delivered) return false;
  }
  return true;
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

// ---- Unified read/write: server-first, local-fallback ----
async function getData<T>(storeName: string, username: string, defaultVal: T): Promise<T> {
  const isUp = await checkServerAvailability();
  const pending = CANONICAL_STORES.has(storeName) ? await pendingCanonicalWrites(username) : null;
  if (pending && Object.prototype.hasOwnProperty.call(pending, storeName)) {
    const localPending = pending[storeName] as T;
    if (isUp && Array.isArray(localPending) && localPending.length > 0) {
      void serverSet(username, storeName, localPending).then(async (synced) => {
        if (synced) await clearPendingCanonicalWrite(username, storeName);
      });
    }
    return localPending;
  }

  if (isUp) {
    const serverData = await serverGet<T>(username, storeName);
    if (serverData !== null) {
      // If server returned empty/default, check if local has real data first
      if (isEmptyDefault(storeName, serverData)) {
        const localData = await localGet<T>(storeName, username);
        if (localData !== null && !isEmptyDefault(storeName, localData)) {
          // Local has real data that server doesn't — use local and push to server
          void serverSet(username, storeName, localData);
          return localData;
        }
      }
      // Server has real data — cache locally
      void localSet(storeName, username, serverData);
      return serverData;
    }
  }

  // Fallback: try local IndexedDB
  const localData = await localGet<T>(storeName, username);
  if (localData !== null) {
    // If server is up but returned null (error), push local data to server (migration)
    if (isUp) {
      void serverSet(username, storeName, localData);
    }
    return localData;
  }

  return defaultVal;
}

async function setData<T>(storeName: string, username: string, data: T): Promise<CloudWriteResult> {
  const canonical = CANONICAL_STORES.has(storeName);
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
      void flushPendingCanonicalWrites(username);
      // Kick off migration in background
      void migrateLocalToServer(username);
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
    const sync = await setData('quotes', username, quotes.slice(0, 100));
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
    return getData<InventoryPart[]>('inventory', username, []);
  },

  async saveInventory(username: string, inventory: InventoryPart[]): Promise<CloudWriteResult> {
    return setData('inventory', username, inventory);
  },

  async addOrUpdateInventoryParts(username: string, newParts: InventoryPart[]): Promise<CloudWriteResult> {
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

    return this.saveInventory(username, Array.from(inventoryMap.values()));
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
      const key = `${img.partNo}_${img.description}`.replace(/[^a-zA-Z0-9_]/g, '_');
      pool[key] = img.imageUrl;
    }
    return this.savePartsImagePool(username, pool);
  },

  async findImageInPool(username: string, partNo: string, description: string): Promise<string | null> {
    const pool = await this.getPartsImagePool(username);
    const key = `${partNo}_${description}`.replace(/[^a-zA-Z0-9_]/g, '_');
    return pool[key] || null;
  }
};
