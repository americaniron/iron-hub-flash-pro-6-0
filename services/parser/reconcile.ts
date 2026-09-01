/**
 * Arithmetic cross-check between the line items and the totals the document prints.
 *
 * This exists because it works.  Applied to the round-trip fixture it caught a real miscount:
 * the old parser reported seven line items, and the five extended prices the new core reads sum
 * to exactly the printed MANIFEST SUBTOTAL of $15,363.28 — which is what proved seven was wrong.
 * A check that good should be standing behaviour on every document, not a test assertion on one.
 *
 * It warns.  It never adjusts a number to force a match: a parser that quietly balances its own
 * books hides exactly the dropped line item this is meant to catch.
 */
import { CoreItem } from './core.ts';
import { DocumentSummary } from './documentSummary.ts';

/** Amounts are compared to the cent, with a tolerance for accumulated rounding. */
const TOLERANCE = 0.02;

export interface Reconciliation {
  /** Sum of the line items' extended prices. */
  itemsTotal: number;
  /** How many items had to fall back to qty x unitPrice because no extended price was printed. */
  derivedCount: number;
  warnings: string[];
  /** True when every comparison that could be made did match. */
  balanced: boolean;
  /** Comparisons that were skipped because the document printed no figure to compare against. */
  skipped: string[];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function reconcileTotals(
  items: readonly CoreItem[],
  summary: DocumentSummary,
): Reconciliation {
  const warnings: string[] = [];
  const skipped: string[] = [];
  let derivedCount = 0;

  let itemsTotal = 0;
  for (const item of items) {
    if (item.extendedPrice !== undefined) {
      itemsTotal += item.extendedPrice;
    } else if (item.unitPrice) {
      itemsTotal += item.unitPrice * (item.qty || 1);
      derivedCount++;
    } else {
      derivedCount++;
    }
  }
  itemsTotal = round(itemsTotal);

  let comparisons = 0;
  let matches = 0;
  let subtotalMismatch: number | null = null;

  if (summary.subtotal !== undefined) {
    comparisons++;
    const delta = round(itemsTotal - summary.subtotal);
    if (Math.abs(delta) <= TOLERANCE) {
      matches++;
    } else {
      subtotalMismatch = delta;
      warnings.push(
        `Line items total ${itemsTotal.toFixed(2)} but the document prints a subtotal of ${summary.subtotal.toFixed(2)} ` +
          `(difference ${delta > 0 ? '+' : ''}${delta.toFixed(2)}). A line item may be missing or misread; nothing has been adjusted.`,
      );
    }
  } else {
    skipped.push('subtotal');
  }

  // Shipping and tax are added because they are separately printed charges, not line items.
  // On the BOYD order this is the whole of the difference: 6,808.54 + 208.49 + 0.00 = 7,017.03.
  // Applied offers are deliberately NOT subtracted here — see documentSummary.
  if (summary.total !== undefined) {
    comparisons++;
    // Every separately-printed charge we managed to read, signed as the document signs it.
    // Applied offers are deliberately excluded: the supplier does not deduct them from its own
    // printed total, so adding them here would manufacture a mismatch.
    const charges: [string, number][] = [
      ['shipping', summary.shipping ?? 0],
      ['freight', summary.freight ?? 0],
      ['tax', summary.tax ?? 0],
      ['discount', summary.discount ?? 0],
      ['credit', summary.creditRefund ?? 0],
      ['core deposits', summary.coreDeposits ?? 0],
    ];
    const computed = round(itemsTotal + charges.reduce((sum, [, amount]) => sum + amount, 0));
    const delta = round(computed - summary.total);
    if (Math.abs(delta) <= TOLERANCE) {
      matches++;
    } else if (subtotalMismatch !== null && Math.abs(round(delta - subtotalMismatch)) <= TOLERANCE) {
      // Same shortfall the subtotal check already reported; saying it twice adds no information.
      skipped.push('total (same difference as the subtotal check)');
    } else {
      const parts = [`items ${itemsTotal.toFixed(2)}`];
      for (const [label, amount] of charges) {
        if (amount) parts.push(`${label} ${amount.toFixed(2)}`);
      }
      warnings.push(
        `${parts.join(' + ')} = ${computed.toFixed(2)} but the document prints a total of ${summary.total.toFixed(2)} ` +
          `(difference ${delta > 0 ? '+' : ''}${delta.toFixed(2)}). Check for a missing line item or an unread charge; nothing has been adjusted.`,
      );
    }
  } else {
    skipped.push('total');
  }

  if (derivedCount) {
    warnings.push(
      `${derivedCount} line item(s) printed no extended price, so the comparison used quantity x unit price for them.`,
    );
  }

  return { itemsTotal, derivedCount, warnings, balanced: comparisons > 0 && matches === comparisons, skipped };
}
