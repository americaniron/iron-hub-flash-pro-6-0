// ---------------------------------------------------------------------------
// Cloudflare Pages Function — /api/data
// Server-side persistent data storage using Cloudflare D1 (SQLite).
//
// Round 3 (C-1/C-2/C-6): authenticated. Sessions are issued by /api/auth/login
// and presented as `Authorization: Bearer <hex64>`. The session's username is
// the only username this endpoint will read or write — the `?username=` /
// body.username field is now ignored (kept in the URL surface so old clients
// don't 400, but cross-user access is impossible).
// ---------------------------------------------------------------------------

import { resolveSession, corsForOrigin, jsonResponse, unauthorized } from './_auth.js';

const VALID_STORES = [
  'accounts', 'quotes', 'invoices', 'payments', 'credits',
  'drafts', 'recurring_invoices', 'templates', 'parts_image_pool', 'inventory'
];

const CHUNK_SIZE = 800_000; // ~1MB D1 row limit, with headroom

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsForOrigin(request) });
}

async function readStore(DB, username, store) {
  const row = await DB.prepare(
    'SELECT data FROM user_data WHERE username = ? AND store_name = ?'
  ).bind(username, store).first();
  if (row) return JSON.parse(row.data);

  const chunks = await DB.prepare(
    'SELECT store_name, data FROM user_data WHERE username = ? AND store_name LIKE ? ORDER BY store_name ASC'
  ).bind(username, `${store}__chunk_%`).all();
  if (chunks?.results?.length) {
    let combined = '';
    for (const c of chunks.results) combined += c.data;
    return JSON.parse(combined);
  }
  return null;
}

async function writeStore(DB, username, store, data) {
  const json = JSON.stringify(data);
  await DB.prepare(
    'DELETE FROM user_data WHERE username = ? AND (store_name = ? OR store_name LIKE ?)'
  ).bind(username, store, `${store}__chunk_%`).run();

  if (json.length <= CHUNK_SIZE) {
    await DB.prepare(
      "INSERT INTO user_data (username, store_name, data, updated_at) VALUES (?, ?, ?, datetime('now'))"
    ).bind(username, store, json).run();
    return;
  }
  const stmts = [];
  let idx = 0;
  for (let off = 0; off < json.length; off += CHUNK_SIZE) {
    const chunkData = json.substring(off, off + CHUNK_SIZE);
    const chunkName = `${store}__chunk_${String(idx).padStart(4, '0')}`;
    stmts.push(DB.prepare(
      "INSERT INTO user_data (username, store_name, data, updated_at) VALUES (?, ?, ?, datetime('now'))"
    ).bind(username, chunkName, chunkData));
    idx++;
  }
  if (stmts.length) await DB.batch(stmts);
}

async function deleteStore(DB, username, store) {
  await DB.prepare(
    'DELETE FROM user_data WHERE username = ? AND (store_name = ? OR store_name LIKE ?)'
  ).bind(username, store, `${store}__chunk_%`).run();
}

function getDefaultForStore(storeName) {
  if (storeName === 'credits') return 1000;
  if (storeName === 'drafts') return null;
  if (storeName === 'parts_image_pool') return {};
  return [];
}

async function requireAuth(request, env) {
  const session = await resolveSession(request, env);
  if (!session) return null;
  return session;
}

export async function onRequestGet({ request, env }) {
  const session = await requireAuth(request, env);
  if (!session) return unauthorized(request);
  const username = session.username; // session-bound, NOT from query
  const url = new URL(request.url);
  const store = url.searchParams.get('store');
  if (!env.DB) return jsonResponse(request, { error: 'DB binding missing' }, 500);

  try {
    if (store) {
      if (!VALID_STORES.includes(store)) {
        return jsonResponse(request, { error: `Invalid store: ${store}` }, 400);
      }
      const data = await readStore(env.DB, username, store);
      return jsonResponse(request, { success: true, data: data !== null ? data : getDefaultForStore(store) });
    }
    const result = {};
    for (const s of VALID_STORES) result[s] = getDefaultForStore(s);
    for (const s of VALID_STORES) {
      const data = await readStore(env.DB, username, s);
      if (data !== null) result[s] = data;
    }
    return jsonResponse(request, { success: true, data: result });
  } catch (err) {
    return jsonResponse(request, { error: 'Database read failed', details: err.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const session = await requireAuth(request, env);
  if (!session) return unauthorized(request);
  const username = session.username;
  if (!env.DB) return jsonResponse(request, { error: 'DB binding missing' }, 500);

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse(request, { error: 'Invalid JSON body' }, 400); }

  const { store, data } = body;
  if (!store) return jsonResponse(request, { error: 'Missing store' }, 400);
  if (!VALID_STORES.includes(store)) return jsonResponse(request, { error: `Invalid store: ${store}` }, 400);

  try {
    await writeStore(env.DB, username, store, data);
    return jsonResponse(request, { success: true });
  } catch (err) {
    return jsonResponse(request, { error: 'Database write failed', details: err.message }, 500);
  }
}

export async function onRequestPut({ request, env }) {
  const session = await requireAuth(request, env);
  if (!session) return unauthorized(request);
  const username = session.username;
  if (!env.DB) return jsonResponse(request, { error: 'DB binding missing' }, 500);

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse(request, { error: 'Invalid JSON body' }, 400); }

  const { stores } = body;
  if (!stores || typeof stores !== 'object') {
    return jsonResponse(request, { error: 'Missing stores' }, 400);
  }

  try {
    let storesWritten = 0;
    for (const [storeName, data] of Object.entries(stores)) {
      if (VALID_STORES.includes(storeName)) {
        await writeStore(env.DB, username, storeName, data);
        storesWritten++;
      }
    }
    return jsonResponse(request, { success: true, storesWritten });
  } catch (err) {
    return jsonResponse(request, { error: 'Bulk write failed', details: err.message }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const session = await requireAuth(request, env);
  if (!session) return unauthorized(request);
  const username = session.username;
  if (!env.DB) return jsonResponse(request, { error: 'DB binding missing' }, 500);
  const url = new URL(request.url);
  const store = url.searchParams.get('store');

  try {
    if (store) {
      await deleteStore(env.DB, username, store);
    } else {
      await env.DB.prepare('DELETE FROM user_data WHERE username = ?').bind(username).run();
    }
    return jsonResponse(request, { success: true });
  } catch (err) {
    return jsonResponse(request, { error: 'Delete failed', details: err.message }, 500);
  }
}
