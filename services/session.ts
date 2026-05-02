/**
 * Session management for sellparts.fixmyiron.com.
 *
 * Round 3 (C-1/C-2/C-6): replaces the legacy `iron_hub_user` localStorage
 * "session" (which stored only a username and accepted any value at the
 * /api/data layer) with a server-issued bearer token.
 *
 * The session is created by POST /api/auth/login → { token, expiresAt, role,
 * username }. Token must be presented as `Authorization: Bearer <hex64>` on
 * every authenticated API call. The server binds the token to the original
 * User-Agent — switching browsers invalidates it.
 */

const STORAGE_KEY = 'ih_session';
const LEGACY_KEY = 'iron_hub_user';

export interface IhSession {
  token: string;
  expiresAt: string; // ISO
  username: string;
  role: string;
  displayName?: string;
}

export function readSession(): IhSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as IhSession;
    if (!s || !s.token || !s.expiresAt) return null;
    if (new Date(s.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function writeSession(s: IhSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  // Drop the legacy unauthenticated marker if present.
  localStorage.removeItem(LEGACY_KEY);
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_KEY);
}

let on401: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) { on401 = fn; }

/**
 * fetch() wrapper that:
 *  - injects Authorization: Bearer <token> when a session exists
 *  - calls the registered 401 handler (e.g. force-logout) if the server says
 *    the session is dead
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const sess = readSession();
  const headers = new Headers(init.headers || {});
  if (sess) headers.set('Authorization', `Bearer ${sess.token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 && sess) {
    clearSession();
    if (on401) try { on401(); } catch {}
  }
  return res;
}

export async function login(username: string, password: string): Promise<IhSession> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  let body: any = null;
  try { body = await res.json(); } catch {}
  if (!res.ok || !body?.success) {
    throw new Error(body?.error || `Login failed (${res.status})`);
  }
  const s: IhSession = {
    token: body.token,
    expiresAt: body.expiresAt,
    username: body.username,
    role: body.role,
  };
  writeSession(s);
  return s;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {}
  clearSession();
}
