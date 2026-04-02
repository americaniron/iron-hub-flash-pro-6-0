/**
 * Bridge Sync Service — Push data from Iron Hub 6.0 → Iron Hub Suite
 *
 * Uses the bridge API endpoints with API key auth (no cookie/session needed).
 * Reads all data from IndexedDB and pushes accounts, invoices, quotes,
 * inventory, and payments to the Suite in bulk.
 */

const SUITE_BASE = 'https://suite.fixmyiron.com';
const API_KEY = 'ih6_act_7f8a9b2c3d4e5f6a1b2c3d4e';

export interface BridgeSyncProgress {
  stage: string;
  detail: string;
  percent: number;
}

export interface BridgeSyncResult {
  success: boolean;
  timestamp: string;
  accounts: { pushed: number; failed: number };
  invoices: { pushed: number; failed: number };
  inventory: { pushed: number; failed: number };
  payments: { pushed: number; failed: number };
  errors: string[];
}

async function bridgeFetch(endpoint: string, body: any): Promise<any> {
  const res = await fetch(`${SUITE_BASE}/api/bridge/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Bridge ${endpoint} failed (${res.status}): ${errText.substring(0, 200)}`);
  }
  return res.json();
}

/**
 * Push all data from IndexedDB to Iron Hub Suite via bridge API.
 * Returns a detailed result of what was synced.
 */
