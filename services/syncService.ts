/**
 * IronSuite Sync Service
 *
 * Handles one-way sync from Iron Hub 6.0 → IronSuite (Replit app).
 * Routes ALL requests through Cloudflare Pages Function proxy.
 * Sends data in batches per category to avoid HTTP 413 (payload too large).
 */

export interface SyncResult {
  user: string;
  timestamp: string;
  totalSynced: number;
  totalFailed: number;
  results: Record<string, { success: number; failed: number; errors: string[] }>;
}

/**
 * Attempt login to IronSuite via our proxy.
 */
export async function loginToIronSuite(username: string, password: string): Promise<{ success: boolean; sessionCookie?: string; user?: any; error?: string; note?: string; debug?: any }> {
  try {
    const response = await fetch('/api/ironsuite-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return await response.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Sync all data from Iron Hub 6.0 → IronSuite via Cloudflare proxy.
 * Sends each data category as a separate request to avoid 413 errors.
 * Further chunks large categories (like inventory) into batches of 50.
 */
export async function syncToIronSuite(
  syncData: Record<string, any>,
  sessionCookie: string,
  onProgress?: (message: string) => void
): Promise<SyncResult> {
  const BATCH_SIZE = 50;

  const results: SyncResult = {
    user: 'unknown',
    timestamp: new Date().toISOString(),
    totalSynced: 0,
    totalFailed: 0,
    results: {},
  };

  // Categories to sync
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
        // Send only this category's batch
        const payload: Record<string, any> = {};
        payload[key] = batch;

        const response = await fetch('/api/sync-to-ironsuite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionCookie, syncData: payload }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
          categoryResult.failed += batch.length;
          categoryResult.errors.push(`${batchLabel}: ${errorData.error || `HTTP ${response.status}`}`);
          continue;
        }

        const batchResult = await response.json();

        // Aggregate results from this batch
        for (const [, val] of Object.entries(batchResult.results || {})) {
          const v = val as any;
          categoryResult.success += v.success || 0;
          categoryResult.failed += v.failed || 0;
          if (v.errors?.length) categoryResult.errors.push(...v.errors.slice(0, 3));
        }

        // Update user info if available
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
