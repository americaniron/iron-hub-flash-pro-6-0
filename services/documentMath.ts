import { AppConfig, InvoiceData, QuoteItem, ServiceItem } from '../types.ts';

/**
 * The one place a document's money is decided, on this side of the bridge.
 *
 * Every figure below is an integer count of minor units (cents). The previous implementation
 * worked in floating-point dollars and rounded to two decimals at seven separate points, while
 * the Suite recomputed the same document in integer cents with a different rounding order and
 * stored *its* answer — so the same quote showed one total in Iron Hub Pro and another in the
 * Suite, and neither side was told they disagreed.
 *
 * The formula here is character-for-character the one the Suite Worker applies in
 * `calculateDocumentTotals`:
 *
 *   subtotal      = SUM(qty * round(unitPrice * markupFactor))
 *   tax           = SUM(round(lineAmount * taxRateBp / 1_000_000))
 *   freight       = round(totalWeight * freightRateMinor)
 *   discount      = round(subtotal * discountBp / 1_000_000)     (or a flat amount, used exactly)
 *   coreDeposits  = SUM(qty * coreDepositMinor)
 *   total         = subtotal + tax + freight - discount - credit + coreDeposits
 *
 * Rates travel as basis points (1 bp = 0.01%) so a 7.5% discount or an 8.25% tax rate survives
 * without being floored to a whole percent.
 */

export const BASIS_POINTS_PER_PERCENT = 100;
const RATE_DIVISOR = 100 * BASIS_POINTS_PER_PERCENT;

/** Major units (what a person types) -> canonical minor units. Rounds exactly once. */
export function toMinorUnits(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  const minor = Math.round(amount * 100);
  return Number.isSafeInteger(minor) ? minor : 0;
}

/** Canonical minor units -> major units, for display only. Never feed this back into a sum. */
export function toMajorUnits(minor: number): number {
  return Math.round(Number(minor) || 0) / 100;
}

export function percentToBasisPoints(percent: unknown): number {
  const value = Number(percent);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * BASIS_POINTS_PER_PERCENT);
}

function applyRate(amountMinor: number, basisPoints: number): number {
  return Math.round((amountMinor * basisPoints) / RATE_DIVISOR);
}

export type QuoteLineFinancials = QuoteItem & {
  /** Marked-up unit price, in minor units. This is the price the customer is shown. */
  sellPriceMinor: number;
  extPriceMinor: number;
  /** Major-unit mirrors, for rendering only. */
  sellPrice: number;
  extPrice: number;
};

export type QuoteFinancials = {
  markedItems: QuoteLineFinancials[];
  currency: 'USD';
  subtotalMinor: number;
  taxMinor: number;
  totalWeight: number;
  totalCoreDepositsMinor: number;
  logisticsMinor: number;
  logisticsRateMicro: number;
  discountMinor: number;
  discountBp: number;
  creditOrRefundMinor: number;
  totalMinor: number;
  /** Major-unit mirrors, for rendering only. */
  subtotal: number;
  totalCoreDeposits: number;
  logistics: number;
  discount: number;
  creditOrRefund: number;
  total: number;
};

