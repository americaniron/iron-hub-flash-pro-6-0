/**
 * Order-level fields from the header and totals blocks.
 *
 * Separate from line-item extraction because the two fail independently: a quote whose table
 * parses perfectly may still have an unreadable totals panel, and neither should take the other
 * down.  Everything here is reported as found; nothing is recomputed.  In particular the total
 * is whatever the document prints, even when the discount plainly has not been subtracted from
 * it — see `appliedOffers`.
 */
import { PageModel, Row, collapseLetterSpacing, groupRows } from './geometry.ts';
import { parseMoney } from './valueShapes.ts';

export interface DocumentSummary {
  subtotal?: number;
  shipping?: number;
  tax?: number;
  total?: number;
  /** Discounts printed on the document.  Never subtracted from `total` — see `warnings`. */
  appliedOffers?: number;
  currency?: string;
  accountNumber?: string;
  dealerStore?: string;
  /** ISO-8601 where the source date was unambiguous, otherwise the printed text. */
  requestByDate?: string;
  estimatedDate?: string;
  orderType?: string;
  orderedBy?: string;
  orderedByEmail?: string;
  orderedByPhone?: string;
  warnings: string[];
}

/** The first properly-formed money amount in a string: "$6,808.54", "-$600.00", "24.46". */
function moneyIn(text: string): number | null {
  const match = String(text || '').match(/(-\s*)?\$?\s?\d[\d,]*\.\d{2}/);
  if (!match) return null;
  return parseMoney(match[0]);
}

/**
 * Money for a labelled total.
 *
 * Requires two decimal places rather than "any number", because "TAX (7%)  8,239.67" and
 * "FREIGHT FACTOR ($5.00 / LBS)" both put a bare integer between the label and the real amount —
 * the loose version read the tax on a $129,757.21 quote as 7.
 */
function labelledMoney(rows: readonly Row[], index: number, label: RegExp): number | null {
  const text = collapseLetterSpacing(rows[index].text);
  const match = text.match(label);
  if (match) {
    const after = moneyIn(text.slice((match.index ?? 0) + match[0].length));
    if (after !== null) return after;
  }
  // Chrome's print layout puts "Total" on one band and "$2,086.82 USD" on the next.
  for (const offset of [1, -1, 2, -2, 3]) {
    const row = rows[index + offset];
    if (!row) continue;
    const money = moneyIn(collapseLetterSpacing(row.text));
    if (money !== null) return money;
  }
  return null;
}

/** Words that introduce a field, so a lookahead does not mistake the next label for a value. */
const LABEL_PHRASES =
  /^(?:account\s+number|dealer\s+store|order\s+type|ordered\s+by|request\s+by\s+date|estimated\s+(?:pickup|delivery)\s+date|pickup\s+(?:address|method|instructions)|delivery\s+(?:address|method|instructions)|billing\s+(?:address|method)|payment\s+information|order\s+information|important\s+dates)\b/i;

/**
 * The value belonging to a label, searched in the order the layouts actually use it.
 *
 * 1. Inside the label's own text item — Parts.Cat.Com prints "Request By Date: 9/9/26" as one run.
 * 2. To the right on the same row — BOYD's template is label-left, value-right.
 * 3. Directly beneath, in the label's own x band — the September order stacks "Dealer Store"
 *    above "Tampa".
 *
 * Restricting step 3 to the label's column is the whole point: the rows between a label and its
 * value belong to other columns entirely, so a plain "next row" read returned the pickup address
 * as the account number.
 */