export async function pushToSuite(
  db: any, // dbService instance
  username: string,
  onProgress?: (p: BridgeSyncProgress) => void
): Promise<BridgeSyncResult> {
  const result: BridgeSyncResult = {
    success: true,
    timestamp: new Date().toISOString(),
    accounts: { pushed: 0, failed: 0 },
    invoices: { pushed: 0, failed: 0 },
    inventory: { pushed: 0, failed: 0 },
    payments: { pushed: 0, failed: 0 },
    errors: [],
  };

  try {
    // ── Step 1: Push Accounts/Customers ──
    onProgress?.({ stage: 'accounts', detail: 'Loading accounts...', percent: 5 });
    let accounts: any[] = [];
    try {
      accounts = await db.getAccounts(username);
    } catch { accounts = []; }

    if (accounts.length > 0) {
      onProgress?.({ stage: 'accounts', detail: `Pushing ${accounts.length} accounts...`, percent: 10 });
      try {
        const customerPayload = accounts.map((a: any) => ({
          oldId: a.id,
          name: a.company || a.contactName || 'Unknown',
          company: a.company || '',
          email: a.email || '',
          phone: a.phone || '',
          address: a.billingAddress || '',
          city: a.billingCity || '',
          state: a.billingState || '',
          zip: a.billingZip || '',
          notes: (a.internalNotes || '') + (a.accountNumber ? ' | AcctNo: ' + a.accountNumber : '') + ' | 6.0 ID: ' + a.id,
        }));
        const resp = await bridgeFetch('import-customers', { customers: customerPayload });
        result.accounts.pushed = resp.count || 0;

        // Build old→new ID map for invoice customer assignment
        const customerMap: Record<string, string> = {};
        if (resp.customers || resp.results) {
          const results = resp.customers || resp.results;
          accounts.forEach((acc: any, idx: number) => {
            if (results[idx]) {
              customerMap[acc.id] = results[idx].newId;
            }
          });
        }
        // Store map for invoice/payment step
        (window as any).__bridgeCustomerMap = customerMap;
      } catch (err: any) {
        result.accounts.failed = accounts.length;
        result.errors.push('Accounts: ' + err.message);
      }
    }

    // ── Step 2: Push Invoices ──
    onProgress?.({ stage: 'invoices', detail: 'Loading invoices...', percent: 25 });
    let invoices: any[] = [];
    try {
      invoices = await db.getInvoices(username);
    } catch { invoices = []; }

    const customerMap = (window as any).__bridgeCustomerMap || {};

    if (invoices.length > 0) {
      onProgress?.({ stage: 'invoices', detail: `Pushing ${invoices.length} invoices...`, percent: 35 });
      try {
        const invoicePayload = invoices.map((inv: any) => {
          const subtotal = (inv.items || []).reduce((sum: number, item: any) =>
            sum + ((item.hours || item.quantity || 1) * (item.rate || item.unitPrice || 0)), 0);
          const taxAmount = inv.taxRate ? subtotal * (inv.taxRate / 100) : 0;

          return {
            oldId: inv.id,
            invoiceNumber: inv.id,
            customerId: customerMap[inv.clientId] || '',
            date: inv.date,
            dueDate: inv.dueDate,
            subtotal: subtotal,
            taxAmount: taxAmount,
            total: inv.total || (subtotal + taxAmount),
            status: inv.status || 'draft',
            notes: inv.notes || '',
            taxRate: inv.taxRate || 0,
            discount: inv.discount || 0,
            items: (inv.items || []).map((item: any) => ({
              description: item.description || '',
              quantity: item.hours || item.quantity || 1,
              unitPrice: item.rate || item.unitPrice || 0,
              partNumber: (item.id || '').replace('QT-', '').replace(/-\d+$/, ''),
            })),
          };
        });
        const resp = await bridgeFetch('import-invoices', { invoices: invoicePayload });
        result.invoices.pushed = resp.count || 0;

        // Build invoice ID map for payments
        const invoiceMap: Record<string, string> = {};
        if (resp.invoices || resp.results) {
          const results = resp.invoices || resp.results;
          invoices.forEach((inv: any, idx: number) => {
            if (results[idx]) {
              invoiceMap[inv.id] = results[idx].newId;
            }
          });
        }
        (window as any).__bridgeInvoiceMap = invoiceMap;
      } catch (err: any) {
        result.invoices.failed = invoices.length;
        result.errors.push('Invoices: ' + err.message);
      }
    }

    // ── Step 3: Push Inventory ──
    onProgress?.({ stage: 'inventory', detail: 'Loading inventory...', percent: 50 });
    let inventory: any[] = [];
    try {
      inventory = await db.getInventory(username);
    } catch { inventory = []; }

    if (inventory.length > 0) {
      // Batch in groups of 250 to avoid timeouts
      const BATCH = 250;
      let pushed = 0;
      let failed = 0;
      for (let i = 0; i < inventory.length; i += BATCH) {
        const batch = inventory.slice(i, i + BATCH);
        const batchNum = Math.floor(i / BATCH) + 1;
        const totalBatches = Math.ceil(inventory.length / BATCH);
        const pct = 50 + Math.round((i / inventory.length) * 25);
        onProgress?.({ stage: 'inventory', detail: `Pushing inventory batch ${batchNum}/${totalBatches} (${batch.length} items)...`, percent: pct });

        try {
          const itemPayload = batch.map((item: any) => ({
            partNo: item.partNo || '',
            description: item.description || '',
            price: item.originalPrice || 0,
            imageUrl: item.imageUrl || '',
            quantity: 1,
          }));
          const resp = await bridgeFetch('import-items', { items: itemPayload });
          pushed += resp.count || 0;
        } catch (err: any) {
          failed += batch.length;
          result.errors.push(`Inventory batch ${batchNum}: ${err.message}`);
        }
      }
      result.inventory.pushed = pushed;
      result.inventory.failed = failed;
    }

    // ── Step 4: Push Payments ──
    onProgress?.({ stage: 'payments', detail: 'Loading payments...', percent: 80 });
    let payments: any[] = [];
    try {
      payments = await db.getPayments(username);
    } catch { payments = []; }

    const invoiceMap = (window as any).__bridgeInvoiceMap || {};

    if (payments.length > 0) {
      onProgress?.({ stage: 'payments', detail: `Pushing ${payments.length} payments...`, percent: 85 });
      try {
        const paymentPayload = payments.map((p: any) => ({
          oldId: p.id,
          invoiceId: invoiceMap[p.invoiceId] || '',
          customerId: customerMap[p.clientId] || '',
          amount: p.amount || 0,
          date: p.date || new Date().toISOString(),
          method: p.method || 'wire',
          reference: p.id || '',
          notes: 'Synced from Iron Hub 6.0',
        }));
        const resp = await bridgeFetch('import-payments', { payments: paymentPayload });
        result.payments.pushed = resp.count || 0;
      } catch (err: any) {
        result.payments.failed = payments.length;
        result.errors.push('Payments: ' + err.message);
      }
    }

    onProgress?.({ stage: 'done', detail: 'Sync complete!', percent: 100 });
    result.success = result.errors.length === 0;

  } catch (err: any) {
    result.success = false;
    result.errors.push('Fatal: ' + err.message);
    onProgress?.({ stage: 'error', detail: err.message, percent: 0 });
  }

  // Cleanup
  delete (window as any).__bridgeCustomerMap;
  delete (window as any).__bridgeInvoiceMap;

  return result;
}

/**
 * Quick connectivity check to verify bridge API is reachable
 */
export async function checkBridgeConnection(): Promise<boolean> {
  try {
    const res = await fetch(`${SUITE_BASE}/api/bridge/diag`, {
      headers: { 'X-API-Key': API_KEY },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
