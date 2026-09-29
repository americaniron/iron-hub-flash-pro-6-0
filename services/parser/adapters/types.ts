/**
 * Brand adapters.
 *
 * An adapter's only job is to raise confidence and contribute vocabulary — extra part-number
 * families and extra noise-subline patterns for a supplier whose template has quirks the core
 * cannot infer.  Adapters are never load-bearing: `core.extractItems` is required to produce
 * correct output for every fixture with the registry empty, and a test asserts exactly that.
 * Anything that would only work through an adapter belongs in the core instead.
 */
import { PageModel } from '../geometry.ts';
import { PartNumberFamily } from '../partNumber.ts';

export interface AdapterContext {
  /** Flattened text of every page, for cheap identification only. */
  text: string;
  pages: readonly PageModel[];
}

export interface AdapterHints {
  families?: readonly PartNumberFamily[];
  noisePatterns?: readonly RegExp[];
}

export interface Adapter {
  readonly name: string;
  /** 0 = not this supplier, 1 = certain.  Scores below 0.2 are ignored. */
  detect(context: AdapterContext): number;
  readonly hints?: AdapterHints;
}
