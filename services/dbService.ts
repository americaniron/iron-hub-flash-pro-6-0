
import { CustomerAccount, SavedQuote, InvoiceData, Payment, RecurringInvoice, InvoiceTemplate, InventoryPart } from '../types.ts';

/**
 * Enterprise Cloud Repository Service
 * Uses IndexedDB for persistent client-side storage to prevent data loss on redeployment.
 * This provides a robust, offline-capable data store.
 */

const DELAY = 200; // Simulated Cloud Latency (reduced for faster local DB access)
const DB_NAME = 'AmericanIronHubDB_V1';
const DB_VERSION = 2;
const STORE_NAMES = ['accounts', 'quotes', 'invoices', 'payments', 'credits', 'drafts', 'recurring_invoices', 'templates', 'parts_image_pool', 'inventory'];

let dbPromise: Promise<IDBDatabase> | null = null;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject('IndexedDB not supported in this browser.');
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error("IndexedDB error:", request.error);
        reject("IndexedDB error");
      };

      request.onsuccess = () => {
        const db = request.result;
        // IMPROVEMENT: Handle unexpected connection closes. When the connection is closed by the browser
        // or other circumstances, we reset the dbPromise. This forces a fresh connection
        // on the next call, preventing "connection is closing" errors and making the service self-healing.
        db.onclose = () => {
            console.warn("Database connection closed unexpectedly. It will be reopened on the next request.");
            dbPromise = null;
        };
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

async function getStoreData<T>(storeName: string, username: string): Promise<T | null> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(username);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result ? request.result.data : null);
  });
}

