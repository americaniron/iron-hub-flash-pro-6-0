import {
  verifyPassword, createSession,
  checkLockout, recordAttempt,
  corsForOrigin, jsonResponse,
} from '../_auth.js';

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsForOrigin(request) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); }
  catch { return jsonResponse(request, { success: false, error: 'Invalid JSON' }, 400); }
  const username = (body.username || '').toString().trim();
  const password = (body.password || '').toString();
  if (!username || !password) {
    return jsonResponse(request, { success: false, error: 'Missing username or password' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';

  const lock = await checkLockout(env, ip, username);
  if (lock.locked) {
    return jsonResponse(request, {
      success: false,
      error: `Too many failed attempts. Try again in ${lock.retryAfter} seconds.`,
      retryAfter: lock.retryAfter,
    }, 429, { 'Retry-After': String(lock.retryAfter) });
  }

  const user = await env.DB.prepare(
    'SELECT username, password_hash, role FROM app_users WHERE username = ?'
  ).bind(username).first();
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  await recordAttempt(env, ip, username, ok);
  if (!ok) {
    return jsonResponse(request, { success: false, error: 'Invalid username or password' }, 401);
  }

  const ua = request.headers.get('User-Agent') || '';
  const { token, expiresAt } = await createSession(env, user.username, user.role, ua);
  return jsonResponse(request, {
    success: true,
    token,
    expiresAt,
    username: user.username,
    role: user.role,
  });
}
