import type { QuoteItem, User } from '../types.ts';
import type { ReconciliationFigures } from './quoteReadiness.ts';

const QUOTE_IMPORT_EVENT = 'iron-hub:quote-imported';
const IMPORT_TTL_MS = 60_000;

type QuoteImportRecord = {
  id: string;
  workspaceKey: string;
  createdAt: number;
  items: QuoteItem[];
  /** Totals read off the source document, when it printed any.  Never recomputed. */
  figures?: ReconciliationFigures;
};

let latestImport: QuoteImportRecord | null = null;

export function quoteImportWorkspaceKey(user: User): string {
  return `${user.workspaceId}:${user.username}`;
}

export function publishQuoteImport(user: User, items: QuoteItem[], figures?: ReconciliationFigures): void {
  const record: QuoteImportRecord = {
    id: crypto.randomUUID(),
    workspaceKey: quoteImportWorkspaceKey(user),
    createdAt: Date.now(),
    items: items.map((item) => ({ ...item })),
    figures,
  };
  latestImport = record;
  window.dispatchEvent(new CustomEvent<QuoteImportRecord>(QUOTE_IMPORT_EVENT, { detail: record }));
}

export function subscribeToQuoteImports(
  user: User,
  onImport: (record: QuoteImportRecord) => void,
): () => void {
  const workspaceKey = quoteImportWorkspaceKey(user);
  const accept = (record: QuoteImportRecord | null) => {
    if (!record || record.workspaceKey !== workspaceKey || Date.now() - record.createdAt > IMPORT_TTL_MS) return;
    onImport(record);
  };
  const handleImport = (event: Event) => accept((event as CustomEvent<QuoteImportRecord>).detail);
  window.addEventListener(QUOTE_IMPORT_EVENT, handleImport);
  accept(latestImport);
  return () => window.removeEventListener(QUOTE_IMPORT_EVENT, handleImport);
}