async function setStoreData<T>(storeName: string, username: string, data: T): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put({ username, data });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export const dbService = {
  // --- Customer Account Operations ---
  async getCustomerAccounts(username: string): Promise<CustomerAccount[]> {
    await wait(DELAY);
    const data = await getStoreData<CustomerAccount[]>("accounts", username);
    return data || [];
  },

  async saveCustomerAccounts(username: string, accounts: CustomerAccount[]): Promise<void> {
    await wait(DELAY / 2);
    await setStoreData("accounts", username, accounts);
  },

  // --- Quote Archive Operations ---
  async getQuotes(username: string): Promise<SavedQuote[]> {
    await wait(DELAY);
    const data = await getStoreData<SavedQuote[]>("quotes", username);
    return data || [];
  },

  async saveQuote(username: string, quote: Omit<SavedQuote, 'id' | 'timestamp' | 'author'>): Promise<SavedQuote> {
    await wait(DELAY);
    const quotes = await this.getQuotes(username);
    const newQuote: SavedQuote = {
      ...quote,
      id: `SQ-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
      timestamp: new Date().toISOString(),
      author: username
    };
    quotes.unshift(newQuote); // Newest first
    await setStoreData("quotes", username, quotes.slice(0, 100)); // Limit history
    return newQuote;
  },

  async saveAllQuotes(username: string, quotes: SavedQuote[]): Promise<void> {
    await wait(DELAY / 2);
    await setStoreData("quotes", username, quotes);
  },

  async deleteQuote(username: string, quoteId: string): Promise<void> {
    await wait(DELAY);
    const quotes = await this.getQuotes(username);
    const filtered = quotes.filter(q => q.id !== quoteId);
    await setStoreData("quotes", username, filtered);
  },

  // --- New Invoice & Payment Operations ---
  async getInvoices(username: string): Promise<InvoiceData[]> {
    await wait(DELAY);
    const data = await getStoreData<InvoiceData[]>("invoices", username);
    return data || [];
  },

  async saveInvoices(username: string, invoices: InvoiceData[]): Promise<void> {
    await wait(DELAY);
    await setStoreData("invoices", username, invoices);
  },

  async getPayments(username: string): Promise<Payment[]> {
    await wait(DELAY);
    const data = await getStoreData<Payment[]>("payments", username);
    return data || [];
  },
  
  async savePayments(username: string, payments: Payment[]): Promise<void> {
    await wait(DELAY);
    await setStoreData("payments", username, payments);
  },

  // --- Recurring Invoices ---
  async getRecurringInvoices(username: string): Promise<RecurringInvoice[]> {
    await wait(DELAY);
    const data = await getStoreData<RecurringInvoice[]>("recurring_invoices", username);
    return data || [];
  },

  async saveRecurringInvoices(username: string, recurring: RecurringInvoice[]): Promise<void> {
    await wait(DELAY);
    await setStoreData("recurring_invoices", username, recurring);
  },

  // --- Invoice Templates ---
  async getTemplates(username: string): Promise<InvoiceTemplate[]> {
    await wait(DELAY);
    const data = await getStoreData<InvoiceTemplate[]>("templates", username);
    return data || [];
  },

  async saveTemplates(username: string, templates: InvoiceTemplate[]): Promise<void> {
    await wait(DELAY);
    await setStoreData("templates", username, templates);
  },

  // --- Draft Persistence ---
  async getDraft(username: string): Promise<any | null> {
    await wait(DELAY);
    return await getStoreData<any>("drafts", username);
  },

  async saveDraft(username: string, data: any): Promise<void> {
    await wait(DELAY / 4);
    await setStoreData("drafts", username, data);
  },

  // --- Billing & Resource Control ---
  async getUserCredits(username: string): Promise<number> {
    await wait(DELAY / 2);
    const credits = await getStoreData<number>("credits", username);
    // Return credits if it's a number (including 0), otherwise default.
    return typeof credits === 'number' ? credits : 1000;
  },

  async deductCredits(username: string, amount: number): Promise<number> {
    const current = await this.getUserCredits(username);
    const updated = Math.max(0, current - amount);
    await setStoreData("credits", username, updated);
    return updated;
  },

  // --- Data Portability ---
  async exportAllUserData(username: string): Promise<Record<string, any>> {
    const exportedData: Record<string, any> = {};
    for (const storeName of STORE_NAMES) {
      const data = await getStoreData(storeName, username);
      if (data !== null) {
        exportedData[storeName] = data;
      } else {
        // Provide sensible defaults for missing data
        if (storeName === 'credits') exportedData[storeName] = 1000;
        else if (storeName === 'drafts') exportedData[storeName] = null;
        else if (storeName === 'parts_image_pool') exportedData[storeName] = {};
        else exportedData[storeName] = [];
      }
    }
    return exportedData;
  },

  async importAllUserData(username: string, data: Record<string, any>): Promise<void> {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAMES, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      STORE_NAMES.forEach(storeName => {
        if (data.hasOwnProperty(storeName)) {
          const store = transaction.objectStore(storeName);
          store.put({ username, data: data[storeName] });
        }
      });
    });
  },

  // --- Inventory Operations ---
  async getInventory(username: string): Promise<InventoryPart[]> {
    await wait(DELAY);
    const data = await getStoreData<InventoryPart[]>("inventory", username);
    return data || [];
  },

  async saveInventory(username: string, inventory: InventoryPart[]): Promise<void> {
    await wait(DELAY / 2);
    await setStoreData("inventory", username, inventory);
  },

  async addOrUpdateInventoryParts(username: string, newParts: InventoryPart[]): Promise<void> {
    const currentInventory = await this.getInventory(username);
    const inventoryMap = new Map(currentInventory.map(p => [p.partNo, p]));
    
    for (const part of newParts) {
      if (inventoryMap.has(part.partNo)) {
        const existing = inventoryMap.get(part.partNo)!;
        // Update image if new one exists and old one doesn't
        if (part.imageUrl && !existing.imageUrl) {
          existing.imageUrl = part.imageUrl;
        }
        if (part.originalImages && part.originalImages.length > 0) {
          existing.originalImages = part.originalImages;
        }
        // Update price if it changed
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
    await wait(DELAY);
    const data = await getStoreData<Record<string, string>>("parts_image_pool", username);
    return data || {};
  },

  async savePartsImagePool(username: string, pool: Record<string, string>): Promise<void> {
    await wait(DELAY / 2);
    await setStoreData("parts_image_pool", username, pool);
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
