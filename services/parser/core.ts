/**
 * Layout-driven extraction core.
 *
 * Brand-agnostic by construction: it locates the item table from the header vocabulary, derives
 * columns from where that header actually sits, groups words into rows and rows into logical
 * items, then reads each field by the shape of its value.  No supplier name appears in this
 * file, and the acceptance test proves it extracts the Parts.Cat.Com layout correctly with every
 * adapter disabled.  Adapters exist to raise confidence and supply extra noise patterns; they
 * are never load-bearing.
 */
import {
  Column,
  PageModel,
  Row,
  cellText,
  collapseLetterSpacing,
  detectHeader,
  groupRows,
} from './geometry.ts';
import { PartNumberFamily, classifyPartNumber, normalizePartNumberToken } from './partNumber.ts';
import { PriceCell, readPriceZone, readWeight } from './valueShapes.ts';

export interface CoreItem {
  lineNo?: string;
  qty: number;
  partNo: string;
  desc: string;
  weight: number;
  unitPrice: number;
  extendedPrice?: number;
  currency?: string;
  coreDeposit: number;
  availability?: string;
  leadTime?: string;
  notes?: string;
  /** Every source row that fed this item, verbatim, for auditing.  Never discarded. */
  rawLines: string[];
  warnings: string[];
  /** 0..1.  Lowered by each warning; never used to drop an item, only to flag it. */
  confidence: number;
  /** Page this item was read from, and the baseline of its anchor row — used to pair images. */
  pageNumber: number;
  anchorY: number;
}

export type FailureKind =
  | 'no-text-layer'
  | 'no-header'
  | 'header-without-rows'
  | 'rows-without-part-numbers'
  | 'all-candidates-rejected';

export interface CoreResult {
  items: CoreItem[];
  warnings: string[];
  /** Set only when `items` is empty: names precisely which stage came up short. */
  failure?: { kind: FailureKind; message: string; textPreview: string };
  /** Candidates the guard refused, so a wrongly-rejected real part is debuggable. */
  rejected: { value: string; reason: string; page: number }[];
}

export interface CoreOptions {
  families?: readonly PartNumberFamily[];
  /** Extra noise-subline patterns contributed by an adapter. */
  noisePatterns?: readonly RegExp[];
}

/**
 * Sublines that sit inside an item block but are not part of its description.
 *
 * Kept as notes rather than dropped, because "Non-returnable part" and "Core deposit" change
 * what a salesperson quotes even though they are not the part name.
 */
