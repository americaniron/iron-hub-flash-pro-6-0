/**
 * Organization branding — resolved from the server, never from component state.
 *
 * The logo used to live in `useState('/logo.png')` and an upload only ever set that state. The
 * Suite remounts this application's iframe on every route change, so the logo was gone the moment
 * the user navigated away and had to be uploaded again; a reload or a new session lost it too.
 *
 * The Suite has stored an organization's logo in R2 with its URL on `organizations.logo_url` all
 * along. This asks for it.
 *
 * Two contexts, one source of truth:
 *   * embedded — the Suite shell pushes branding into the frame on every mount over postMessage,
 *     and `/api/branding` through the proxy is the fallback if that message never arrives;
 *   * standalone — `/api/branding` directly, with the last resolved value cached in localStorage
 *     so a cold start paints the right logo before the network answers.
 *
 * The bundled default is used only when the organization has genuinely never uploaded one.
 */
import { hubApiFetch, resolveHubApiInput } from './hubApi.ts';

export const DEFAULT_LOGO = '/logo.png';
const CACHE_KEY = 'ironhub.branding.v1';
const BRANDING_ENDPOINT = '/api/branding';
const HANDSHAKE_TIMEOUT_MS = 2500;

export interface Branding {
  logoUrl: string | null;
  hasCustomLogo: boolean;
  organizationName: string | null;
  organizationId?: string | null;
}

export const EMPTY_BRANDING: Branding = {
  logoUrl: null,
  hasCustomLogo: false,
  organizationName: null,
  organizationId: null,
};

/** True when this app is running inside the Suite shell. */
export function isEmbedded(): boolean {
  if (typeof window === 'undefined') return false;
  // The proxy URL carries ?suite_frame=..., and the frame lives under /hub-proxy. Either is
  // sufficient; the frame check covers a shell that stops sending the parameter.
  const params = new URLSearchParams(window.location.search);
  if (params.has('suite_frame')) return true;
  if (window.location.pathname.startsWith('/hub-proxy')) return true;
  try {
    return window.self !== window.top;
  } catch {
    // A cross-origin parent throws on access, which is itself proof of being framed.
    return true;
  }
}

/**
 * An asset path is absolute from the Suite's own origin. Inside the iframe every absolute path is
 * served under /hub-proxy, so the URL has to be moved there or the image 404s.
 */
export function resolveBrandingUrl(logoUrl: string | null | undefined): string {
  const url = (logoUrl || '').trim();
  if (!url) return DEFAULT_LOGO;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (!url.startsWith('/')) return url;
  const resolved = resolveHubApiInput(url);
  return typeof resolved === 'string' ? resolved : url;
}

function readCache(): Branding | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Branding;
    return parsed && typeof parsed === 'object' ? { ...EMPTY_BRANDING, ...parsed } : null;
  } catch {
    return null;
  }
}

function writeCache(branding: Branding): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(branding));
  } catch {
    // A full or blocked storage quota must not stop the app from rendering.
  }
}

function normalize(value: unknown): Branding | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (!('logoUrl' in source) && !('hasCustomLogo' in source)) return null;
  const logoUrl = typeof source.logoUrl === 'string' && source.logoUrl.trim() ? source.logoUrl.trim() : null;
  return {
    logoUrl,
    hasCustomLogo: source.hasCustomLogo === true || !!logoUrl,
    organizationName: typeof source.organizationName === 'string' ? source.organizationName : null,
    organizationId: typeof source.organizationId === 'string' ? source.organizationId : null,
  };
}

/** Branding the Suite shell pushes over postMessage. Resolves null if the shell stays silent. */
function awaitHandshakeBranding(): Promise<Branding | null> {
  if (!isEmbedded() || typeof window === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: Branding | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown; branding?: unknown } | null;
      if (!data || typeof data !== 'object' || data.type !== 'iron-suite-branding') return;
      finish(normalize(data.branding));
    };
    window.addEventListener('message', onMessage);
    const timer = window.setTimeout(() => finish(null), HANDSHAKE_TIMEOUT_MS);
    try {
      window.parent?.postMessage({ type: 'iron-hub-branding-request', from: 'ironhub' }, window.location.origin);
    } catch {
      finish(null);
    }
  });
}

async function fetchBranding(): Promise<Branding | null> {
  try {
    const response = await hubApiFetch(BRANDING_ENDPOINT, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return null;
    return normalize(await response.json());
  } catch {
    return null;
  }
}

/**
 * The organization's branding, from the server when it can be reached and from the last known
 * value when it cannot. Never returns the bundled default in place of a real logo.
 */
export async function loadBranding(): Promise<Branding> {
  const cached = readCache();
  const handshake = await awaitHandshakeBranding();
  if (handshake) {
    writeCache(handshake);
    return handshake;
  }
  const fetched = await fetchBranding();
  if (fetched) {
    writeCache(fetched);
    return fetched;
  }
  // Offline or unauthenticated: the last logo this browser saw beats the bundled default.
  return cached ?? EMPTY_BRANDING;
}

export type BrandingSaveResult =
  | { saved: true; branding: Branding }
  | { saved: false; error: string };

/**
 * Persist a newly chosen logo for the whole organization.
 *
 * A failure is reported rather than swallowed: the caller must be able to tell the user the logo
 * is only on this screen, because that is precisely the state this issue was about.
 */
export async function saveBrandingLogo(dataUrl: string, filename?: string): Promise<BrandingSaveResult> {
  try {
    const response = await hubApiFetch(BRANDING_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl, filename }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      return { saved: false, error: String(body.error || body.message || `HTTP ${response.status}`) };
    }
    const branding = normalize(body);
    if (!branding) return { saved: false, error: 'The Suite accepted the logo but did not return its address.' };
    writeCache(branding);
    return { saved: true, branding };
  } catch (error) {
    return { saved: false, error: error instanceof Error ? error.message : 'The logo could not be uploaded.' };
  }
}
