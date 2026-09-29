import { Adapter } from './types.ts';

/**
 * The fallback.  Always applicable, contributes nothing, and exists so the registry is never
 * empty — the core's own behaviour is what actually parses an unrecognised supplier.
 */
export const genericAdapter: Adapter = {
  name: 'generic',
  detect: () => 0.1,
};
