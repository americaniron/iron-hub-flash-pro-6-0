import { Adapter, AdapterContext } from './types.ts';

/**
 * Caterpillar — Parts.Cat.Com order summaries, dealer-branded prints (BOYD CAT, Ring Power)
 * and IRON HUB's own Caterpillar quotes.
 *
 * Contributes only vocabulary.  The column layout is discovered from the header like any other
 * document; nothing here is required for the September 2026 Parts.Cat.Com order to parse.
 */
export const caterpillarAdapter: Adapter = {
  name: 'caterpillar',
  detect({ text }: AdapterContext): number {
    let score = 0;
    if (/parts\.cat\.com/i.test(text)) score += 0.5;
    if (/\bpayment\s*&\s*summary\b/i.test(text)) score += 0.2;
    if (/\bCAT\b|\bCATERPILLAR\b/i.test(text)) score += 0.2;
    if (/\b\d{3}-\d{4}\s*:/.test(text)) score += 0.3;
    if (/\bitems\s+in\s+your\s+order\b/i.test(text)) score += 0.2;
    return Math.min(1, score);
  },
  hints: {
    // No extra families: the shapes Caterpillar uses (539-0546, 10R-7672) are already in the
    // verified default set, and an adapter-supplied duplicate of `cat-alpha` only made the
    // family list longer to no effect.
    noisePatterns: [
      /^non-?returnable\s+part\b/i,
      /^remanufactured\s+part\b/i,
      /^core\s+deposit\b/i,
      /^weight\s*\(/i,
      /^see\s+details$/i,
      /^add\s+to\s+(?:cart|my\s+lists)$/i,
    ],
  },
};
