/**
 * The gate every strategy's output passes through before it can become a QuoteItem.
 *
 * This is the highest-priority defect this module exists to prevent.  Before it, the parser
 * returned `ONLINE25`, `BILLING METHOD`, `Payment Information`, `SUMMARY OF CHARGES`, `25 LBS`,
 * `2.1 LBS`, `HYDRAULIC` and `5 2 . 6 L B S` as part numbers on real customer quotes, without
 * any error.  Silent corruption is worse than a loud failure: a quote that fails to import gets
 * retried, a quote with a wrong part number gets sent.
 *
 * Rejections are recorded rather than dropped, so a real part refused by an over-tight family
 * can be found and the family widened.
 */
import { PartNumberFamily, classifyPartNumber } from './partNumber.ts';

export interface ValidatableItem {
  partNo: string;
  desc?: string;
  qty?: number;
  unitPrice?: number;
  warnings?: string[];
}

export interface ValidationResult<T> {
  accepted: T[];
  rejected: { value: string; reason: string }[];
  warnings: string[];
}

export interface ValidateOptions {
  families?: readonly PartNumberFamily[];
  /** Section headings seen in the document; a candidate matching one is never a part number. */
  headings?: ReadonlySet<string>;
  /**
   * Allow an item whose part-number column was genuinely blank but which is otherwise a
   * complete line (description plus a price).  IRON HUB's own invoice template prints exactly
   * that, and dropping it would lose a real charge.  An empty part number is honestly absent;
   * a wrong one is not, and only the second is what this guard exists to stop.
   */
  allowBlankPartNumbers?: boolean;
}

export function validateItems<T extends ValidatableItem>(
  items: readonly T[],
  options: ValidateOptions = {},
): ValidationResult<T> {
  const accepted: T[] = [];
  const rejected: ValidationResult<T>['rejected'] = [];
  const warnings: string[] = [];

  for (const item of items) {
    const raw = String(item.partNo ?? '').trim();

    if (!raw) {
      const isCompleteLine = Boolean(item.desc && item.desc.trim()) && Number(item.unitPrice ?? 0) > 0;
      if (options.allowBlankPartNumbers && isCompleteLine) {
        accepted.push(item);
        continue;
      }
      rejected.push({ value: '(blank)', reason: 'no part number and not a complete line' });
      continue;
    }

    const verdict = classifyPartNumber(raw, { families: options.families, headings: options.headings });
    if (!verdict.ok) {
      rejected.push({ value: raw, reason: verdict.reason ?? 'unknown' });
      continue;
    }
    accepted.push({ ...item, partNo: verdict.value });
  }

  if (rejected.length) {
    warnings.push(
      `${rejected.length} candidate line item${rejected.length === 1 ? '' : 's'} rejected by part-number validation: ` +
        rejected.map((r) => `"${r.value}" (${r.reason})`).join(', '),
    );
  }

  return { accepted, rejected, warnings };
}

/** Human-readable reason a document produced nothing, for the Intake Center to show verbatim. */
export function describeEmptyResult(
  stage: 'no-text-layer' | 'no-header' | 'header-without-rows' | 'rows-without-part-numbers' | 'all-candidates-rejected',
  detail: string,
  textPreview: string,
): string {
  const preview = textPreview.trim().slice(0, 220);
  const suffix = preview ? ` First text found: "${preview}${textPreview.length > 220 ? '…' : ''}"` : '';
  return `${detail}${suffix}`;
}
