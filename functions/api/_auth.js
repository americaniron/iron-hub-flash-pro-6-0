// Shared auth helpers for sellparts Pages Functions.
// Schema (iron-hub-pro-db, binding `DB`):
//   app_users(username PK, password_hash, role, created_at)
//   app_sessions(token_hash PK, username, role, ua_hash, expires_at, created_at)
//   login_attempts(id, ip, username, succeeded, attempted_at)

const SESSION_TTL_DAYS = 7;

const enc = new TextEncoder();

function bytesToHex(bytes) {
  const out = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i].toString(16).padStart(2, '0');
  return out.join('');
}

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2) return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return bytesToHex(new Uint8Array(buf));
}

export function timingSafeEqualHex(a, b) {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

async function pbkdf2(password, saltBytes, iters, outBytes) {
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: iters, hash: 'SHA-256' },
    baseKey,
    outBytes * 8
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const h = await pbkdf2(password, salt, 100000, 32);
  return `pbkdf2$100000$${bytesToHex(salt)}$${bytesToHex(h)}`;
}

export async function verifyPassword(password, storedHash) {
  if (!password || !storedHash || !storedHash.startsWith('pbkdf2$')) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 4) return false;
  const iters = parseInt(parts[1], 10);
  if (!Number.isFinite(iters) || iters < 1000 || iters > 5_000_000) return false;
  const salt = hexToBytes(parts[2]);
  const expected = parts[3];
  const computed = await pbkdf2(password, salt, iters, expected.length / 2);
  return timingSafeEqualHex(bytesToHex(computed), expected);
}

export async function createSession(env, username, role, userAgent) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToHex(tokenBytes);
  const tokenHash = await sha256Hex(token);
  const uaHash = await sha256Hex(userAgent || '');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO app_sessions (token_hash, username, role, ua_hash, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(tokenHash, username, role, uaHash, expiresAt).run();
  return { token, expiresAt };
}

// Returns { username, role } or null. Tightly bound to the original UA so
// stolen tokens used from a different browser fail.
export async function resolveSession(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+([a-f0-9]{64})$/i);
  if (!m) return null;
  const tokenHash = await sha256Hex(m[1]);
  const uaHash = await sha256Hex(request.headers.get('User-Agent') || '');
  const row = await env.DB.prepare(
    'SELECT username, role, ua_hash, expires_at FROM app_sessions WHERE token_hash = ?'
  ).bind(tokenHash).first();
  if (!row) return null;
  if (row.ua_hash !== uaHash) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return { username: row.username, role: row.role };
}

export async function deleteSession(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+([a-f0-9]{64})$/i);
  if (!m) return;
  const tokenHash = await sha256Hex(m[1]);
  await env.DB.prepare('DELETE FROM app_sessions WHERE token_hash = ?').bind(tokenHash).run();
}

// Lockout policy: 5 fails within 30s → 30s deny; 6 within 5min → 5min deny;
// 7+ within 30min → 30min deny. Keyed on (ip, username).
export async function checkLockout(env, ip, username) {
  const ip30s    = await countRecentFails(env, ip, username, 30);
  if (ip30s >= 5)  return { locked: true, retryAfter: 30 };
  const ip5m     = await countRecentFails(env, ip, username, 300);
  if (ip5m >= 6)   return { locked: true, retryAfter: 300 };
  const ip30m    = await countRecentFails(env, ip, username, 1800);
  if (ip30m >= 7)  return { locked: true, retryAfter: 1800 };
  return { locked: false };
}

async function countRecentFails(env, ip, username, windowSec) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) as c FROM login_attempts WHERE ip = ? AND username = ? AND succeeded = 0 AND attempted_at > datetime('now', ?)"
  ).bind(ip, username, `-${windowSec} seconds`).first();
  return row ? row.c : 0;
}

export async function recordAttempt(env, ip, username, succeeded) {
  await env.DB.prepare(
    'INSERT INTO login_attempts (ip, username, succeeded) VALUES (?, ?, ?)'
  ).bind(ip || '0.0.0.0', username || '', succeeded ? 1 : 0).run();
}

export const CORS = {
  'Access-Control-Allow-Origin': 'https://sellparts.fixmyiron.com',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
  'Vary': 'Origin',
};

export function corsForOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = origin === 'https://sellparts.fixmyiron.com'
    || /^https:\/\/[a-f0-9]+\.iron-hub-flash-pro-6-0\.pages\.dev$/.test(origin)
    || origin === 'https://iron-hub-flash-pro-6-0.pages.dev';
  const headers = { ...CORS };
  if (allowed) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

export function jsonResponse(request, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsForOrigin(request), ...extra },
  });
}

export function unauthorized(request, msg = 'Authentication required') {
  return jsonResponse(request, { success: false, error: msg, code: 'AUTH_REQUIRED' }, 401);
}
