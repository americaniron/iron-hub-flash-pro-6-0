
import { CustomerAccount, SavedQuote, InvoiceData, Payment, RecurringInvoice, InvoiceTemplate, InventoryPart } from '../types.ts';

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
const DB_VERSION = 2;
const STORE_NAMES = ['accounts', 'quotes', 'invoices', 'payments', 'credits', 'drafts', 'recurring_invoices', 'templates', 'parts_image_pool', 'inventory'];

// ---- Server availability state ----
let serverAvailable: boolean | null = null; // null = not checked yet
let lastServerCheck = 0;
const SERVER_CHECK_INTERVAL = 30000; // Re-check every 30s if server was down

async function checkServerAvailability(): Promise<boolean> {
  const now = Date.now();
  if (serverAvailable !== null && (now - lastServerCheck) < SERVER_CHECK_INTERVAL) {
    return serverAvailable;
  }

  try {
    const res = await fetch(API_STATUS, { signal: AbortSignal.timeout(5000) });
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
    const res = await fetch(`${API_BASE}?username=${encodeURIComponent(username)}&store=${encodeURIComponent(store)}`, {
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
  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, store, data }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function serverGetAll(username: string): Promise<Record<string, any> | null> {
  try {
    const res = await fetch(`${API_BASE}?username=${encodeURIComponent(username)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.success ? json.data : null;
  } catch {
    return null;
  }
}

async function serverDelete(username: string, store: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}?username=${encodeURIComponent(username)}&store=${encodeURIComponent(store)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function serverSetAll(username: string, stores: Record<string, any>): Promise<boolean> {
  try {
    const res = await fetch(API_BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, stores }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch {
    return false;
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
        STORE_NAMES.forEach(storeName => {
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

async function localSet<T>(storeName: string, username: string, data: T): Promise<void> {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put({ username, data });
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve();
    });
  } catch {
    // Silent fail on local cache write
  }
}

// ---- Helpers to detect default/empty values ----
const D1_MAX_STORE_SIZE = 900_000; // ~900KB safe limit for D1 row values

// Estimate JSON size WITHOUT full serialization (avoids OOM on 100MB+ stores)
function estimateSize(data: any): number {
  if (data === null || data === undefined) return 4;
  if (typeof data === 'number' || typeof data === 'boolean') return 8;
  if (typeof data === 'string') return data.length + 2;
  if (Array.isArray(data)) {
    if (data.length === 0) return 2;
    // Serialize ONLY the first item and extrapolate
    const sampleSize = JSON.stringify(data[0]).length;
    return (sampleSize + 1) * data.length + 2;
  }
  if (typeof data === 'object') {
    const keys = Object.keys(data);
    if (keys.length === 0) return 2;
    // Sample first 3 values and extrapolate
    const sampleKeys = keys.slice(0, Math.min(3, keys.length));
    let totalSample = 0;
    for (const k of sampleKeys) totalSample += JSON.stringify(data[k]).length + k.length + 4;
    return Math.ceil((totalSample / sampleKeys.length) * keys.length);
  }
  return 100;
}

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

  if (isUp) {
    const serverData = await serverGet<T>(username, storeName);
    if (serverData !== null) {
      // If server returned empty/default, check if local has real data first
      if (isEmptyDefault(storeName, serverData)) {
        const localData = await localGet<T>(storeName, username);
        if (localData !== null && !isEmptyDefault(storeName, localData)) {
          // Local has real data that server doesn't — use local and try to push to server
          const estSize = estimateSize(localData);
          if (estSize < D1_MAX_STORE_SIZE) {
            serverSet(username, storeName, localData).catch(() => {});
          }
          return localData;
        }
      }
      // Server has real data — cache locally
      localSet(storeName, username, serverData).catch(() => {});
      return serverData;
    }
  }

  // Fallback: try local IndexedDB
  const localData = await localGet<T>(storeName, username);
  if (localData !== null) {
    // If server is up but returned null (error), push local data to server (migration)
    if (isUp) {
      const estSize = estimateSize(localData);
      if (estSize < D1_MAX_STORE_SIZE) {
        serverSet(username, storeName, localData).catch(() => {});
      }
    }
    return localData;
  }

  return defaultVal;
}

async function setData<T>(storeName: string, username: string, data: T): Promise<void> {
  const isUp = await checkServerAvailability();
  const estSize = estimateSize(data);

  if (isUp && estSize < D1_MAX_STORE_SIZE) {
    const ok = await serverSet(username, storeName, data);
    if (ok) {
      // Also cache locally
      localSet(storeName, username, data).catch(() => {});
      return;
    }
  }

  // Fallback or large data: write to local IndexedDB
  await localSet(storeName, username, data);
  if (estSize >= D1_MAX_STORE_SIZE) {
    console.log(`[dbService] Store '${storeName}' is ~${(estSize / 1024 / 1024).toFixed(1)}MB — saved to local storage (exceeds D1 limit)`);
  }
}

// ---- Migration: push local IndexedDB data to server on first connect ----
let migrationDone = new Set<string>();

async function migrateLocalToServer(username: string): Promise<void> {
  if (migrationDone.has(username)) return;

  const isUp = await checkServerAvailability();
  if (!isUp) return;

  try {
    // Check if server already has data for this user
    const serverData = await serverGetAll(username);
    const hasServerData = serverData && Object.values(serverData).some(v => {
      if (Array.isArray(v) && v.length > 0) return true;
      if (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length > 0) return true;
      return false;
    });

    if (hasServerData) {
      // Server already has data — no need to migrate, server is source of truth
      migrationDone.add(username);
      return;
    }

    // Server is empty — check if we have local data to push up
    const localStores: Record<string, any> = {};
    let hasLocal = false;

    for (const store of STORE_NAMES) {
      const data = await localGet(store, username);
      if (data !== null) {
        const isNonEmpty = Array.isArray(data) ? data.length > 0 :
          typeof data === 'object' && data !== null ? Object.keys(data).length > 0 :
          data !== null;
        if (isNonEmpty) {
          localStores[store] = data;
          hasLocal = true;
        }
      }
    }

    if (hasLocal) {
      // Migrate store-by-store, skipping stores that are too large for D1
      const smallStores: Record<string, any> = {};
      for (const [store, storeData] of Object.entries(localStores)) {
        const estSize = estimateSize(storeData);
        if (estSize < D1_MAX_STORE_SIZE) {
          smallStores[store] = storeData;
        } else {
          console.log(`[dbService] Skipping migration of '${store}' (~${(estSize / 1024 / 1024).toFixed(1)}MB) — exceeds D1 limit`);
        }
      }
      if (Object.keys(smallStores).length > 0) {
        console.log(`[dbService] Migrating ${Object.keys(smallStores).length} local stores to cloud for ${username}`);
        await serverSetAll(username, smallStores);
      }
    }

    migrationDone.add(username);
  } catch (err) {
    console.warn('[dbService] Migration failed:', err);
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
      // Kick off migration in background
      migrateLocalToServer(username).catch(() => {});
    }
    return { serverConnected: isUp };
  },

  // --- Customer Account Operations ---
  async getCustomerAccounts(username: string): Promise<CustomerAccount[]> {
    return getData<CustomerAccount[]>('accounts', username, []);
  },

  async saveCustomerAccounts(username: string, accounts: CustomerAccount[]): Promise<void> {
    await setData('accounts', username, accounts);
  },

  // --- Quote Archive Operations ---
  async getQuotes(username: string): Promise<SavedQuote[]> {
    return getData<SavedQuote[]>('quotes', username, []);
  },

  async saveQuote(username: string, quote: Omit<SavedQuote, 'id' | 'timestamp' | 'author'>): Promise<SavedQuote> {
    const quotes = await this.getQuotes(username);
    const newQuote: SavedQuote = {
      ...quote,
      id: `SQ-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
      timestamp: new Date().toISOString(),
      author: username
    };
    quotes.unshift(newQuote);
    await setData('quotes', username, quotes.slice(0, 100));
    return newQuote;
  },

  async saveAllQuotes(username: string, quotes: SavedQuote[]): Promise<void> {
    await setData('quotes', username, quotes);
  },

  async deleteQuote(username: string, quoteId: string): Promise<void> {
    const quotes = await this.getQuotes(username);
    const filtered = quotes.filter(q => q.id !== quoteId);
    await setData('quotes', username, filtered);
  },

  // --- Invoice & Payment Operations ---
  async getInvoices(username: string): Promise<InvoiceData[]> {
    return getData<InvoiceData[]>('invoices', username, []);
  },

  async saveInvoices(username: string, invoices: InvoiceData[]): Promise<void> {
    await setData('invoices', username, invoices);
  },

  async getPayments(username: string): Promise<Payment[]> {
    return getData<Payment[]>('payments', username, []);
  },

  async savePayments(username: string, payments: Payment[]): Promise<void> {
    await setData('payments', username, payments);
  },

  // --- Recurring Invoices ---
  async getRecurringInvoices(username: string): Promise<RecurringInvoice[]> {
    return getData<RecurringInvoice[]>('recurring_invoices', username, []);
  },

  async saveRecurringInvoices(username: string, recurring: RecurringInvoice[]): Promise<void> {
    await setData('recurring_invoices', username, recurring);
  },

  // --- Invoice Templates ---
  async getTemplates(username: string): Promise<InvoiceTemplate[]> {
    return getData<InvoiceTemplate[]>('templates', username, []);
  },

  async saveTemplates(username: string, templates: InvoiceTemplate[]): Promise<void> {
    await setData('templates', username, templates);
  },

  // --- Draft Persistence ---
  async getDraft(username: string): Promise<any | null> {
    return getData<any>('drafts', username, null);
  },

  async saveDraft(username: string, data: any): Promise<void> {
    await setData('drafts', username, data);
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

  async importAllUserData(username: string, data: Record<string, any>): Promise<void> {
    const isUp = await checkServerAvailability();

    // Import store-by-store to handle large stores gracefully
    for (const [store, storeData] of Object.entries(data)) {
      if (!STORE_NAMES.includes(store)) continue;

      const estSize = estimateSize(storeData);

      if (isUp && estSize < D1_MAX_STORE_SIZE) {
        // Small enough for D1 — write to server
        const ok = await serverSet(username, store, storeData);
        if (ok) {
          console.log(`[import] ${store}: saved to cloud (~${(estSize / 1024).toFixed(0)}KB)`);
        }
      } else if (isUp && estSize >= D1_MAX_STORE_SIZE) {
        // Too large for D1 — DELETE any stale D1 entry so getData doesn't return old server data
        console.log(`[import] ${store}: ~${(estSize / 1024 / 1024).toFixed(1)}MB — too large for D1, saving locally only`);
        serverDelete(username, store).catch(() => {});
      }

      // Always write to IndexedDB (critical for large stores, and as cache for small ones)
      try {
        await localSet(store, username, storeData);
        console.log(`[import] ${store}: saved to local storage`);
      } catch (err) {
        console.error(`[import] ${store}: local save failed`, err);
      }
    }
  },

  // --- Inventory Operations ---
  async getInventory(username: string): Promise<InventoryPart[]> {
    return getData<InventoryPart[]>('inventory', username, []);
  },

  async saveInventory(username: string, inventory: InventoryPart[]): Promise<void> {
    await setData('inventory', username, inventory);
  },

  async addOrUpdateInventoryParts(username: string, newParts: InventoryPart[]): Promise<void> {
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

    await this.saveInventory(username, Array.from(inventoryMap.values()));
  },

  // --- Parts Image Pool Operations ---
  async getPartsImagePool(username: string): Promise<Record<string, string>> {
    return getData<Record<string, string>>('parts_image_pool', username, {});
  },

  async savePartsImagePool(username: string, pool: Record<string, string>): Promise<void> {
    await setData('parts_image_pool', username, pool);
  },

  async addImageToPool(username: string, partNo: string, description: string, imageUrl: string): Promise<void> {
    await this.addImagesToPool(username, [{ partNo, description, imageUrl }]);
  },

  async addImagesToPool(username: string, images: { partNo: string, description: string, imageUrl: string }[]): Promise<void> {
    if (images.length === 0) return;
    const pool = await this.getPartsImagePool(username);
    for (const img of images) {
      const key = `${img.partNo}_${img.description}`.replace(/[^a-zA-Z0-9_]/g, '_');
      pool[key] = img.imageUrl;
    }
    await this.savePartsImagePool(username, pool);
  },

  async findImageInPool(username: string, partNo: string, description: string): Promise<string | null> {
    const pool = await this.getPartsImagePool(username);
    const key = `${partNo}_${description}`.replace(/[^a-zA-Z0-9_]/g, '_');
    return pool[key] || null;
  }
};
