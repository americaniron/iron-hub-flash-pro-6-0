/**
 * Activity Bridge — Real-time sync from Iron Hub 6.0 to IronSuite
 *
 * Posts activities and journal entries to IronSuite's database
 * whenever quotes, invoices, customers, payments, or inventory
 * are created/updated in 6.0.
 *
 * Uses API-key auth to bypass session requirements for cross-origin requests.
 */

const IRONSUITE_BASE = 'https://iron-hub-suite.replit.app';
const API_KEY = 'ih6_act_7f8a9b2c3d4e5f6a1b2c3d4e';

interface ActivityPayload {
  type: 'task' | 'note' | 'email' | 'call' | 'meeting';
  subject: string;
  description?: string;
  relatedType?: string;
  relatedId?: string;
  createdBy?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

interface JournalPayload {
  description: string;
  amount: number;
  entryType: 'invoice' | 'payment' | 'bill' | 'purchase_order';
  referenceId?: string;
  referenceNumber?: string;
}

// Queue for offline/failed activities — retry on next successful post
let pendingQueue: ActivityPayload[] = [];

async function postActivity(payload: ActivityPayload): Promise<boolean> {
  try {
    const res = await fetch(`${IRONSUITE_BASE}/api/bridge/activity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    // Queue for retry
    pendingQueue.push(payload);
    return false;
  }
}

async function postJournal(payload: JournalPayload): Promise<boolean> {
  try {
    const res = await fetch(`${IRONSUITE_BASE}/api/bridge/journal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Flush any queued activities
async function flushQueue(): Promise<void> {
  if (pendingQueue.length === 0) return;
  const batch = [...pendingQueue];
  pendingQueue = [];
  try {
    const res = await fetch(`${IRONSUITE_BASE}/api/bridge/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
      },
      body: JSON.stringify({ activities: batch }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      // Re-queue
      pendingQueue.push(...batch);
    }
  } catch {
    pendingQueue.push(...batch);
  }
}

// ============================================================
// Public Activity Logging Functions — called from App.tsx
// ============================================================

export const activityBridge = {
  /** Call on app startup to flush any queued activities */
  init() {
    flushQueue().catch(() => {});
  },

  // ---- Quoting ----
  quoteCreated(quoteId: string, customer: string, itemCount: number, total: number, user: string) {
    postActivity({
      type: 'task',
      subject: `Quote created: ${quoteId}`,
      description: `New quote ${quoteId} for ${customer} — ${itemCount} items, $${total.toFixed(2)}`,
      relatedType: 'quote',
      relatedId: quoteId,
      createdBy: user,
    });
  },

  quoteSaved(quoteId: string, customer: string, user: string) {
    postActivity({
      type: 'note',
      subject: `Quote saved to archive: ${quoteId}`,
      description: `Quote ${quoteId} for ${customer} saved to vault`,
      relatedType: 'quote',
      relatedId: quoteId,
      createdBy: user,
    });
  },

  quoteSentEmail(quoteId: string, customer: string, email: string, user: string) {
    postActivity({
      type: 'email',
      subject: `Quote emailed: ${quoteId}`,
      description: `Quote ${quoteId} sent to ${customer} at ${email}`,
      relatedType: 'quote',
      relatedId: quoteId,
      createdBy: user,
    });
  },

  quoteWhatsApp(quoteId: string, customer: string, user: string) {
    postActivity({
      type: 'note',
      subject: `Quote shared via WhatsApp: ${quoteId}`,
      description: `Quote ${quoteId} for ${customer} shared via WhatsApp`,
      relatedType: 'quote',
      relatedId: quoteId,
      createdBy: user,
    });
  },

  quotePrinted(quoteId: string, user: string) {
    postActivity({
      type: 'note',
      subject: `Quote printed: ${quoteId}`,
      relatedType: 'quote',
      relatedId: quoteId,
      createdBy: user,
    });
  },

  // ---- Invoicing ----
  invoiceCreated(invoiceId: string, customer: string, total: number, user: string) {
    postActivity({
      type: 'task',
      subject: `Invoice created: ${invoiceId}`,
      description: `Invoice ${invoiceId} for ${customer} — $${total.toFixed(2)}`,
      relatedType: 'invoice',
      relatedId: invoiceId,
      createdBy: user,
      priority: 'high',
    });
    postJournal({
      description: `Invoice ${invoiceId} — ${customer} — $${total.toFixed(2)}`,
      amount: Math.round(total * 100),
      entryType: 'invoice',
      referenceId: invoiceId,
      referenceNumber: invoiceId,
    });
  },

  invoiceConverted(quoteId: string, invoiceId: string, customer: string, total: number, user: string) {
    postActivity({
      type: 'task',
      subject: `Quote ${quoteId} converted to invoice ${invoiceId}`,
      description: `Quote converted to invoice for ${customer} — $${total.toFixed(2)}`,
      relatedType: 'invoice',
      relatedId: invoiceId,
      createdBy: user,
      priority: 'high',
    });
  },

  // ---- Customers ----
  customerAdded(name: string, company: string, user: string) {
    postActivity({
      type: 'note',
      subject: `Customer added: ${company || name}`,
      description: `New customer account created — ${name}${company ? ` at ${company}` : ''}`,
      relatedType: 'customer',
      createdBy: user,
    });
  },

  customerUpdated(name: string, company: string, user: string) {
    postActivity({
      type: 'note',
      subject: `Customer updated: ${company || name}`,
      description: `Customer record updated — ${name}${company ? ` at ${company}` : ''}`,
      relatedType: 'customer',
      createdBy: user,
    });
  },

  customerDeleted(name: string, user: string) {
    postActivity({
      type: 'note',
      subject: `Customer deleted: ${name}`,
      relatedType: 'customer',
      createdBy: user,
      priority: 'high',
    });
  },

  // ---- Payments ----
  paymentRecorded(paymentId: string, customer: string, amount: number, method: string, user: string) {
    postActivity({
      type: 'task',
      subject: `Payment received: $${amount.toFixed(2)}`,
      description: `Payment from ${customer} — $${amount.toFixed(2)} via ${method}`,
      relatedType: 'payment',
      relatedId: paymentId,
      createdBy: user,
      priority: 'high',
    });
    postJournal({
      description: `Payment received — ${customer} — $${amount.toFixed(2)} via ${method}`,
      amount: Math.round(amount * 100),
      entryType: 'payment',
      referenceId: paymentId,
      referenceNumber: paymentId,
    });
  },

  // ---- Inventory ----
  inventoryUpdated(itemCount: number, user: string) {
    postActivity({
      type: 'note',
      subject: `Inventory updated: ${itemCount} items`,
      description: `Inventory catalog updated with ${itemCount} parts`,
      relatedType: 'inventory',
      createdBy: user,
    });
  },

  inventoryImported(itemCount: number, user: string) {
    postActivity({
      type: 'task',
      subject: `Inventory imported: ${itemCount} items`,
      description: `Bulk inventory import — ${itemCount} parts added/updated`,
      relatedType: 'inventory',
      createdBy: user,
    });
  },

  // ---- Data Operations ----
  dataImported(user: string) {
    postActivity({
      type: 'task',
      subject: 'Full data backup imported',
      description: 'All user data restored from backup file',
      relatedType: 'system',
      createdBy: user,
      priority: 'high',
    });
  },

  dataExported(user: string) {
    postActivity({
      type: 'note',
      subject: 'Full data backup exported',
      description: 'Complete data backup downloaded',
      relatedType: 'system',
      createdBy: user,
    });
  },

  cloudSynced(user: string) {
    postActivity({
      type: 'note',
      subject: 'Cloud sync completed',
      description: 'Quote committed to cloud storage',
      relatedType: 'system',
      createdBy: user,
    });
  },

  // ---- AI Analysis ----
  analysisGenerated(quoteId: string, language: string, user: string) {
    postActivity({
      type: 'note',
      subject: `AI analysis generated: ${quoteId}`,
      description: `AI voice analysis generated for quote ${quoteId} in ${language === 'ar' ? 'Arabic' : 'English'}`,
      relatedType: 'quote',
      relatedId: quoteId,
      createdBy: user,
    });
  },
};
