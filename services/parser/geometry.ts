/**
 * Layout primitives shared by every extraction strategy.
 *
 * The old parser flattened each page to one string per y-band and then hunted for patterns in
 * that string.  Flattening destroys exactly the information a quote table encodes — which
 * column a number sits in — so a price, a weight and a quantity all became "some number on the
 * line".  Everything here keeps coordinates until the very last step, and everything is
 * expressed as a fraction of page width so Letter (612x792), A4 (595x842) and Legal behave
 * identically.  Nothing in this module touches the DOM or pdfjs, so it runs under `node --test`.
 */

export interface TextItem {
  text: string;
  x0: number;
  x1: number;
  /** Distance from the top of the page to the glyph top, in points. */
  top: number;
  /** Distance from the top of the page to the baseline, in points. */
  bottom: number;
  fontSize: number;
  fontName?: string;
}

export interface PageModel {
  pageNumber: number;
  width: number;
  height: number;
  items: TextItem[];
}

export interface Row {
  /** Baseline of the row, measured from the top of the page. */
  y: number;
  top: number;
  items: TextItem[];
  /** Gap-aware join of `items` — see `joinItems`. */
  text: string;
}

/**
 * Collapse decorative letter-spacing.
 *
 * IRON HUB's own quote template renders headings and the weight cell with wide letter-spacing,
 * and the spaces are real characters in the content stream, so pdfjs hands back
 * "5 2 . 6 L B S" and "S TAT U S : 7 D AY S" as single strings.  Left alone the first becomes a
 * multi-word token and is rejected as a part number, and the second never matches an
 * availability pattern.  Only collapsed when the run is overwhelmingly single characters, so
 * ordinary prose such as "AIR COMPRESSOR 1 CLAYTON" is untouched.
 */
export function collapseLetterSpacing(text: string): string {
  const tokens = String(text || '').trim().split(/\s+/);
  if (tokens.length < 4) return text;
  const singles = tokens.filter((t) => t.length === 1).length;
  if (singles / tokens.length < 0.7) return text;
  // Re-separate at the boundaries the collapse destroyed, so "5 2 . 6 L B S" ends up as
  // "52.6 LBS" and "S TAT U S : 7 D AY S" as "STATUS: 7 DAYS" rather than as one long word
  // that no weight or availability pattern can match.
  return tokens
    .join('')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/:(?=\S)/g, ': ')
    .trim();
}

/**
 * Join text items into a string, inserting a space only where the page actually has one.
 *
 * pdfjs splits "319-0677" into "319", "−", "0677" laid out edge to edge with zero gap.  Joining
 * unconditionally with a space produced "319 − 0677", which the part-number guard correctly
 * rejects as multi-word — so the old parser lost every hyphenated Caterpillar number and fell
 * back to whatever else was on the line.  Measuring the gap restores them without inventing
 * joins between genuinely separated columns.
 */
