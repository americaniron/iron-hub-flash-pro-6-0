/**
 * Adapter registry and selection.
 *
 * `selectAdapter` returns the best-scoring adapter plus merged hints.  Passing an empty registry
 * is a supported mode, not a degraded one: `core.extractItems` must still be correct, and
 * `test/parser-core.test.mjs` proves it on the Parts.Cat.Com fixture.
 */
import { PageModel, groupRows } from '../geometry.ts';
import { DEFAULT_PART_NUMBER_FAMILIES, PartNumberFamily } from '../partNumber.ts';
import { CoreOptions } from '../core.ts';
import { Adapter, AdapterContext, AdapterHints } from './types.ts';
import { caterpillarAdapter } from './caterpillar.ts';
import { genericAdapter } from './generic.ts';
import {
  bobcatAdapter,
  caseAdapter,
  donaldsonAdapter,
  fleetguardAdapter,
  hitachiAdapter,
  interstateAdapter,
  johnDeereAdapter,
  komatsuAdapter,
  napaAdapter,
  volvoAdapter,
} from './stubs.ts';

export type { Adapter, AdapterContext, AdapterHints } from './types.ts';

export const DEFAULT_ADAPTERS: readonly Adapter[] = Object.freeze([
  caterpillarAdapter,
  komatsuAdapter,
  hitachiAdapter,
  volvoAdapter,
  johnDeereAdapter,
  caseAdapter,
  bobcatAdapter,
  napaAdapter,
  fleetguardAdapter,
  donaldsonAdapter,
  interstateAdapter,
  genericAdapter,
]);

export function adapterContext(pages: readonly PageModel[]): AdapterContext {
  const text = pages
    .map((page) => groupRows(page).map((row) => row.text).join(' '))
    .join('\n');
  return { text, pages };
}

export interface AdapterSelection {
  adapter: Adapter | null;
  score: number;
  options: CoreOptions;
}

export function selectAdapter(
  pages: readonly PageModel[],
  registry: readonly Adapter[] = DEFAULT_ADAPTERS,
): AdapterSelection {
  const context = adapterContext(pages);
  let best: Adapter | null = null;
  let bestScore = 0;
  for (const adapter of registry) {
    const score = adapter.detect(context);
    if (score > bestScore) {
      bestScore = score;
      best = adapter;
    }
  }
  // The floor applies to brand adapters only. `generic` is the deliberate catch-all and scores
  // below it by design; excluding it here meant it could never be selected at all, which made it
  // dead code rather than a fallback. Selecting it is a no-op either way — it carries no hints —
  // but the reported adapter name is now honest about what ran.
  if (!best || (bestScore < 0.2 && best.name !== 'generic')) {
    const generic = registry.find((adapter) => adapter.name === 'generic') ?? null;
    return { adapter: generic, score: generic ? 0.1 : bestScore, options: {} };
  }

  const hints: AdapterHints = best.hints ?? {};
  return {
    adapter: best,
    score: bestScore,
    options: {
      families: hints.families?.length ? defaultFamiliesWith(hints.families) : undefined,
      noisePatterns: hints.noisePatterns,
    },
  };
}

/** Adapter families extend the verified set; they never replace or narrow it. */
function defaultFamiliesWith(extra: AdapterHints['families']): readonly PartNumberFamily[] {
  return [...DEFAULT_PART_NUMBER_FAMILIES, ...(extra ?? [])];
}