const NOISE_SUBLINES: readonly RegExp[] = [
  /^non-?returnable\s+part\b/i,
  /^remanufactured\s+part\b/i,
  /^weight\s*\(/i,
  /^\d+(?:\.\d+)?\s*(?:lbs?|kgs?)\.?$/i,
  /^core(?:\s+deposit)?\s*:?\s*\$?[\d,]+\.\d{2}$/i,
  /^back\s?order(?:ed)?\b/i,
  /^supersed(?:e|ed|es)\b/i,
  /^substituted\s+by\b/i,
  /^line\s+item\s+note:/i,
  /^seal\s+product\b/i,
  /^warning\(s\)$/i,
];

/** Rows that end the item table. */
const FOOTER_ROW =
  /^(?:order\s+)?(?:sub\s?total|total\s+due|total\s+tax|grand\s+total|manifest\s+subtotal|summary\s+of\s+charges|amount\s+remaining|notes\s*&\s*terms|terms\s*&\s*conditions|promotions|commercial\s+terms|new\s+parts\s+terms|order\s+total|applied\s+offers|shipping\/misc)/i;

/** Section headings elsewhere on the page, used to veto part-number candidates. */
function pageHeadings(rows: readonly Row[]): Set<string> {
  const headings = new Set<string>();
  for (const row of rows) {
    const text = collapseLetterSpacing(row.text).trim();
    if (!text || text.length > 48) continue;
    // A heading is short, has no digits-with-decimals, and is not sentence-cased prose.
    if (/^[A-Z0-9 &/().,'-]+$/.test(text) || /^[A-Z][a-z]+(?:\s+[A-Za-z&]+){0,3}$/.test(text)) {
      headings.add(normalizePartNumberToken(text));
    }
  }
  return headings;
}

function isNoise(text: string, extra: readonly RegExp[]): boolean {
  const value = text.trim();
  if (!value) return true;
  return NOISE_SUBLINES.some((p) => p.test(value)) || extra.some((p) => p.test(value));
}

/** The leading token of a description cell, which is where Parts.Cat.Com puts the part number. */
function leadingToken(text: string): string {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  const colon = trimmed.indexOf(':');
  if (colon > 0 && colon <= 24) return trimmed.slice(0, colon);
  return trimmed.split(/\s+/)[0] ?? '';
}

interface Block {
  rows: Row[];
  page: number;
}

export function extractItems(pages: readonly PageModel[], options: CoreOptions = {}): CoreResult {
  const warnings: string[] = [];
  const rejected: CoreResult['rejected'] = [];
  const items: CoreItem[] = [];
  const extraNoise = options.noisePatterns ?? [];

  let sawAnyText = false;
  let sawHeader = false;
  let sawBodyRows = false;
  let sawCandidateRows = false;
  const previews: string[] = [];

  let carriedColumns: Column[] | null = null;

  for (const page of pages) {
    const rows = groupRows(page);
    if (rows.length) sawAnyText = true;
    if (previews.length < 3 && rows.length) previews.push(rows.slice(0, 6).map((r) => r.text).join(' | '));

    const header = detectHeader(rows, page);
    // A table continuing onto a later page has no header of its own; reuse the previous page's
    // geometry rather than losing every row after the first page break.
    const columns = header?.columns ?? carriedColumns;
    if (header) {
      sawHeader = true;
      carriedColumns = header.columns;
    }
    if (!columns) continue;

    const startY = header ? header.bottomY : -Infinity;
    const body: Row[] = [];
    for (const row of rows) {
      if (row.y <= startY) continue;
      if (FOOTER_ROW.test(collapseLetterSpacing(row.text).trim())) break;
      body.push(row);
    }
    if (body.length) sawBodyRows = true;

    const headings = pageHeadings(rows);
    const anchors: number[] = [];
    body.forEach((row, index) => {
      if (startsNewItem(row, columns, headings, options, rejected, page.pageNumber)) anchors.push(index);
    });
    if (anchors.length) sawCandidateRows = true;

    const blocks: Block[] = anchors.map((index) => ({ rows: [body[index]], page: page.pageNumber }));
    for (let index = 0; index < body.length; index++) {
      if (anchors.includes(index)) continue;
      const target = attachmentFor(index, anchors, body, columns);
      if (target !== -1) blocks[target].rows.push(body[index]);
    }
    for (const block of blocks) block.rows.sort((a, b) => a.y - b.y);

    for (const block of blocks) {
      const item = buildItem(block, columns, headings, options, rejected);
      if (item) items.push(item);
    }
  }

  if (items.length === 0) {
    const textPreview = previews.join('\n').slice(0, 600);
    let kind: FailureKind = 'no-header';
    let message = 'No item-table header was found on any page.';
    if (!sawAnyText) {
      kind = 'no-text-layer';
      message =
        'This PDF has no text layer — every page is an image. It must be re-exported with selectable text; OCR is not available in this version.';
    } else if (!sawHeader) {
      kind = 'no-header';
      message =
        'Text was read from every page but no item-table header was found (looked for item/qty/part/description/price/availability columns).';
    } else if (!sawBodyRows) {
      kind = 'header-without-rows';
      message = 'An item-table header was found but there were no rows beneath it.';
    } else if (!sawCandidateRows) {
      kind = 'rows-without-part-numbers';
      message =
        'Rows were found beneath the item-table header but none began with a recognisable part number or line number.';
    } else {
      kind = 'all-candidates-rejected';
      message = 'Every candidate line item was rejected by part-number validation.';
    }
    return { items, warnings, rejected, failure: { kind, message, textPreview } };
  }

  return { items, warnings, rejected };
}

/**
 * Does this row begin a new logical item?
 *
 * Two ways to qualify.  Normally a row carries a part-number-shaped token in its part or
 * description column.  But IRON HUB's own invoice template leaves the part-number column blank
 * and still has a real line, so a line-number cell backed by a quantity or a price also counts.
 * Anything else is a continuation or a noise subline and merges into the item above.
 */
function startsNewItem(
  row: Row,
  columns: readonly Column[],
  headings: ReadonlySet<string>,
  options: CoreOptions,
  rejected: CoreResult['rejected'],
  page: number,
): boolean {
  const partCell = cellText(row, columns, 'part');
  const descCell = cellText(row, columns, 'desc');

  for (const candidate of [leadingToken(partCell), leadingToken(descCell)]) {
    if (!candidate) continue;
    const verdict = classifyPartNumber(candidate, { families: options.families, headings });
    if (verdict.ok) return true;
    if (/\d/.test(candidate) && candidate.length >= 4) {
      rejected.push({ value: verdict.value, reason: verdict.reason ?? 'unknown', page });
    }
  }

  const lineCell = cellText(row, columns, 'item').trim();
  if (!/^\d{1,3}\)?$/.test(lineCell)) return false;
  const qtyCell = cellText(row, columns, 'qty').trim();
  const hasQty = /^\d{1,5}$/.test(qtyCell);
  const hasMoney = ['unitPrice', 'extended'].some((role) =>
    /\d\.\d{2}|\$/.test(cellText(row, columns, role as Column['role'])),
  );
  if (!hasQty && !hasMoney) return false;
  return descCell.trim().length > 0;
}


/**
 * Which item does an unanchored row belong to?
 *
 * Normally the one above it — a wrapped description or a "Non-returnable part" note follows the
 * row that named the part.  The exception is scaffolding: IRON HUB's quote template prints the
 * line number, quantity and both prices on a band ABOVE the part number, so attaching purely
 * downward orphaned that row and lost the price with it.  Scaffolding is therefore pulled down
 * onto the anchor beneath it, and everything else keeps the anchor above.
 */
function attachmentFor(
  index: number,
  anchors: readonly number[],
  body: readonly Row[],
  columns: readonly Column[],
): number {
  let above = -1;
  for (let a = 0; a < anchors.length; a++) {
    if (anchors[a] < index) above = a;
    else break;
  }
  const below = above + 1;
  if (below < anchors.length && anchors[below] === index + 1 && isScaffolding(body[index], columns)) {
    return below;
  }
  return above;
}

/**
 * A row that carries only line/quantity/price scaffolding and no description or part number.
 * Used to decide that such a row belongs to the item announced on the row beneath it.
 */
function isScaffolding(row: Row, columns: readonly Column[]): boolean {
  if (cellText(row, columns, 'desc').trim()) return false;
  const part = cellText(row, columns, 'part').trim();
  if (part && !/^\d/.test(part)) return false;
  const line = cellText(row, columns, 'item').trim();
  const qty = cellText(row, columns, 'qty').trim();
  const money = ['unitPrice', 'extended']
    .map((role) => cellText(row, columns, role as Column['role']))
    .join(' ');
  const hasLine = /^\d{1,3}\)?$/.test(line);
  const hasQty = /\b\d{1,5}\b/.test(qty);
  const hasMoney = /\$|\d\.\d{2}|x{4,}/i.test(money);
  return (hasLine || hasQty) && (hasMoney || hasQty);
}

