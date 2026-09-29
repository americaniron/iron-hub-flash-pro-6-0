import { Adapter } from './types.ts';

/**
 * Detection-only adapters for suppliers we expect but have no sample document for yet.
 *
 * Each one identifies its brand and contributes no hints, so a quote from these suppliers is
 * parsed by the geometry core exactly as an unrecognised one would be — the adapter only makes
 * the brand visible in logs and confidence.  Fill in `hints` when a real PDF arrives; add a
 * fixture at the same time, because a hint set with no fixture is untested vocabulary.
 */
function brandStub(name: string, patterns: RegExp[]): Adapter {
  return {
    name,
    detect: ({ text }) => (patterns.some((p) => p.test(text)) ? 0.6 : 0),
  };
}

// TODO: add column hints and noise patterns once a real quote for each is available.
export const komatsuAdapter = brandStub('komatsu', [/\bkomatsu\b/i]);
export const hitachiAdapter = brandStub('hitachi', [/\bhitachi\b/i, /\bdeere-hitachi\b/i]);
export const volvoAdapter = brandStub('volvo', [/\bvolvo\s+(?:ce|construction|parts)\b/i]);
export const johnDeereAdapter = brandStub('john-deere', [/\bjohn\s*deere\b/i, /\bdobbs\s+equipment\b/i]);
export const caseAdapter = brandStub('case', [/\bcase\s+(?:construction|ce|ih)\b/i]);
export const bobcatAdapter = brandStub('bobcat', [/\bbobcat\b/i, /\bdoosan\s+bobcat\b/i]);
export const napaAdapter = brandStub('napa', [/\bnapa\s+(?:auto\s+)?parts\b/i]);
export const fleetguardAdapter = brandStub('fleetguard', [/\bfleetguard\b/i]);
export const donaldsonAdapter = brandStub('donaldson', [/\bdonaldson\b/i]);
export const interstateAdapter = brandStub('interstate', [/\binterstate\s+batteries\b/i]);
