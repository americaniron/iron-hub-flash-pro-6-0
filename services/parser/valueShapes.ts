/**
 * Value-shape recognition for the right-hand side of a quote table.
 *
 * On Parts.Cat.Com's printed layout the extended price, the unit price, the source branch and
 * the lead time are stacked vertically inside overlapping x-bands — "Total Price" centres on
 * x=525 and "Availability" on x=551, while the values beneath them span x=494..577.  Assigning
 * those values by column centre therefore splits "1 CAT ATLANTA" in half.  The fix is to stop
 * asking *where* a value sits and ask *what shape* it has, which is also what makes the same
 * code work when a supplier reorders its columns.
 */

/** Parse "$2,086.82", "2,086.82", "$ 24.46" into a number.  Returns null when there is no number. */
export function parseMoney(text: string): number | null {
  const match = String(text || '').match(/-?\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return /^\s*-|^\s*\$?\s*-/.test(text) ? -value : value;
}

export interface PriceZoneReading {
  unitPrice?: number;
  extendedPrice?: number;
  currency?: string;
  leadTime?: string;
  availability?: string;
  coreDeposit?: number;
  /** Cells that carried no recognisable shape, kept so nothing is silently discarded. */
  unclassified: string[];
  warnings: string[];
}

const CURRENCY = /\b(USD|CAD|EUR|GBP|AUD)\b/i;
/** "$2,086.82 Ea.", "$526.73 each", "$24.46 ea" — a unit price names its unit. */
const UNIT_PRICE = /\$?\s*([\d,]+\.\d{2})\s*(?:ea\.?|each)\b/i;
/** "(2 Days)", "(5- )", "(3-5 business days)" — Cat's lead-time parenthetical. */
const LEAD_TIME = /\(\s*(\d+\s*(?:-\s*\d*)?\s*(?:business\s*)?days?)\s*\)/i;
/** Availability phrasings seen across Ring Power, Parts.Cat.Com and IRON HUB's own template. */
const AVAILABILITY = [
  /\bAll\s+\d+\s+by\s+[A-Za-z]{3,9}\s+\d{1,2}\b/i,
  /\bAll\s+\d+\s+by\s+\d{1,2}\/\d{1,2}\b/i,
  /\bSTATUS\s*:\s*[^$]*/i,
  /\b\d+\s+in\s+stock\b/i,
  /\bIn\s+Stock\b/i,
  /\bContact\s+Dealer\b/i,
  /\bBack\s?order(?:ed)?\b/i,
  /\bShip\s+\d{1,2}\/\d{2,4}\b/i,
  /\b\d*\s*CAT\s+[A-Z][A-Z\s]*\b/,
  /\bINTEGRAL\s+BY\s+[A-Za-z]{3,9}\s+\d{1,2}\b/i,
];
const CORE_DEPOSIT = /\bCORE(?:\s+DEPOSIT)?\s*:?\s*\$?\s*([\d,]+\.\d{2})/i;

/** One cell of the price zone, tagged with the column it came from. */
export interface PriceCell {
  /** 'unitPrice' | 'extended' | 'availability' | 'notes' — the header this cell sat under. */
  role: string;
  text: string;
}

/**
 * Classify the cells of one item's price/availability zone.
 *
 * Shape decides first: "$526.73 Ea." is a unit price and "(2 Days)" is a lead time wherever they
 * appear.  The column role is consulted only to break the tie between two bare amounts, which is
 * the case the old parser got wrong — a reman injector line carrying $526.73 each and $3,160.38
 * extended was read as $526.73 extended and a fabricated $87.79 unit price.
 */
export function readPriceZone(cells: readonly PriceCell[]): PriceZoneReading {
  const reading: PriceZoneReading = { unclassified: [], warnings: [] };

  for (const { role, text: raw } of cells) {
    let cell = String(raw || '').trim();
    if (!cell) continue;

    const core = cell.match(CORE_DEPOSIT);
    if (core) {
      reading.coreDeposit = parseMoney(core[1]) ?? undefined;
      continue;
    }

    const currency = cell.match(CURRENCY);
    if (currency && !reading.currency) reading.currency = currency[1].toUpperCase();

    const unit = cell.match(UNIT_PRICE);
    if (unit) {
      reading.unitPrice = parseMoney(unit[1]) ?? undefined;
      continue;
    }

    const lead = cell.match(LEAD_TIME);
    if (lead) {
      reading.leadTime = lead[1].replace(/\s+/g, ' ').trim();
      cell = cell.replace(lead[0], ' ').trim();
      if (!cell) continue;
    }

    // Availability text and a price can share one visual row, so take the availability phrase
    // out and keep reading the remainder rather than consuming the whole cell.
    const availability = AVAILABILITY.map((p) => cell.match(p)).find(Boolean);
    if (availability) {
      const text = availability[0].replace(/\s+/g, ' ').trim();
      reading.availability = reading.availability ? `${reading.availability} ${text}` : text;
      cell = cell.replace(availability[0], ' ').replace(/\s{2,}/g, ' ').trim();
      if (!cell) continue;
    }

    if (/\d\.\d{2}\b/.test(cell) || /^\$?[\d,]+$/.test(cell)) {
      const amount = parseMoney(cell);
      if (amount !== null) {
        assignAmount(reading, role, amount, cell);
        continue;
      }
    }

    // A price cell holding only a currency symbol, or a run of x's, is a redacted price rather
    // than a missing column — worth saying out loud so nobody quotes from it.
    if (/^\$*x{4,}$/i.test(cell.replace(/\s/g, '')) || /^\$+$/.test(cell.replace(/\s/g, ''))) {
      if (!reading.warnings.includes('price is redacted in the source document')) {
        reading.warnings.push('price is redacted in the source document');
      }
      continue;
    }
    if (CURRENCY.test(cell) && cell.replace(CURRENCY, '').trim().length === 0) continue;

    reading.unclassified.push(cell);
  }

  return reading;
}

/** Place a bare amount using the column it came from, falling back to fill-extended-first. */
function assignAmount(reading: PriceZoneReading, role: string, amount: number, cell: string): void {
  if (role === 'unitPrice') {
    if (reading.unitPrice === undefined) reading.unitPrice = amount;
    else reading.unclassified.push(cell);
    return;
  }
  if (role === 'extended') {
    if (reading.extendedPrice === undefined) reading.extendedPrice = amount;
    else if (reading.unitPrice === undefined) reading.unitPrice = amount;
    else reading.unclassified.push(cell);
    return;
  }
  if (reading.extendedPrice === undefined) reading.extendedPrice = amount;
  else if (reading.unitPrice === undefined) reading.unitPrice = amount;
  else reading.unclassified.push(cell);
}

/** "Weight (1.5 lbs.)", "463.53 lbs", "25 LBS", "1.2 KG" -> pounds. */
export function readWeight(text: string): number | null {
  const match = String(text || '').match(/(\d+(?:\.\d+)?)\s*(lbs?|kgs?)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const pounds = /^kg/i.test(match[2]) ? value * 2.20462 : value;
  return Math.round(pounds * 100) / 100;
}