function labelledText(
  rows: readonly Row[],
  index: number,
  label: RegExp,
  labelOrigins: readonly number[] = [],
): string {
  const row = rows[index];
  const labelItem = row.items.find((item) => label.test(collapseLetterSpacing(item.text)));
  if (!labelItem) return '';

  const own = collapseLetterSpacing(labelItem.text);
  const match = own.match(label);
  if (match) {
    const after = own.slice((match.index ?? 0) + match[0].length).replace(/^[:\s-]+/, '').trim();
    if (after) return after;
  }

  // A value never sits underneath a *different* column's label.  The September order prints
  // three label columns side by side (x=18 order info, x=212 pickup, x=407 billing) and the row
  // grouper merges bands a point apart, so "Account Number" and the billing street address land
  // on one row — which is how the account number came back as "13930 N DALE MABRY HWY SUITE".
  const foreignColumn = (x: number) =>
    labelOrigins.some((origin) => Math.abs(origin - x) <= 12 && Math.abs(origin - labelItem.x0) > 12);
  const toTheRight = row.items
    .filter((item) => item.x0 > labelItem.x1 + 2 && item.text.trim() && !foreignColumn(item.x0))
    .sort((a, b) => a.x0 - b.x0);
  if (toTheRight.length) {
    const text = collapseLetterSpacing(toTheRight.map((i) => i.text).join(' ')).trim();
    if (text && !LABEL_PHRASES.test(text)) return text;
  }

  for (let offset = 1; offset <= 3 && index + offset < rows.length; offset++) {
    const candidate = rows[index + offset];
    const inBand = candidate.items
      .filter((item) => Math.abs(item.x0 - labelItem.x0) <= 12 && item.text.trim())
      .sort((a, b) => a.x0 - b.x0);
    if (!inBand.length) continue;
    const text = collapseLetterSpacing(inBand.map((i) => i.text).join(' ')).trim();
    if (!text || LABEL_PHRASES.test(text)) continue;
    return text;
  }
  return '';
}

