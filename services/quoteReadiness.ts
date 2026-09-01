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
import { QuoteItem, SavedQuote } from '../types.ts';

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
