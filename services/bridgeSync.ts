/**
 * Session-bound Iron Hub -> IronSuite reconciliation.
 *
 * The iframe is served from the Suite origin, where the Worker issues an
 * HttpOnly Hub session. This client never receives a bridge API key; every
 * request is authorized by that session and scoped by the Worker to one
 * organization and user.
 */
import { hubApiFetch } from './hubApi.ts';

import { sanitizeInventoryForServer } from './dbService.ts';
import type { InventoryPart } from '../types.ts';

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
      const response = await hubApiFetch(DATA_ENDPOINT, {
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
    const rawRecords = Array.isArray(data[store]) ? data[store] as unknown[] : [];
    // The Suite Worker rejects base64 data: image URLs on the canonical
    // inventory endpoint (422) — send part data without them.
    const records = store === 'inventory'
      ? sanitizeInventoryForServer(rawRecords as InventoryPart[])
      : rawRecords;
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

export interface BridgeStoreHealth {
  lastSuccessAt: string | null;
  lastSuccessRecords: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  pendingRecords: number;
  state: 'healthy' | 'degraded' | 'unknown';
}

export interface BridgeHealth {
  reachable: boolean;
  status: 'connected' | 'degraded' | 'unavailable';
  pendingRecords: number;
  lastError: { store: string | null; message: string; at: string } | null;
  stores: Record<string, BridgeStoreHealth>;
  checkedAt: string | null;
}

const UNREACHABLE: BridgeHealth = {
  reachable: false,
  status: 'unavailable',
  pendingRecords: 0,
  lastError: null,
  stores: {},
  checkedAt: null,
};

/**
 * Real synchronization health.
 *
 * The Suite used to answer this endpoint with a hardcoded
 * `{ serverStorage: true, canonicalSuiteData: true }`, so the badge this drives was green even
 * while every write was being rejected. It now reports per-store outcomes, and this reads them:
 * "reachable" and "healthy" are two different questions and are answered separately.
 */
export async function getBridgeHealth(): Promise<BridgeHealth> {
  try {
    const response = await hubApiFetch(STATUS_ENDPOINT, { signal: AbortSignal.timeout(8_000) });
    const body = await response.json().catch(() => ({})) as Partial<BridgeHealth> & {
      serverStorage?: unknown;
      canonicalSuiteData?: unknown;
    };
    const reachable = body.serverStorage === true && body.canonicalSuiteData === true;
    if (!response.ok && !reachable) {
      return {
        ...UNREACHABLE,
        lastError: body.lastError ?? { store: null, message: `HTTP ${response.status}`, at: new Date().toISOString() },
        checkedAt: body.checkedAt ?? new Date().toISOString(),
      };
    }
    return {
      reachable,
      status: body.status === 'connected' || body.status === 'degraded' || body.status === 'unavailable' ? body.status : reachable ? 'connected' : 'unavailable',
      pendingRecords: Number(body.pendingRecords) || 0,
      lastError: body.lastError ?? null,
      stores: (body.stores as Record<string, BridgeStoreHealth>) ?? {},
      checkedAt: body.checkedAt ?? new Date().toISOString(),
    };
  } catch {
    return UNREACHABLE;
  }
}

/** Can we write at all? Distinct from "is everything healthy" — a degraded bridge still accepts writes. */
export async function checkBridgeConnection(): Promise<boolean> {
  return (await getBridgeHealth()).reachable;
}
