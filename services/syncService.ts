/**
 * IronSuite Sync Service
 *
 * Handles one-way sync from Iron Hub 6.0 → IronSuite (Replit app).
 * Routes through Cloudflare proxy which handles login + sync in one request.
 * No cookie extraction needed — credentials are sent with each batch.
 */

export interface SyncResult {
  user: string;
  timestamp: string;
  totalSynced: number;
  totalFailed: number;
  results: Record<string, { success: number; failed: number; errors: string[] }>;
}

/**
 * Verify IronSuite credentials by doing a test sync with empty data.
 */
export async function verifyIronSuiteLogin(username: string, password: string): Promise<{ success: boolean; user?: any; error?: string }> {
  try {
    const response = await fetch('/api/sync-to-ironsuite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, syncData: {} }),
    });
    const data = await response.json();
    if (response.ok) {
      return { success: true, user: data.user };
    }
    return { success: false, error: data.error || `HTTP ${response.status}` };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Sync all data from Iron Hub 6.0 → IronSuite via Cloudflare proxy.
 * Sends credentials + data batch per category.
 * The proxy handles login + push in a single server-side request.
 */
export async function syncToIronSuite(
  syncData: Record<string, any>,
  username: string,
  password: string,
  onProgress?: (message: string) => void
): Promise<SyncResult> {
  const BATCH_SIZE = 10;

  const results: SyncResult = {
    user: 'unknown',
    timestamp: new Date().toISOString(),
    totalSynced: 0,
    totalFailed: 0,
    results: {},
  };

  const categories = [
    { key: 'accounts', label: 'Accounts' },
    { key: 'quotes', label: 'Quotes' },
    { key: 'invoices', label: 'Invoices' },
    { key: 'payments', label: 'Payments' },
    { key: 'inventory', label: 'Inventory' },
  ];

  for (const { key, label } of categories) {
    const items = syncData[key];
    if (!items || !Array.isArray(items) || items.length === 0) continue;

    // Split into batches
    const batches: any[][] = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      batches.push(items.slice(i, i + BATCH_SIZE));
    }

    const categoryResult = { success: 0, failed: 0, errors: [] as string[] };

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const batchLabel = batches.length > 1
        ? `${label} (batch ${b + 1}/${batches.length})`
        : label;

      onProgress?.(`Syncing ${batchLabel}... (${batch.length} items)`);

      try {
        const payload: Record<string, any> = {};
        payload[key] = batch;

        const response = await fetch('/api/sync-to-ironsuite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, syncData: payload }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
          categoryResult.failed += batch.length;
          categoryResult.errors.push(`${batchLabel}: ${errorData.error || `HTTP ${response.status}`}`);
          continue;
        }

        const batchResult = await response.json();

        for (const [, val] of Object.entries(batchResult.results || {})) {
          const v = val as any;
          categoryResult.success += v.success || 0;
          categoryResult.failed += v.failed || 0;
          if (v.errors?.length) categoryResult.errors.push(...v.errors.slice(0, 3));
        }

        if (batchResult.user && batchResult.user !== 'unknown') {
          results.user = batchResult.user;
        }
      } catch (err: any) {
        categoryResult.failed += batch.length;
        categoryResult.errors.push(`${batchLabel}: ${err.message}`);
      }
    }

    results.results[key] = categoryResult;
    results.totalSynced += categoryResult.success;
    results.totalFailed += categoryResult.failed;
    onProgress?.(`${label}: ${categoryResult.success} synced, ${categoryResult.failed} failed`);
  }

  onProgress?.('Sync complete!');
  return results;
}
