/**
 * Part-number recognition.
 *
 * This is the load-bearing half of the anti-garbage guard.  Before this module existed the
 * parser handed whatever text sat in the leftmost column back as `partNo`, which is how a
 * customer quote came to carry part numbers of "25 LBS", "HYDRAULIC", "BILLING METHOD" and
 * "SUMMARY OF CHARGES".  A loud failure is recoverable; a wrong part number on a quote that
 * reaches a customer is not.  Every candidate therefore has to earn its way through a family
 * match AND a shape veto, and anything rejected is reported rather than silently dropped.
 */

/** A named part-number shape.  Adapters may add families; none may remove the verified set. */
export interface PartNumberFamily {
  readonly name: string;
  readonly pattern: RegExp;
}

/**
 * The verified family set.
 *
 * Matches all known-good part numbers recovered from the fixtures on disk
 * (539-0546, 319-0677, 366-8821, 381-2499, 317-8021, 583-9600, 175-6779, 10R-7672)
 * and the documented shapes 1R-0750 / 8T-1234 / 4W-9999.
 *
 * Note `\d{1,2}[A-Z]-\d{4}` rather than `\d[A-Z]-\d{4}`: the single-digit form cannot match
 * 10R-7672, which is a real Caterpillar reman injector number in the round-trip fixture.
 */
export const DEFAULT_PART_NUMBER_FAMILIES: readonly PartNumberFamily[] = Object.freeze([
  { name: 'cat-3x4', pattern: /^\d{3}-\d{4}$/ },
  { name: 'cat-alpha', pattern: /^\d{1,2}[A-Z]-\d{4}$/ },
  { name: 'generic-separated', pattern: /^\d{2,4}[A-Z]?-?\d{3,5}$/ },
]);

/**
 * Substrings that disqualify a candidate outright.
 *
 * Units are here because the weight column sits directly beneath the part-number column on
 * IRON HUB's own generated quotes, so a row-merge that drifts by one line turns "25 LBS" into
 * a part number.  A currency symbol means a price column bled in.
 */
const DISQUALIFYING_TOKEN = /(?:\bLBS?\b|\bKGS?\b|\bOZ\b|\$|%)/i;

/** Dates masquerading as part numbers — `generic-separated` would otherwise accept 20260403. */
function looksLikeDate(token: string): boolean {
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(token)) return true;
  if (/^\d{1,2}[-/]\d{2,4}$/.test(token)) return true;
  // A bare 8-digit run in YYYYMMDD range is a timestamp, not a catalogue number.
  if (/^\d{8}$/.test(token)) {
    const year = Number(token.slice(0, 4));
    const month = Number(token.slice(4, 6));
    const day = Number(token.slice(6, 8));
    if (year >= 1990 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) return true;
  }
  return false;
}

export interface PartNumberVerdict {
  readonly ok: boolean;
  /** The normalised part number when `ok`, otherwise the candidate as received. */
  readonly value: string;
  readonly family?: string;
  readonly reason?: string;
}

/**
 * Normalise a raw token into part-number form without inventing content.
 *
 * pdfjs splits "319-0677" into three text items ("319", "−", "0677") and the joiner puts
 * spaces between them, so the dash has to survive both the Unicode minus and the padding.  A
 * trailing colon is Parts.Cat.Com's "part: description" separator and is not part of the number.
 */
export function normalizePartNumberToken(raw: string): string {
  return String(raw || '')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/[:.,;]+$/, '')
    .trim()
    .toUpperCase();
}

/**
 * Decide whether `raw` may be used as a part number.
 *
 * `headings` is the set of section headings seen elsewhere on the page; a candidate that also
 * appears as a heading is rejected however well it matches a family, because that is the exact
 * failure that produced "SUMMARY OF CHARGES" as a line item.
 */
export function classifyPartNumber(
  raw: string,
  options: { families?: readonly PartNumberFamily[]; headings?: ReadonlySet<string> } = {},
): PartNumberVerdict {
  const families = options.families ?? DEFAULT_PART_NUMBER_FAMILIES;
  const candidate = String(raw || '').trim();
  if (!candidate) return { ok: false, value: candidate, reason: 'empty' };

  // Two or more whitespace-separated words is prose, not a catalogue number.  Checked before
  // normalisation so "25 LBS" and "5 2 . 6 L B S" are both caught as multi-word.
  if (/\s/.test(candidate.trim())) {
    return { ok: false, value: candidate, reason: 'multi-word' };
  }
  if (DISQUALIFYING_TOKEN.test(candidate)) {
    return { ok: false, value: candidate, reason: 'contains unit or currency token' };
  }

  const normalized = normalizePartNumberToken(candidate);
  if (!normalized) return { ok: false, value: candidate, reason: 'empty after normalisation' };

  if (options.headings?.has(normalized)) {
    return { ok: false, value: normalized, reason: 'also appears as a section heading' };
  }
  if (looksLikeDate(normalized)) {
    return { ok: false, value: normalized, reason: 'looks like a date' };
  }

  for (const family of families) {
    if (family.pattern.test(normalized)) {
      return { ok: true, value: normalized, family: family.name };
    }
  }
  return { ok: false, value: normalized, reason: 'matches no known part-number family' };
}

/** Convenience predicate for scanning a row for "does anything here look like a part number?". */
export function isPartNumberLike(
  raw: string,
  options: { families?: readonly PartNumberFamily[]; headings?: ReadonlySet<string> } = {},
): boolean {
  return classifyPartNumber(raw, options).ok;
}