/** "9/9/26" -> "2026-09-09".  Anything else is returned unchanged. */
export function normalizeShortDate(value: string): string {
  const match = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return String(value || '').trim();
  const [, month, day, rawYear] = match;
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function extractDocumentSummary(pages: readonly PageModel[]): DocumentSummary {
  const summary: DocumentSummary = { warnings: [] };
  const rows: Row[] = [];
  for (const page of pages) rows.push(...groupRows(page));

  // Where each label column begins, so a lookup never crosses into a neighbouring one.
  const labelOrigins: number[] = [];
  for (const row of rows) {
    for (const item of row.items) {
      if (!LABEL_PHRASES.test(collapseLetterSpacing(item.text).trim())) continue;
      if (!labelOrigins.some((origin) => Math.abs(origin - item.x0) <= 12)) labelOrigins.push(item.x0);
    }
  }

  let orderedByRow = -1;

  rows.forEach((row, index) => {
    const text = collapseLetterSpacing(row.text).trim();

    if (summary.subtotal === undefined && /\b(?:order\s+|manifest\s+)?subtotal\b/i.test(text)) {
      summary.subtotal = labelledMoney(rows, index, /\b(?:order\s+|manifest\s+)?subtotal\b:?/i) ?? undefined;
    }
    if (summary.shipping === undefined && /shipping\s*\/?\s*(?:misc|miscellaneous)/i.test(text)) {
      summary.shipping =
        labelledMoney(rows, index, /shipping\s*\/?\s*(?:misc\.?|miscellaneous)\.?:?/i) ?? undefined;
    }
    if (summary.tax === undefined && /\b(?:total\s+)?tax\b/i.test(text)) {
      summary.tax = labelledMoney(rows, index, /\b(?:total\s+)?tax\b(?:\s*\([^)]*\))?:?/i) ?? undefined;
    }
    // Deliberately an explicit list.  A bare /^total/ also matched "Total Tax", "TOTAL WEIGHT"
    // and "TOTAL CORE DEPOSITS", which is how a $15,779.93 quote reported a total of $889.62.
    if (
      summary.total === undefined &&
      /\b(?:order\s+total|total\s+due|grand\s+total|total\s+document\s+value)\b/i.test(text)
    ) {
      summary.total =
        labelledMoney(rows, index, /\b(?:order\s+total|total\s+due|grand\s+total|total\s+document\s+value)\b:?/i) ??
        undefined;
    }
    if (summary.total === undefined && /^total\b/i.test(text) && !/\b(?:tax|weight|core|deposits?)\b/i.test(text)) {
      summary.total = labelledMoney(rows, index, /^total\b:?/i) ?? undefined;
    }
    if (summary.appliedOffers === undefined && /\bapplied\s+offers\b/i.test(text)) {
      const value = labelledMoney(rows, index, /\bapplied\s+offers\b:?[\s-]*/i);
      // Recorded as a positive discount amount regardless of how the document signs it.
      summary.appliedOffers = value === null ? undefined : Math.abs(value);
    }
    if (!summary.currency) {
      const currency = text.match(/\b(USD|CAD|EUR|GBP|AUD)\b/);
      if (currency) summary.currency = currency[1];
    }
    if (!summary.accountNumber && /\baccount\s+number\b/i.test(text)) {
      summary.accountNumber = labelledText(rows, index, /\baccount\s+number\b:?/i, labelOrigins) || undefined;
    }
    if (!summary.dealerStore && /\bdealer\s+store\b/i.test(text)) {
      summary.dealerStore = labelledText(rows, index, /\bdealer\s+store\b:?/i, labelOrigins) || undefined;
    }
    if (!summary.requestByDate && /\brequest\s+by\s+date\b/i.test(text)) {
      const value = labelledText(rows, index, /\brequest\s+by\s+date\b:?/i, labelOrigins);
      summary.requestByDate = value ? normalizeShortDate(value) : undefined;
    }
    if (!summary.estimatedDate && /\bestimated\s+(?:pickup|delivery)\s+date\b/i.test(text)) {
      summary.estimatedDate =
        labelledText(rows, index, /\bestimated\s+(?:pickup|delivery)\s+date\b:?/i, labelOrigins) || undefined;
    }
    if (!summary.orderType && /\border\s+type\b/i.test(text)) {
      summary.orderType = labelledText(rows, index, /\border\s+type\b:?/i, labelOrigins) || undefined;
    }
    if (!summary.orderedBy && /\bordered\s+by\b/i.test(text)) {
      summary.orderedBy = labelledText(rows, index, /\bordered\s+by\b:?/i, labelOrigins) || undefined;
      if (summary.orderedBy) orderedByRow = index;
    }
  });

  // Contact details are only taken from the Ordered By block.  Scanning the whole document
  // picked up the seller's own switchboard number and the customer's, whichever came first.
  if (orderedByRow >= 0) {
    for (let offset = 0; offset <= 4 && orderedByRow + offset < rows.length; offset++) {
      const text = collapseLetterSpacing(rows[orderedByRow + offset].text);
      const email = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
      if (email && !summary.orderedByEmail) summary.orderedByEmail = email[0];
      const phone = text.match(/\+\d[\d\s\-()]{9,}/);
      if (phone && !summary.orderedByPhone) summary.orderedByPhone = phone[0].trim();
    }
  }

  // The discrepancy is surfaced, never resolved: on the September Parts.Cat.Com order the
  // $208.68 of applied offers is not deducted from the $2,086.82 total the document prints.
  // Quoting from a silently "corrected" total would be worse than quoting from a flagged one.
  if (summary.appliedOffers && summary.total !== undefined && summary.subtotal !== undefined) {
    const shipping = summary.shipping ?? 0;
    const withDiscount = Math.round((summary.subtotal + shipping - summary.appliedOffers) * 100) / 100;
    if (Math.abs(withDiscount - summary.total) > 0.02) {
      summary.warnings.push(
        `Applied offers of ${summary.appliedOffers.toFixed(2)} are not reflected in the printed total of ${summary.total.toFixed(2)}. The total is reported exactly as printed; confirm how the discount should be applied before quoting.`,
      );
    }
  }

  return summary;
}
