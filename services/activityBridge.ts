/**
 * Records Hub activity through the authenticated Suite compatibility route.
 * Failed writes remain in this tab's durable queue and retry with backoff;
 * they are never sent to a third-party endpoint or signed with a client key.
 */
import { hubApiFetch } from './hubApi.ts';

type ActivityPayload = {
  type: string;
  subject: string;
  description?: string;
  relatedType: 'external';
  relatedId?: string;
  priority: 'normal';
};

type PendingActivity = ActivityPayload & { attempts: number };

const STORAGE_KEY = 'iron_hub_activity_queue_v1';
const MAX_QUEUE_LENGTH = 100;
let queue: PendingActivity[] = [];
let flushing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function persist(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE_LENGTH)));
  } catch {
    // Browser storage may be unavailable in private or embedded contexts.
  }
}

function restore(): void {
  if (queue.length > 0) return;
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]') as unknown;
    if (Array.isArray(stored)) {
      queue = stored
        .filter((entry): entry is PendingActivity => !!entry && typeof entry === 'object' && typeof (entry as PendingActivity).type === 'string' && typeof (entry as PendingActivity).subject === 'string')
        .slice(-MAX_QUEUE_LENGTH);
    }
  } catch {
    queue = [];
  }
}

function scheduleRetry(attempts: number): void {
  if (retryTimer) return;
  const delay = Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6));
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flush();
  }, delay);
}

async function flush(): Promise<void> {
  if (flushing) return;
  restore();
  flushing = true;
  try {
    while (queue.length > 0) {
      const entry = queue[0];
      try {
        const response = await hubApiFetch('/api/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: entry.type,
            subject: entry.subject,
            description: entry.description,
            relatedType: entry.relatedType,
            relatedId: entry.relatedId,
            priority: entry.priority,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`Activity request failed with ${response.status}`);
        queue.shift();
        persist();
      } catch {
        entry.attempts += 1;
        persist();
        scheduleRetry(entry.attempts);
        return;
      }
    }
  } finally {
    flushing = false;
  }
}

function record(type: string, subject: string, relatedId?: string, description?: string): void {
  restore();
  queue.push({ type, subject: subject.slice(0, 300), description: description?.slice(0, 10_000), relatedType: 'external', relatedId: relatedId?.slice(0, 240), priority: 'normal', attempts: 0 });
  if (queue.length > MAX_QUEUE_LENGTH) queue = queue.slice(-MAX_QUEUE_LENGTH);
  persist();
  void flush();
}

export const activityBridge = {
  init: () => { restore(); void flush(); },
  quoteCreated: (quoteId: string, customer: string, itemCount: number, total: number, _username: string) => record('quote_created', `Quote ${quoteId} created for ${customer}`, quoteId, `${itemCount} line item(s), total ${Number(total || 0).toFixed(2)}`),
  quoteSaved: (quoteId: string, customer: string, _username: string) => record('quote_saved', `Quote ${quoteId} saved for ${customer}`, quoteId),
  quoteSentEmail: (quoteId: string, customer: string, recipient: string, _username: string) => record('quote_emailed', `Quote ${quoteId} emailed to ${customer}`, quoteId, `Recipient: ${recipient}`),
  quoteWhatsApp: (quoteId: string, customer: string, _username: string) => record('quote_whatsapp', `Quote ${quoteId} shared with ${customer}`, quoteId),
  quotePrinted: (quoteId: string, _username: string) => record('quote_printed', `Quote ${quoteId} printed`, quoteId),
  invoiceCreated: (invoiceId: string, customer: string, total: number, _username: string) => record('invoice_created', `Invoice ${invoiceId} created for ${customer}`, invoiceId, `Total: ${Number(total || 0).toFixed(2)}`),
  invoiceConverted: (quoteId: string, invoiceId: string, customer: string, total: number, _username: string) => record('invoice_converted', `Quote ${quoteId} converted to invoice ${invoiceId} for ${customer}`, invoiceId, `Total: ${Number(total || 0).toFixed(2)}`),
  customerAdded: (contact: string, company: string, _username: string) => record('customer_created', `Customer ${company || contact} added`, undefined),
  customerUpdated: (contact: string, company: string, _username: string) => record('customer_updated', `Customer ${company || contact} updated`, undefined),
  customerDeleted: (customer: string, _username: string) => record('customer_deleted', `Customer ${customer} removed`, undefined),
  paymentRecorded: (paymentId: string, customer: string, amount: number, method: string, _username: string) => record('payment_recorded', `Payment ${paymentId} recorded for ${customer}`, paymentId, `${Number(amount || 0).toFixed(2)} via ${method}`),
  inventoryUpdated: (count: number, _username: string) => record('inventory_updated', `${count} inventory item(s) updated`),
  inventoryImported: (count: number, _username: string) => record('inventory_imported', `${count} inventory item(s) imported`),
  dataImported: (_username: string) => record('data_imported', 'Hub data imported'),
  dataExported: (_username: string) => record('data_exported', 'Hub data exported'),
  cloudSynced: (_username: string) => record('cloud_synced', 'Hub data synchronized with IronSuite'),
  analysisGenerated: (quoteId: string, language: string, _username: string) => record('analysis_generated', `AI analysis generated for ${quoteId}`, quoteId, `Language: ${language}`),
};