export function calculateQuoteFinancials(items: QuoteItem[], config: AppConfig): QuoteFinancials {
  const markupFactor = 1 + (Number(config.markupPercentage) || 0) / 100;

  const markedItems: QuoteLineFinancials[] = (items || []).map((item) => {
    const quantity = Math.max(0, Math.floor(Number(item.qty) || 0));
    // Rounded once, here. The customer sees this unit price and the Suite stores this exact
    // integer, so the two subtotals cannot drift apart by a cent per line.
    const sellPriceMinor = Math.max(0, toMinorUnits((Number(item.unitPrice) || 0) * markupFactor));
    const extPriceMinor = sellPriceMinor * quantity;
    return {
      ...item,
      sellPriceMinor,
      extPriceMinor,
      sellPrice: toMajorUnits(sellPriceMinor),
      extPrice: toMajorUnits(extPriceMinor),
    };
  });

  const subtotalMinor = markedItems.reduce((sum, item) => sum + item.extPriceMinor, 0);
  const totalWeight = markedItems.reduce(
    (sum, item) => sum + Math.max(0, Math.floor(Number(item.qty) || 0)) * Math.max(0, Number(item.weight) || 0),
    0,
  );
  const totalCoreDepositsMinor = markedItems.reduce(
    (sum, item) => sum + Math.max(0, Math.floor(Number(item.qty) || 0)) * Math.max(0, toMinorUnits(item.coreDeposit)),
    0,
  );
  // A logistics rate is quoted per pound and is routinely finer than a cent — $0.135/lb is an
  // ordinary rate. Rounding it to whole cents before multiplying by the weight overcharged freight
  // by 3.7% on that rate, so it is carried in millionths of a major unit, exactly as the Suite
  // stores it.
  const logisticsRateMicro = Math.max(0, Math.round((Number(config.logisticsRate) || 0) * 1e6));
  const logisticsMinor = Math.round((totalWeight * logisticsRateMicro) / 10_000);
  const discountBp = percentToBasisPoints(Math.max(0, Math.min(100, Number(config.discountPercentage) || 0)));
  const discountMinor = applyRate(subtotalMinor, discountBp);
  const creditOrRefundMinor = Math.max(0, toMinorUnits(config.creditOrRefund));
  // Quotes carry no tax rate in this product; the term is kept explicit so the formula is the
  // same one the Suite applies to both documents rather than a quote-shaped special case.
  const taxMinor = 0;
  const totalMinor =
    subtotalMinor + taxMinor + logisticsMinor - discountMinor - creditOrRefundMinor + totalCoreDepositsMinor;

  return {
    markedItems,
    currency: 'USD',
    subtotalMinor,
    taxMinor,
    totalWeight,
    totalCoreDepositsMinor,
    logisticsMinor,
    logisticsRateMicro,
    discountMinor,
    discountBp,
    creditOrRefundMinor,
    totalMinor,
    subtotal: toMajorUnits(subtotalMinor),
    totalCoreDeposits: toMajorUnits(totalCoreDepositsMinor),
    logistics: toMajorUnits(logisticsMinor),
    discount: toMajorUnits(discountMinor),
    creditOrRefund: toMajorUnits(creditOrRefundMinor),
    total: toMajorUnits(totalMinor),
  };
}

export type InvoiceFinancials = {
  currency: 'USD';
  subtotalMinor: number;
  taxMinor: number;
  discountMinor: number;
  totalMinor: number;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
};

/**
 * Invoices use the same formula. Their discount is a flat figure somebody typed rather than a
 * rate, so it is subtracted exactly as entered and never re-derived from a percentage.
 */
export function calculateInvoiceFinancials(invoice: Pick<InvoiceData, 'items' | 'taxRate' | 'discount'>): InvoiceFinancials {
  const taxRateBp = percentToBasisPoints(Math.max(0, Math.min(100, Number(invoice.taxRate) || 0)));
  let subtotalMinor = 0;
  let taxMinor = 0;
  for (const raw of invoice.items || []) {
    const item = raw as ServiceItem;
    const quantity = Math.max(0, Math.floor(Number(item.hours) || 0));
    const unitPriceMinor = Math.max(0, toMinorUnits(item.rate));
    const amountMinor = quantity * unitPriceMinor;
    subtotalMinor += amountMinor;
    taxMinor += applyRate(amountMinor, item.taxable ? taxRateBp : 0);
  }
  const discountMinor = Math.max(0, toMinorUnits(invoice.discount));
  const totalMinor = subtotalMinor + taxMinor - discountMinor;
  return {
    currency: 'USD',
    subtotalMinor,
    taxMinor,
    discountMinor,
    totalMinor,
    subtotal: toMajorUnits(subtotalMinor),
    tax: toMajorUnits(taxMinor),
    discount: toMajorUnits(discountMinor),
    total: toMajorUnits(totalMinor),
  };
}
