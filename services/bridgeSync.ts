/**
 * Bridge Sync Service — neutered (C-4 follow-up)
 *
 * Previously POSTed accounts, invoices, inventory, and payments to
 * https://suite.fixmyiron.com/api/bridge/* using a hardcoded
 * X-API-Key shipped in the public client bundle. Anyone reading the
 * built JS could call those bridge endpoints with the same key.
 *
 * Stubbed out so the UI keeps compiling. Re-enable behind a server-side
 * proxy (POST /api/crm/sync on iron-hub-api) that holds the key as a
 * secret and authenticates the calling user — see Round 3.
 */

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

export async function pushToSuite(
  _db: any,
  _username: string,
  onProgress?: (p: BridgeSyncProgress) => void
): Promise<BridgeSyncResult> {
  onProgress?.({
    stage: 'disabled',
    detail: 'Bridge sync is temporarily disabled (security remediation 2026-05-01).',
    percent: 0,
  });
  return {
    success: false,
    timestamp: new Date().toISOString(),
    accounts: { pushed: 0, failed: 0 },
    invoices: { pushed: 0, failed: 0 },
    inventory: { pushed: 0, failed: 0 },
    payments: { pushed: 0, failed: 0 },
    errors: ['Bridge sync to suite.fixmyiron.com is disabled until the server-side proxy ships. Use Import/Export for now.'],
  };
}

export async function checkBridgeConnection(): Promise<boolean> {
  return false;
}
