/**
 * The gate between a quote with an incomplete line and anything that leaves this app.
 *
 * The parser can now tell the difference between a part number it read wrong and one the source
 * document never printed, and it keeps the second kind rather than inventing a value or dropping
 * a real charge.  That is the right call at import — a $24.46 line on a supplier invoice is real
 * money whether or not the supplier filled in the part-number column — but it means a quote can
 * legitimately hold an item with no part number.
 *
 * An import-time warning is not enough on its own: it is dismissed in five seconds and the quote
 * lives on.  So the blank has to be blocked where it would actually cause harm — at the points
 * where the quote becomes a PDF, a message, an invoice, or an IronSuite record.  Saving and
 * editing stay open, because the fix-it-later workflow is the whole reason the line was kept.
 */
import { QuoteItem, ReconciliationAcknowledgement, SavedQuote } from '../types.ts';

/**
 * A quote holding a line item with no part number is a `draft`.
 *
 * "draft" rather than a new word: `InvoiceData.status` already uses it and the IronSuite export
 * already emits it as a Status column value, so the concept is reused rather than invented.  A
 * draft saves and reloads freely — losing imported work would be a worse failure than the blank
 * itself — but it never reaches a customer, an invoice, or IronSuite, and it cannot be promoted
 * until the blank is filled.  Quotes archived before this existed have no `status` and are
 * treated as ready, which is correct: they predate the concept and were already exportable.
 */
export type QuoteStatus = 'draft' | 'ready';

export function quoteStatusFor(items: readonly QuoteItem[]): QuoteStatus {
  return itemsMissingPartNumbers(items).length ? 'draft' : 'ready';
}

export function isDraftQuote(quote: Pick<SavedQuote, 'status' | 'payload'> | null | undefined): boolean {
  if (!quote) return false;
  if (quote.status === 'draft') return true;
  // Fall back to the items themselves, so an archive written before `status` existed — or by an
  // older build still in someone's browser — is still judged correctly.
  return itemsMissingPartNumbers(quote.payload?.items ?? []).length > 0;
}

/** Items whose part number the document never supplied and nobody has filled in since. */
export function itemsMissingPartNumbers(items: readonly QuoteItem[]): QuoteItem[] {
  return (items ?? []).filter((item) => !String(item?.partNo ?? '').trim());
}

/**
 * A message naming what has to be fixed, or null when the quote is clear to leave the app.
 * `action` is folded into the sentence, e.g. "sent" -> "before this quote can be sent".
 */
export function quoteReadinessError(items: readonly QuoteItem[], action: string): string | null {
  const blank = itemsMissingPartNumbers(items);
  if (!blank.length) return null;

  const labels = blank
    .map((item, index) => item.lineNo || item.desc?.slice(0, 32) || `item ${index + 1}`)
    .slice(0, 5);
  const suffix = blank.length > labels.length ? `, and ${blank.length - labels.length} more` : '';
  return (
    `${blank.length} line item${blank.length === 1 ? '' : 's'} ${blank.length === 1 ? 'has' : 'have'} no part number ` +
    `(${labels.join(', ')}${suffix}). Fill in the part number${blank.length === 1 ? '' : 's'} before this quote can be ${action}.`
  );
}

/** The same check against an archived quote, for the bulk IronSuite push. */
export function savedQuoteReadinessError(quote: SavedQuote, action: string): string | null {
  return quoteReadinessError(quote?.payload?.items ?? [], action);
}


// --- Reconciliation acknowledgement ----------------------------------------------------------

/** The figures an acknowledgement is about.  Kept minimal so the fingerprint stays stable. */
export interface ReconciliationFigures {
  itemsTotal: number;
  subtotal?: number;
  shipping?: number;
  tax?: number;
  total?: number;
}

/**
 * FNV-1a over the numbers that matter.
 *
 * An acknowledgement is only valid for the exact figures it was given, so editing a price, a
 * quantity or a line has to invalidate it.  Non-cryptographic on purpose: this detects change,
 * it does not defend against tampering.
 */
export function reconciliationFingerprint(
  items: readonly QuoteItem[],
  figures: ReconciliationFigures,
): string {
  const canonical = [
    ...(items ?? []).map((item) =>
      [item.partNo ?? '', item.qty ?? 0, item.unitPrice ?? 0, item.extendedPrice ?? '', item.coreDeposit ?? 0].join(':'),
    ),
    `T${figures.itemsTotal ?? 0}`,
    `S${figures.subtotal ?? ''}`,
    `H${figures.shipping ?? ''}`,
    `X${figures.tax ?? ''}`,
    `G${figures.total ?? ''}`,
  ].join('|');

  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** True when `ack` was given for exactly these figures. */
export function acknowledgementCovers(
  ack: ReconciliationAcknowledgement | null | undefined,
  fingerprint: string,
): boolean {
  return Boolean(ack && ack.fingerprint === fingerprint);
}

/**
 * The confirmation text.
 *
 * States the actual figures rather than "totals do not match": the point of asking is that the
 * person can see the gap and judge it, and the redacted-price fixture proves a legitimate
 * document can fail to reconcile.
 */
export function formatReconciliationPrompt(
  figures: ReconciliationFigures,
  action: string,
): string {
  const money = (value: number | undefined) =>
    value === undefined ? null : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const lines: string[] = ['This quote does not reconcile against the totals printed on the source document.', ''];
  lines.push(`  Line items total:   ${money(figures.itemsTotal)}`);
  if (figures.shipping) lines.push(`  Shipping:           ${money(figures.shipping)}`);
  if (figures.tax) lines.push(`  Tax:                ${money(figures.tax)}`);
  const charges = (figures.itemsTotal ?? 0) + (figures.shipping ?? 0) + (figures.tax ?? 0);
  if (figures.subtotal !== undefined) lines.push(`  Printed subtotal:   ${money(figures.subtotal)}`);
  if (figures.total !== undefined) {
    lines.push(`  Printed total:      ${money(figures.total)}`);
    const gap = Math.round((charges - figures.total) * 100) / 100;
    lines.push('', `  Gap:                ${gap > 0 ? '+' : ''}${money(gap)}`);
  } else if (figures.subtotal !== undefined) {
    const gap = Math.round((figures.itemsTotal - figures.subtotal) * 100) / 100;
    lines.push('', `  Gap:                ${gap > 0 ? '+' : ''}${money(gap)}`);
  }
  lines.push(
    '',
    'A line item may be missing or misread. Nothing has been adjusted automatically.',
    `Acknowledge this mismatch and continue to ${action}?`,
  );
  return lines.join('\n');
}
