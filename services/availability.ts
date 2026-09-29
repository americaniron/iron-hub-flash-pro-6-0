/** Customer-facing availability from a supplier's fulfillment text. */
export function normalizeAvailability(value: string | null | undefined): string {
  const source = String(value || '').replace(/[\u2013\u2014\u2212]/g, '-');
  const buckets: string[] = [];
  // Match the meaning, not a list of dealer cities. PDF text often separates the
  // quantity, location and parenthetical lead time into distinct text objects.
  const pattern = /(?:\b(\d+)\s+)?\b(in\s+stock|contact\s+dealer)\b|(?:\b(\d+)\s+)?[^\d()\n]*?\(\s*(\d+(?:\s*-\s*\d+)?)\s*(business\s+)?days?\s*\)|(?:\b(\d+)\s+-\s+)?\b(\d+(?:\s*-\s*\d+)?)\s*(business\s+)?days?\b/gi;
  for (const match of source.matchAll(pattern)) {
    if (match[2]) {
      buckets.push(`${match[1] ? `${match[1]} ` : ''}${match[2].replace(/\s+/g, ' ').toUpperCase()}`);
    } else if (match[4]) {
      const duration = `${match[4].replace(/\s*-\s*/g, '-')} ${match[5] ? 'BUSINESS ' : ''}${match[4].includes('-') || Number(match[4]) !== 1 ? 'DAYS' : 'DAY'}`;
      buckets.push(`${match[3] ? `${match[3]} - ` : ''}${duration}`);
    } else if (match[7]) {
      const duration = match[7].replace(/\s*-\s*/g, '-');
      buckets.push(`${match[6] ? `${match[6]} - ` : ''}${duration} ${match[8] ? 'BUSINESS ' : ''}${duration.includes('-') || Number(duration) !== 1 ? 'DAYS' : 'DAY'}`);
    }
  }
  return buckets.join('\n');
}

/** Also sanitize older saved quotes whose status still contains a location. */
export function customerFacingAvailability(value: string | null | undefined): string {
  const source = String(value || '').trim();
  if (/^\d+(?:\s*-\s*\d+)?\s+(?:business\s+)?days?\s+(?:build\s+to\s+order|back\s?order(?:ed)?|special\s+order)\b/i.test(source)) return source;
  const normalized = normalizeAvailability(source);
  if (normalized) return normalized;
  // Keep older date/backorder statuses, but never expose an unrecognised location as a status.
  return /^(?:ALL\s+\d+\s+BY\b|INTEGRAL\s+BY\b|BACK\s?ORDER\b|SHIP\s+\d)/i.test(source)
    ? source : '';
}