export function joinItems(items: readonly TextItem[]): string {
  const ordered = [...items].sort((a, b) => a.x0 - b.x0);
  let out = '';
  let prev: TextItem | null = null;
  for (const item of ordered) {
    if (!item.text) continue;
    if (!item.text.trim()) {
      // An explicit whitespace item is a real separator.
      if (out && !out.endsWith(' ')) out += ' ';
      prev = item;
      continue;
    }
    if (prev) {
      const gap = item.x0 - prev.x1;
      // A quarter of the font size is comfortably below a real inter-word space and safely
      // above the sub-point rounding noise between adjacent glyph runs.
      if (gap > 0.25 * Math.max(item.fontSize, prev.fontSize) && !out.endsWith(' ')) out += ' ';
    }
    out += item.text;
    prev = item;
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

/** Median of a numeric list; 0 for an empty list. */
function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Group items into visual rows by baseline proximity.
 *
 * The tolerance scales with font size rather than being a fixed 5 or 8 points, because the
 * Parts.Cat.Com print stylesheet sets one item block across five rows only 6pt apart while the
 * generated-quote template spaces rows 12pt apart.  A fixed tolerance either welds the former
 * into one row or splits the latter's superscripts into their own.
 */
export function groupRows(page: PageModel): Row[] {
  const items = page.items.filter((i) => i.text && i.text.length);
  if (!items.length) return [];
  const typicalFont = median(items.map((i) => i.fontSize).filter((n) => n > 0)) || 9;
  const tolerance = Math.max(1.5, typicalFont * 0.45);

  const sorted = [...items].sort((a, b) => a.bottom - b.bottom);
  const rows: Row[] = [];
  for (const item of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(item.bottom - last.y) <= tolerance) {
      last.items.push(item);
      last.top = Math.min(last.top, item.top);
      continue;
    }
    rows.push({ y: item.bottom, top: item.top, items: [item], text: '' });
  }
  for (const row of rows) row.text = collapseLetterSpacing(joinItems(row.items));
  return rows.filter((r) => r.text.length > 0);
}

export type ColumnRole =
  | 'item'
  | 'qty'
  | 'part'
  | 'desc'
  | 'unitPrice'
  | 'extended'
  | 'availability'
  | 'notes'
  | 'unknown';

/**
 * Header vocabulary.
 *
 * Order matters: the first role whose synonym is found wins, so the longer, more specific
 * phrases have to be tested before their prefixes.  Matching is case-insensitive and
 * whitespace-insensitive because Chrome's print-to-PDF emits "Total PriceUSD/" with the space
 * between "Price" and "USD" collapsed away.
 */
const HEADER_SYNONYMS: ReadonlyArray<readonly [ColumnRole, readonly string[]]> = [
  ['desc', ['productdescription', 'partdescription', 'description', 'product', 'desc']],
  ['part', ['partnumber', 'partno', 'part#', 'itemnumber', 'partnum', 'part']],
  ['qty', ['quantity', 'quantityordered', 'qtyordered', 'ordered', 'qty']],
  ['unitPrice', ['unitprice', 'unitval', 'eachprice', 'each', 'unit', 'ea']],
  ['extended', ['extendedprice', 'totalprice', 'extval', 'extended', 'amount', 'total', 'net', 'ext']],
  ['availability', ['availability', 'leadtime', 'eta', 'available', 'stock', 'branch', 'source']],
  ['notes', ['notes', 'note', 'remarks']],
  ['item', ['lineno', 'line', 'item', 'no.', '#', 'lin']],
];

/** Reduce a header cell to its comparison key: lowercase, no spaces, no punctuation noise. */
function headerKey(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9#.]/g, '')
    .replace(/\.+$/, '');
}

/**
 * Suffixes a header may carry without changing which column it names.
 *
 * Chrome prints Parts.Cat.Com's price header as "Total PriceUSD/", so the currency has to be
 * tolerated; plurals cover "Note"/"Notes".  Deliberately a closed list: an earlier version
 * accepted any prefix match, and "Items In Your Order" — the section title sitting one row
 * above the real header — was read as the "Item" column.  That widened the item column across
 * half the page and swallowed the quantity value.
 */
const HEADER_SUFFIX_NOISE = new Set(['', 's', 'es', 'usd', 'eur', 'gbp', 'cad', 'aud', 'no', '#']);

/** The role a header cell announces, or null when it announces nothing. */
export function headerRole(text: string): ColumnRole | null {
  const key = headerKey(text);
  if (!key) return null;
  for (const [role, synonyms] of HEADER_SYNONYMS) {
    for (const synonym of synonyms) {
      if (key === synonym) return role;
      if (key.startsWith(synonym) && HEADER_SUFFIX_NOISE.has(key.slice(synonym.length))) return role;
    }
  }
  return null;
}

export interface Column {
  role: ColumnRole;
  label: string;
  x0: number;
  x1: number;
  center: number;
  /** `center` as a fraction of page width, so the same table matches on A4 and Letter. */
  centerFraction: number;
}

export interface HeaderDetection {
  /** Every row that forms part of the (possibly staggered) header. */
  rows: Row[];
  columns: Column[];
  /** Baseline of the lowest header row — the table body starts below this. */
  bottomY: number;
}

/**
 * Find the item-table header on a page.
 *
 * Two things make this harder than "find the row containing 'part'".  First, Parts.Cat.Com has
 * no "part" column at all — its header reads Item / Quantity / Product Description / Total
 * Price / Availability — which is precisely why the old parser returned nothing.  Second, the
 * Chrome print stylesheet staggers that header across three y-bands 15pt apart, so the row that
 * contains "Quantity" does not contain "Availability".  Both are handled by scoring candidate
 * rows on distinct roles and then absorbing adjacent header-ish rows into one zone.
 */
export function detectHeader(rows: readonly Row[], page: PageModel): HeaderDetection | null {
  if (!rows.length) return null;
  const typicalFont = median(page.items.map((i) => i.fontSize).filter((n) => n > 0)) || 9;
  const mergeWindow = typicalFont * 2.6;

  const rowRoles = rows.map((row) => {
    const roles = new Set<ColumnRole>();
    for (const item of row.items) {
      const role = headerRole(collapseLetterSpacing(item.text));
      if (role) roles.add(role);
    }
    return roles;
  });

  let best: { index: number; score: number } | null = null;
  for (let i = 0; i < rows.length; i++) {
    // Absorb neighbours inside the merge window so a staggered header scores as a whole.
    const merged = new Set(rowRoles[i]);
    for (let j = 0; j < rows.length; j++) {
      if (j === i || Math.abs(rows[j].y - rows[i].y) > mergeWindow) continue;
      for (const role of rowRoles[j]) merged.add(role);
    }
    // A header needs a description-ish column plus at least one quantity/price/availability
    // column; that combination does not occur in address blocks or summary panels.
    const hasSubject = merged.has('desc') || merged.has('part');
    const supporting = ['qty', 'unitPrice', 'extended', 'availability', 'item', 'notes'].filter((r) =>
      merged.has(r as ColumnRole),
    ).length;
    if (!hasSubject || supporting < 1) continue;
    const score = merged.size * 10 + supporting;
    if (!best || score > best.score) best = { index: i, score };
  }
  if (!best) return null;

  const anchor = rows[best.index];
  const zone = rows.filter((row) => Math.abs(row.y - anchor.y) <= mergeWindow && hasAnyHeaderCell(row));
  if (!zone.includes(anchor)) zone.push(anchor);
  zone.sort((a, b) => a.y - b.y);

  const columns: Column[] = [];
  for (const row of zone) {
    for (const item of row.items) {
      const label = collapseLetterSpacing(item.text).trim();
      const role = headerRole(label);
      if (!role) continue;
      const existing = columns.find((c) => c.role === role);
      if (existing) {
        // A header split across items ("PART" + "NUMBER") widens the same column.
        existing.x0 = Math.min(existing.x0, item.x0);
        existing.x1 = Math.max(existing.x1, item.x1);
        existing.label = `${existing.label} ${label}`.trim();
        continue;
      }
      columns.push({ role, label, x0: item.x0, x1: item.x1, center: 0, centerFraction: 0 });
    }
  }
  if (columns.length < 2) return null;

  for (const column of columns) {
    column.center = (column.x0 + column.x1) / 2;
    column.centerFraction = page.width ? column.center / page.width : 0;
  }
  columns.sort((a, b) => a.center - b.center);

  return { rows: zone, columns, bottomY: Math.max(...zone.map((r) => r.y)) };
}

function hasAnyHeaderCell(row: Row): boolean {
  return row.items.some((item) => headerRole(collapseLetterSpacing(item.text)) !== null);
}

/**
 * Column boundaries, taken from the gaps between adjacent header cells.
 *
 * Deliberately derived from the header's full extent rather than its centre.  A description
 * header reading "DESCRIPTION" is narrow and centred at x=194, but the descriptions beneath it
 * run from x=222 out to x=372 — so nearest-centre assignment handed "AIR COMPRESSOR 1 CLAYTON"
 * to the QTY column, whose centre at x=399 happened to be a hair closer.  The gap between where
 * one header ends and the next begins is the real column edge, and it survives both a wide cell
 * and a right-aligned one.
 */
function columnBoundaries(columns: readonly Column[]): number[] {
  const boundaries: number[] = [];
  for (let i = 0; i < columns.length - 1; i++) {
    const edge = (columns[i].x1 + columns[i + 1].x0) / 2;
    // Overlapping headers (Cat prints "Total Price" and "Availability" over the same band) could
    // otherwise produce a boundary to the left of its predecessor.
    boundaries.push(boundaries.length ? Math.max(edge, boundaries[boundaries.length - 1]) : edge);
  }
  return boundaries;
}

/**
 * Assign a text item to a column by which band its left edge falls into.
 *
 * Left edge rather than midpoint because tables are read left to right: a cell that starts
 * inside the description band belongs to the description however far it runs.
 */
export function assignColumn(item: TextItem, columns: readonly Column[]): Column | null {
  if (!columns.length) return null;
  const ordered = [...columns].sort((a, b) => a.x0 - b.x0);
  const boundaries = columnBoundaries(ordered);
  for (let i = 0; i < boundaries.length; i++) {
    if (item.x0 < boundaries[i]) return ordered[i];
  }
  return ordered[ordered.length - 1];
}

/** Items of a row that fall in a given column role, left to right. */
export function cellItems(row: Row, columns: readonly Column[], role: ColumnRole): TextItem[] {
  return row.items
    .filter((item) => assignColumn(item, columns)?.role === role)
    .sort((a, b) => a.x0 - b.x0);
}

/** Gap-aware text of a row's cell for the given role. */
export function cellText(row: Row, columns: readonly Column[], role: ColumnRole): string {
  return collapseLetterSpacing(joinItems(cellItems(row, columns, role)));
}
