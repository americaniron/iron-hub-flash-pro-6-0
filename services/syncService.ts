/**
 * IronSuite Sync Service
 *
 * Handles one-way sync from Iron Hub 6.0 → IronSuite (Replit app).
 * Routes ALL requests through Cloudflare Pages Function proxies to avoid CORS issues.
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
 * Returns the session cookie string if successful.
 */
export async function loginToIronSuite(username: string, password: string): Promise<{ success: boolean; sessionCookie?: string; user?: any; error?: string; hint?: string }> {
  try {
    const response = await fetch('/api/ironsuite-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Verify a session cookie works by checking /api/auth/me through proxy.
 */
export async function verifySessionCookie(sessionCookie: string): Promise<{ valid: boolean; user?: any }> {
  try {
    const response = await fetch('/api/sync-to-ironsuite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionCookie, syncData: {}, verifyOnly: true }),
    });

    // If we get a 200 back even with empty data, the session is valid
    if (response.ok) {
      const data = await response.json();
      return { valid: true, user: data.user };
    }
    return { valid: false };
  } catch {
    return { valid: false };
  }
}

/**
 * Sync all data from Iron Hub 6.0 → IronSuite via Cloudflare proxy.
 * The proxy handles auth and CORS — we just send the data + session cookie.
 */
export async function syncToIronSuite(
  syncData: Record<string, any>,
  sessionCookie: string,
  onProgress?: (message: string) => void
): Promise<SyncResult> {
  onProgress?.('Sending data to sync proxy...');

  try {
    const response = await fetch('/api/sync-to-ironsuite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionCookie, syncData }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(errorData.error || `Sync proxy returned ${response.status}`);
    }

    const result = await response.json();

    onProgress?.('Sync complete!');

    // Normalize the result to match our SyncResult interface
    return {
      user: result.user || 'unknown',
      timestamp: result.timestamp || new Date().toISOString(),
      totalSynced: result.totalSynced || 0,
      totalFailed: result.totalFailed || 0,
      results: normalizeResults(result.results || {}),
    };
  } catch (err: any) {
    throw new Error(`Sync failed: ${err.message}`);
  }
}

function normalizeResults(raw: Record<string, any>): Record<string, { success: number; failed: number; errors: string[] }> {
  const normalized: Record<string, { success: number; failed: number; errors: string[] }> = {};
  for (const [key, val] of Object.entries(raw)) {
    normalized[key] = {
      success: (val as any).success || 0,
      failed: (val as any).failed || 0,
      errors: (val as any).errors || [],
    };
  }
  return normalized;
}
