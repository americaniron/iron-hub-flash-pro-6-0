/**
 * Session-bound Iron Hub -> IronSuite reconciliation.
 *
 * The iframe is served from the Suite origin, where the Worker issues an
 * HttpOnly Hub session. This client never receives a bridge API key; every
 * request is authorized by that session and scoped by the Worker to one
 * organization and user.
 */

const DATA_ENDPOINT = '/api/data';
const STATUS_ENDPOINT = '/api/data-status';
const MAX_BATCH_SIZE = 50;

type SyncStore = 'accounts' | 'quotes' | 'invoices' | 'payments' | 'inventory';

type HubDataRepository = {
  exportAllUserData(username: string): Promise<Record<string, unknown>>;
  markCanonicalStoresSynchronized?: (username: string, stores: string[]) => Promise<void>;
};

export interface BridgeSyncProgress {
  stage: string;
  detail: string;
  percent: number;
}

export interface BridgeSyncResult {
  success: boolean;
  timestamp: string;
  accounts: { pushed: number; failed: number };
  quotes: { pushed: number; failed: number };
  invoices: { pushed: number; failed: number };
  inventory: { pushed: number; failed: number };
  payments: { pushed: number; failed: number };
  errors: string[];
}

const emptyResult = (): BridgeSyncResult => ({
  success: true,
  timestamp: new Date().toISOString(),
  accounts: { pushed: 0, failed: 0 },
  quotes: { pushed: 0, failed: 0 },
  invoices: { pushed: 0, failed: 0 },
  inventory: { pushed: 0, failed: 0 },
  payments: { pushed: 0, failed: 0 },
  errors: [],
});

function chunks<T>(items: T[]): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += MAX_BATCH_SIZE) {
    batches.push(items.slice(index, index + MAX_BATCH_SIZE));
  }
  return batches;
}

async function readError(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({})) as { error?: unknown; message?: unknown };
  return String(body.error || body.message || `HTTP ${response.status}`);
}

async function synchronizeStore(
  store: SyncStore,
  records: unknown[],
  result: BridgeSyncResult,
  step: number,
  totalSteps: number,
  onProgress?: (progress: BridgeSyncProgress) => void,
): Promise<void> {
  const destination = result[store];
  if (records.length === 0) {
    onProgress?.({ stage: store, detail: `No ${store} to synchronize`, percent: Math.round((step / totalSteps) * 100) });
    return;
  }

  const batches = chunks(records);
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const progress = Math.round(((step + (batchIndex / batches.length)) / totalSteps) * 100);
    onProgress?.({
      stage: store,
      detail: `Synchronizing ${store}: ${Math.min((batchIndex + 1) * MAX_BATCH_SIZE, records.length)} of ${records.length}`,
      percent: progress,
    });

    try {
      const response = await fetch(DATA_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store, data: batch }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        destination.failed += batch.length;
        result.errors.push(`${store}: ${await readError(response)}`);
        continue;
      }
      destination.pushed += batch.length;
    } catch (error) {
      destination.failed += batch.length;
      result.errors.push(`${store}: ${error instanceof Error ? error.message : 'network request failed'}`);
    }
  }
}

export async function pushToSuite(
  db: HubDataRepository,
  username: string,
  onProgress?: (progress: BridgeSyncProgress) => void,
): Promise<BridgeSyncResult> {
  const result = emptyResult();
  const data = await db.exportAllUserData(username);
  const orderedStores: SyncStore[] = ['accounts', 'quotes', 'invoices', 'payments', 'inventory'];

  onProgress?.({ stage: 'preparing', detail: 'Preparing canonical Suite records', percent: 0 });
  for (let index = 0; index < orderedStores.length; index += 1) {
    const store = orderedStores[index];
    const records = Array.isArray(data[store]) ? data[store] : [];
    await synchronizeStore(store, records, result, index, orderedStores.length, onProgress);
    if (records.length > 0 && result[store].failed === 0 && result[store].pushed === records.length) {
      await db.markCanonicalStoresSynchronized?.(username, [store]);
    }
  }

  result.success = result.errors.length === 0;
  onProgress?.({
    stage: result.success ? 'complete' : 'complete-with-errors',
    detail: result.success ? 'Iron Hub and IronSuite are synchronized' : 'Some records need another synchronization attempt',
    percent: 100,
  });
  return result;
}

export async function checkBridgeConnection(): Promise<boolean> {
  try {
    const response = await fetch(STATUS_ENDPOINT, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return false;
    const body = await response.json() as { serverStorage?: unknown; canonicalSuiteData?: unknown };
    return body.serverStorage === true && body.canonicalSuiteData === true;
  } catch {
    return false;
  }
}
