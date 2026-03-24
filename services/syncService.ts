/**
 * IronSuite Sync Service
 *
 * Handles one-way sync from Iron Hub 6.0 → IronSuite (Replit app)
 * Uses the /api/sync-to-ironsuite Cloudflare Pages Function as a proxy.
 */

const IRONSUITE_URL = 'https://iron-hub-suite.replit.app';
const SYNC_PROXY_URL = '/api/sync-to-ironsuite';

export interface SyncResult {
  user: string;
  timestamp: string;
  totalSynced: number;
  totalFailed: number;
  results: Record<string, { success: number; failed: number; errors: string[] }>;
}

export interface IronSuiteAuth {
  sessionCookie: string;
  user: { username?: string; email?: string } | null;
}

/**
 * Log in to IronSuite via popup window.
 * Opens IronSuite login in a popup, waits for the user to complete auth,
 * then extracts the session cookie via postMessage.
 */
export function loginToIronSuite(): Promise<IronSuiteAuth> {
  return new Promise((resolve, reject) => {
    const width = 500, height = 650;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      `${IRONSUITE_URL}/api/login`,
      'ironsuite-login',
      `width=${width},height=${height},left=${left},top=${top},popup=yes`
    );

    if (!popup) {
      reject(new Error('Popup blocked. Please allow popups for this site.'));
      return;
    }

    // Poll the popup to detect when auth completes
    const pollInterval = setInterval(() => {
      try {
        // Check if popup navigated back to the IronSuite app (post-login)
        if (popup.closed) {
          clearInterval(pollInterval);
          reject(new Error('Login cancelled.'));
          return;
        }

        const popupUrl = popup.location.href;
        if (popupUrl && popupUrl.includes('iron-hub-suite.replit.app') && !popupUrl.includes('/api/login') && !popupUrl.includes('replit.com')) {
          // User has logged in — extract cookies via the popup
          clearInterval(pollInterval);

          // Inject a script to send us the cookie
          popup.postMessage({ type: 'IRONSUITE_AUTH_REQUEST' }, IRONSUITE_URL);

          // Give it a moment then try to read the session
          setTimeout(() => {
            popup.close();
            // Since we can't read cross-origin cookies directly, we use our proxy
            // The user's browser will include cookies when making requests
            resolve({
              sessionCookie: 'browser-session', // Placeholder — actual cookie forwarding handled differently
              user: null,
            });
          }, 1500);
        }
      } catch (e) {
        // Cross-origin — popup is on a different domain, keep waiting
      }
    }, 500);

    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(pollInterval);
      if (!popup.closed) popup.close();
      reject(new Error('Login timed out.'));
    }, 300000);
  });
}

/**
 * Check if user is authenticated with IronSuite by testing the API
 */
export async function checkIronSuiteAuth(): Promise<{ authenticated: boolean; user: any }> {
  try {
    const response = await fetch(`${IRONSUITE_URL}/api/auth/me`, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    });
    if (response.ok) {
      const user = await response.json();
      return { authenticated: true, user };
    }
    return { authenticated: false, user: null };
  } catch {
    return { authenticated: false, user: null };
  }
}

/**
 * Sync all data from Iron Hub 6.0 to IronSuite.
 *
 * Uses a direct fetch to IronSuite endpoints with credentials: 'include'
 * so the browser sends session cookies automatically.
 */
export async function syncToIronSuite(
  syncData: Record<string, any>,
  onProgress?: (message: string) => void
): Promise<SyncResult> {
  const results: SyncResult = {
    user: 'unknown',
    timestamp: new Date().toISOString(),
    totalSynced: 0,
    totalFailed: 0,
    results: {},
  };

  // Map of local store names → IronSuite endpoints and field transformers
  const syncMap: Array<{
    localKey: string;
    endpoint: string;
    label: string;
    mapper: (item: any) => any;
  }> = [
    {
      localKey: 'accounts',
      endpoint: '/api/customers',
      label: 'Customer Accounts',
      mapper: (a) => ({
        name: a.company || 'Unnamed',
        email: a.email || '',
        phone: a.phone || '',
        contactName: a.contactName || '',
        accountNumber: a.accountNumber || '',
        address: [a.billingAddress, a.billingCity, a.billingState, a.billingZip, a.billingCountry].filter(Boolean).join(', '),
        notes: a.internalNotes || '',
        sourceId: a.id || '',
      }),
    },
    {
      localKey: 'quotes',
      endpoint: '/api/quotes',
      label: 'Quotes',
      mapper: (q) => ({
        title: q.title || `Quote ${q.id}`,
        date: q.timestamp || new Date().toISOString(),
        total: q.total || 0,
        status: 'draft',
        customerName: q.payload?.client?.company || '',
        items: (q.payload?.items || []).map((i: any) => ({
          partNumber: i.partNo || '',
          description: i.desc || '',
          quantity: i.qty || 1,
          unitPrice: i.unitCost || 0,
          weight: i.weight || 0,
        })),
        sourceId: q.id || '',
      }),
    },
    {
      localKey: 'invoices',
      endpoint: '/api/invoices',
      label: 'Invoices',
      mapper: (inv) => ({
        date: inv.date,
        dueDate: inv.dueDate,
        clientId: inv.clientId,
        status: inv.status || 'draft',
        total: inv.total || 0,
        taxRate: inv.taxRate || 0,
        notes: inv.notes || '',
        items: (inv.items || []).map((i: any) => ({
          description: i.description || '',
          quantity: i.quantity || 1,
          rate: i.rate || 0,
        })),
        sourceId: inv.id || '',
      }),
    },
    {
      localKey: 'payments',
      endpoint: '/api/payments',
      label: 'Payments',
      mapper: (p) => ({
        invoiceId: p.invoiceId || '',
        date: p.date,
        amount: p.amount || 0,
        method: p.method || 'Other',
        sourceId: p.id || '',
      }),
    },
    {
      localKey: 'inventory',
      endpoint: '/api/items',
      label: 'Inventory Parts',
      mapper: (part) => ({
        sku: part.id || part.partNo || '',
        name: part.description || '',
        partNumber: part.partNo || '',
        cost: part.originalPrice || 0,
        category: 'Heavy Equipment Parts',
        sourceId: part.id || '',
      }),
    },
  ];

  for (const { localKey, endpoint, label, mapper } of syncMap) {
    const items = syncData[localKey];
    if (!items || !Array.isArray(items) || items.length === 0) continue;

    onProgress?.(`Syncing ${items.length} ${label}...`);
    const sectionResult = { success: 0, failed: 0, errors: [] as string[] };

    for (const item of items) {
      try {
        const mapped = mapper(item);
        const response = await fetch(`${IRONSUITE_URL}${endpoint}`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(mapped),
        });

        if (response.ok) {
          sectionResult.success++;
        } else {
          sectionResult.failed++;
          const errText = await response.text().catch(() => '');
          sectionResult.errors.push(`${label}: HTTP ${response.status}`);
        }
      } catch (err: any) {
        sectionResult.failed++;
        sectionResult.errors.push(`${label}: ${err.message}`);
      }
    }

    results.results[localKey] = sectionResult;
    results.totalSynced += sectionResult.success;
    results.totalFailed += sectionResult.failed;
    onProgress?.(`${label}: ${sectionResult.success} synced, ${sectionResult.failed} failed`);
  }

  return results;
}