function buildItem(
  block: Block,
  columns: readonly Column[],
  headings: ReadonlySet<string>,
  options: CoreOptions,
  rejected: CoreResult['rejected'],
): CoreItem | null {
  const itemWarnings: string[] = [];
  const rawLines = block.rows.map((r) => r.text);

  const partCells = block.rows.map((r) => cellText(r, columns, 'part')).filter(Boolean);
  const descCells = block.rows.map((r) => cellText(r, columns, 'desc')).filter(Boolean);
  const noteCells = block.rows.map((r) => cellText(r, columns, 'notes')).filter(Boolean);
  // Kept per column rather than merged into one string per row: a row carrying both a unit and
  // an extended price is exactly the case that needs the column to tell them apart.
  const rightCells: PriceCell[] = [];
  for (const row of block.rows) {
    for (const role of ['unitPrice', 'extended', 'availability', 'notes'] as const) {
      const text = cellText(row, columns, role);
      if (text.trim()) rightCells.push({ role, text });
    }
  }

  // --- part number -------------------------------------------------------------------------
  let partNo = '';
  let descHeadRemainder = '';
  const partFromColumn = classifyPartNumber(leadingToken(partCells[0] ?? ''), {
    families: options.families,
    headings,
  });
  if (partFromColumn.ok) {
    partNo = partFromColumn.value;
  } else {
    const head = descCells[0] ?? '';
    const token = leadingToken(head);
    const verdict = classifyPartNumber(token, { families: options.families, headings });
    if (verdict.ok) {
      partNo = verdict.value;
      descHeadRemainder = head.slice(token.length).replace(/^\s*:\s*/, '').trim();
    }
  }
  if (!partNo) {
    itemWarnings.push('no part number found in this row; the part-number column was blank');
    if (partCells[0]) {
      rejected.push({
        value: partCells[0],
        reason: 'not a part number and no alternative found',
        page: block.page,
      });
    }
  }

  // --- description -------------------------------------------------------------------------
  const descParts: string[] = [];
  const notes: string[] = [];
  let weight = 0;
  let availabilityFromDesc = '';

  descCells.forEach((cell, index) => {
    const text = (index === 0 && partNo && descHeadRemainder !== '' ? descHeadRemainder : cell).trim();
    if (!text) return;
    // Strip a part-number prefix that survived on a later row too.
    const withoutPart = partNo ? text.replace(new RegExp(`^${escapeRegExp(partNo)}\\s*:?\\s*`, 'i'), '') : text;
    const candidate = withoutPart.trim();
    if (!candidate) return;

    // Availability leaks into the description column on several templates — IRON HUB's own
    // writes "STATUS: ALL 1 BY FEB 23" there, and its invoice writes "INTEGRAL BY JAN 23".
    // Left in place these become part of the part name on the customer's quote.
    const status = candidate.match(/\bSTATUS\s*:\s*(.+)$/i);
    if (status) {
      availabilityFromDesc = availabilityFromDesc
        ? `${availabilityFromDesc} ${status[1].trim()}`
        : status[1].trim();
      const before = candidate.slice(0, status.index).trim();
      if (before) descParts.push(before);
      return;
    }
    const inlineAvailability = candidate.match(
      /\b(?:ALL\s+\d+\s+BY|INTEGRAL\s+BY)\s+[A-Za-z]{3,9}\s+\d{1,2}\b/i,
    );
    if (inlineAvailability) {
      const text = inlineAvailability[0].replace(/\s+/g, ' ').trim();
      availabilityFromDesc = availabilityFromDesc ? `${availabilityFromDesc} ${text}` : text;
      const remainder = candidate.replace(inlineAvailability[0], ' ').replace(/\s{2,}/g, ' ').trim();
      if (remainder && !isNoise(remainder, extraNoiseOf(options))) descParts.push(remainder);
      else if (remainder) notes.push(remainder);
      return;
    }
    const localWeight = readWeight(candidate);
    if (isNoise(candidate, extraNoiseOf(options))) {
      if (localWeight !== null && !weight) weight = localWeight;
      notes.push(candidate);
      return;
    }
    descParts.push(candidate);
  });

  for (const cell of partCells.slice(1)) {
    const localWeight = readWeight(cell);
    if (localWeight !== null && !weight) weight = localWeight;
  }

  let desc = descParts
    .join(' ')
    .replace(/\bCORE\s+DEPOSIT\b/gi, ' ')
    .replace(/\$\s?[\d,]+\.\d{2}/g, ' ')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+\)/g, ')')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // --- prices, availability, lead time -----------------------------------------------------
  const zone = readPriceZone(rightCells);
  itemWarnings.push(...zone.warnings);

  let coreDeposit = zone.coreDeposit ?? 0;
  if (!coreDeposit) {
    for (const cell of [...partCells, ...descCells]) {
      const match = cell.match(/\bCORE(?:\s+DEPOSIT)?\s*:?\s*\$?\s*([\d,]+\.\d{2})/i);
      if (match) {
        coreDeposit = Number(match[1].replace(/,/g, ''));
        break;
      }
    }
  }

  // --- quantity and line number -------------------------------------------------------------
  // Parts.Cat.Com prints the line marker and the quantity into the same band ("1)  1") when the
  // template has no separate Item column, so both are read from whichever cell carries them.
  let qty = 1;
  let lineFromQty = '';
  for (const row of block.rows) {
    const cell = cellText(row, columns, 'qty').trim();
    if (!cell) continue;
    const paired = cell.match(/^(\d{1,3})\)\s+(\d{1,5})$/);
    if (paired) {
      lineFromQty = paired[1];
      qty = Number(paired[2]);
      break;
    }
    const solo = cell.match(/^(\d{1,5})$/);
    if (solo) {
      qty = Number(solo[1]);
      break;
    }
  }

  const lineCells = block.rows.map((r) => cellText(r, columns, 'item').trim()).filter((t) => /^\d{1,3}\)?$/.test(t));
  const lineNo = (lineCells[0] ?? lineFromQty).replace(/\)$/, '') || undefined;

  // --- reconcile unit against extended -----------------------------------------------------
  let unitPrice = zone.unitPrice ?? 0;
  const extendedPrice = zone.extendedPrice;
  if (!unitPrice && extendedPrice !== undefined && qty > 0) {
    unitPrice = Math.round((extendedPrice / qty) * 100) / 100;
  }
  if (unitPrice && extendedPrice !== undefined && qty > 0) {
    const expected = Math.round(unitPrice * qty * 100) / 100;
    if (Math.abs(expected - extendedPrice) > 0.02) {
      itemWarnings.push(
        `unit price x quantity (${expected.toFixed(2)}) does not match the extended price (${extendedPrice.toFixed(2)})`,
      );
    }
  }
  if (!unitPrice && extendedPrice === undefined) {
    itemWarnings.push('no price could be read for this item');
  }

  const availability = [zone.availability, availabilityFromDesc].filter(Boolean).join(' ').trim();
  if (zone.unclassified.length) {
    itemWarnings.push(`unrecognised value(s) in the price column: ${zone.unclassified.join('; ')}`);
  }

  const confidence = Math.max(0, Math.min(1, 1 - itemWarnings.length * 0.2));

  return {
    pageNumber: block.page,
    anchorY: block.rows[0]?.y ?? 0,
    lineNo,
    qty,
    partNo,
    desc,
    weight,
    unitPrice: Math.round(unitPrice * 100) / 100,
    extendedPrice,
    currency: zone.currency,
    coreDeposit,
    availability: availability || undefined,
    leadTime: zone.leadTime,
    notes: notes.length ? notes.join('; ') : undefined,
    rawLines,
    warnings: itemWarnings,
    confidence,
  };
}

function extraNoiseOf(options: CoreOptions): readonly RegExp[] {
  return options.noisePatterns ?? [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
