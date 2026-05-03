// ---------------------------------------------------------------------------
// Cloudflare Pages Function — /api/data
// Server-side persistent data storage using Cloudflare D1 (SQLite)
// Supports chunked storage for large data (inventory, quotes, etc.)
// D1 binding name: DB (configured in Cloudflare Pages dashboard)
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const VALID_STORES = [
  'accounts', 'quotes', 'invoices', 'payments', 'credits',
  'drafts', 'recurring_invoices', 'templates', 'parts_image_pool', 'inventory'
];

// D1 has a ~1MB row limit; we chunk at 800KB to be safe
const CHUNK_SIZE = 800_000;

// ---------------------------------------------------------------------------
// IRON-HUB-SUITE BRIDGE
// After every successful write, fire a background POST per added/changed record
// to https://api.suite.fixmyiron.com/api/bridge/<entity>. The Suite endpoints are
// upserts (resolve-by-key, update-if-exists, insert-otherwise) so we don't have
// to track create-vs-update separately.
//
// Replaces the old client-side services/bridgeSync.ts that was neutered in the
// security C-4 fix because it shipped the API key in public JS. The key lives
// on the Pages secret IRONSUITE_BRIDGE_API_KEY and never reaches the browser.
//
// In scope for v1: accounts, invoices, quotes, payments, inventory.
// Deferred:        templates / recurring_invoices (no bridge endpoint),
//                  activity / journal (driven by event hooks, not /api/data).
// ---------------------------------------------------------------------------

const BRIDGE_BASE = 'https://api.suite.fixmyiron.com/api/bridge';

function bridgeHandlerFor(store) {
  switch (store) {
    case 'accounts':  return { kind: 'single', endpoint: 'customer', transform: toCustomer };
    case 'invoices':  return { kind: 'single', endpoint: 'invoice',  transform: toInvoice };
    case 'quotes':    return { kind: 'single', endpoint: 'quote',    transform: toQuote };
    case 'inventory': return { kind: 'bulk',   endpoint: 'import-items',    wrap: arr => ({ items: arr.map(toItem) }) };
    case 'payments':  return { kind: 'bulk',   endpoint: 'import-payments', wrap: arr => ({ payments: arr.map(toPayment) }) };
    default:          return null;
  }
}

function toCustomer(c) {
  return {
    name: c.contactName || c.company,
    email: c.email || undefined,
    phone: c.phone || undefined,
    company: c.company || undefined,
    address: c.billingAddress || undefined,
    city: c.billingCity || undefined,
    state: c.billingState || undefined,
    zip: c.billingZip || undefined,
    accountNumber: c.accountNumber || undefined,
  };
}

function toInvoice(inv) {
  // Bridge upserts by invoiceNumber; alias id → invoiceNumber and pass the rest through.
  return { invoiceNumber: inv.id, ...inv };
}

function toQuote(q) {
  // SavedQuote nests the document under `payload`; flatten the bits the bridge cares about.
  return {
    quoteNumber: q.id,
    title: q.title,
    total: q.total,
    timestamp: q.timestamp,
    author: q.author,
    client: q.payload?.client,
    items: q.payload?.items,
    aiAnalysis: q.payload?.aiAnalysis,
  };
}

function toItem(p) {
  return { partNo: p.partNo, description: p.description, price: p.originalPrice };
}

function toPayment(p) {
  return p;
}

// Diff prev vs next by `id`; return only added or content-changed records.
function diffById(prev, next) {
  const prevMap = new Map((Array.isArray(prev) ? prev : []).map(r => [r?.id, r]));
  const out = [];
  for (const rec of (Array.isArray(next) ? next : [])) {
    if (!rec || !rec.id) continue;
    const before = prevMap.get(rec.id);
    if (!before || JSON.stringify(before) !== JSON.stringify(rec)) {
      out.push(rec);
    }
  }
  return out;
}

async function postBridge(env, endpoint, body) {
  if (!env.IRONSUITE_BRIDGE_API_KEY) {
    console.warn(`[bridge] IRONSUITE_BRIDGE_API_KEY not set; skipping POST /${endpoint}`);
    return;
  }
  try {
    const res = await fetch(`${BRIDGE_BASE}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': env.IRONSUITE_BRIDGE_API_KEY },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[bridge] POST /${endpoint} → ${res.status}: ${text.slice(0, 300)}`);
    }
  } catch (err) {
    console.error(`[bridge] POST /${endpoint} fetch failed:`, err?.message || err);
  }
}

async function notifyBridgeChanges(env, store, prevData, newData) {
  const handler = bridgeHandlerFor(store);
  if (!handler) return;
  const changed = diffById(prevData, newData);
  if (changed.length === 0) return;
  if (handler.kind === 'single') {
    await Promise.all(changed.map(rec => postBridge(env, handler.endpoint, handler.transform(rec))));
  } else {
    await postBridge(env, handler.endpoint, handler.wrap(changed));
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// ---- Chunking helpers ----

// Read a store, reassembling chunks if they exist
async function readStore(DB, username, store) {
  // First try the main row (non-chunked)
  const row = await DB.prepare(
    'SELECT data FROM user_data WHERE username = ? AND store_name = ?'
  ).bind(username, store).first();

  if (row) {
    return JSON.parse(row.data);
  }

  // Check for chunked data
  const chunks = await DB.prepare(
    `SELECT store_name, data FROM user_data
     WHERE username = ? AND store_name LIKE ?
     ORDER BY store_name ASC`
  ).bind(username, `${store}__chunk_%`).all();

  if (chunks && chunks.results && chunks.results.length > 0) {
    // Reassemble chunks
    let combined = '';
    for (const chunk of chunks.results) {
      combined += chunk.data;
    }
    return JSON.parse(combined);
  }

  return null; // No data found
}

// Write a store, chunking if necessary
async function writeStore(DB, username, store, data) {
  const jsonData = JSON.stringify(data);

  // First, delete any existing chunks AND the main row for this store
  await DB.prepare(
    `DELETE FROM user_data WHERE username = ? AND (store_name = ? OR store_name LIKE ?)`
  ).bind(username, store, `${store}__chunk_%`).run();

  if (jsonData.length <= CHUNK_SIZE) {
    // Fits in a single row
    await DB.prepare(
      `INSERT INTO user_data (username, store_name, data, updated_at)
       VALUES (?, ?, ?, datetime('now'))`
    ).bind(username, store, jsonData).run();
  } else {
    // Split into chunks
    const statements = [];
    let chunkIndex = 0;
    for (let offset = 0; offset < jsonData.length; offset += CHUNK_SIZE) {
      const chunkData = jsonData.substring(offset, offset + CHUNK_SIZE);
      const chunkName = `${store}__chunk_${String(chunkIndex).padStart(4, '0')}`;
      statements.push(
        DB.prepare(
          `INSERT INTO user_data (username, store_name, data, updated_at)
           VALUES (?, ?, ?, datetime('now'))`
        ).bind(username, chunkName, chunkData)
      );
      chunkIndex++;
    }
    if (statements.length > 0) {
      await DB.batch(statements);
    }
    console.log(`[data.js] Stored '${store}' for ${username} in ${chunkIndex} chunks (~${(jsonData.length / 1024).toFixed(0)}KB)`);
  }
}

// Delete a store including any chunks
async function deleteStore(DB, username, store) {
  await DB.prepare(
    `DELETE FROM user_data WHERE username = ? AND (store_name = ? OR store_name LIKE ?)`
  ).bind(username, store, `${store}__chunk_%`).run();
}


// GET /api/data?username=xxx&store=yyy  — Read data for a user+store
export async function onRequestGet(context) {
  const { env } = context;
  const url = new URL(context.request.url);
  const username = url.searchParams.get('username');
  const store = url.searchParams.get('store');

  if (!username) {
    return Response.json({ error: 'Missing username parameter' }, { status: 400, headers: CORS_HEADERS });
  }

  const DB = env.DB;
  if (!DB) {
    return Response.json({ error: 'D1 database not bound. Please configure DB binding in Cloudflare Pages settings.' }, { status: 500, headers: CORS_HEADERS });
  }

  try {
    // If store is specified, return just that store's data
    if (store) {
      if (!VALID_STORES.includes(store)) {
        return Response.json({ error: `Invalid store: ${store}` }, { status: 400, headers: CORS_HEADERS });
      }

      const data = await readStore(DB, username, store);
      return Response.json({ success: true, data: data !== null ? data : getDefaultForStore(store) }, { headers: CORS_HEADERS });
    }

    // No store specified — return ALL stores for this user (bulk export)
    const result = {};
    for (const s of VALID_STORES) {
      result[s] = getDefaultForStore(s);
    }

    // Read all stores (including chunked ones)
    for (const s of VALID_STORES) {
      const data = await readStore(DB, username, s);
      if (data !== null) {
        result[s] = data;
      }
    }

    return Response.json({ success: true, data: result }, { headers: CORS_HEADERS });

  } catch (err) {
    console.error('D1 read error:', err);
    return Response.json({ error: 'Database read failed', details: err.message }, { status: 500, headers: CORS_HEADERS });
  }
}

// POST /api/data  — Write data for a user+store (auto-chunks if needed)
// Body: { username, store, data }
export async function onRequestPost(context) {
  const { env, request } = context;

  const DB = env.DB;
  if (!DB) {
    return Response.json({ error: 'D1 database not bound.' }, { status: 500, headers: CORS_HEADERS });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS_HEADERS });
  }

  const { username, store, data } = body;

  if (!username || !store) {
    return Response.json({ error: 'Missing username or store' }, { status: 400, headers: CORS_HEADERS });
  }

  if (!VALID_STORES.includes(store)) {
    return Response.json({ error: `Invalid store: ${store}` }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    // Read prior state BEFORE writing so we can diff and notify the bridge of just the
    // added/changed records — avoids blasting the whole array to Suite on every save.
    const prevData = bridgeHandlerFor(store) ? await readStore(DB, username, store).catch(() => null) : null;

    await writeStore(DB, username, store, data);

    if (context.waitUntil && bridgeHandlerFor(store)) {
      context.waitUntil(notifyBridgeChanges(env, store, prevData, data));
    }
    return Response.json({ success: true }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error('D1 write error:', err);
    return Response.json({ error: 'Database write failed', details: err.message }, { status: 500, headers: CORS_HEADERS });
  }
}

// PUT /api/data  — Bulk import all stores for a user
// Body: { username, stores: { accounts: [...], quotes: [...], ... } }
export async function onRequestPut(context) {
  const { env, request } = context;

  const DB = env.DB;
  if (!DB) {
    return Response.json({ error: 'D1 database not bound.' }, { status: 500, headers: CORS_HEADERS });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS_HEADERS });
  }

  const { username, stores } = body;

  if (!username || !stores) {
    return Response.json({ error: 'Missing username or stores' }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    let storesWritten = 0;
    // Read prior state for every store that has a bridge mapping, so we can diff
    // post-write. Reads happen up-front in parallel to keep latency down.
    const prevByStore = {};
    const bridgedStores = Object.keys(stores).filter(s => VALID_STORES.includes(s) && bridgeHandlerFor(s));
    await Promise.all(bridgedStores.map(async s => {
      prevByStore[s] = await readStore(DB, username, s).catch(() => null);
    }));

    for (const [storeName, data] of Object.entries(stores)) {
      if (VALID_STORES.includes(storeName)) {
        await writeStore(DB, username, storeName, data);
        storesWritten++;
      }
    }

    if (context.waitUntil && bridgedStores.length > 0) {
      context.waitUntil(Promise.all(
        bridgedStores.map(s => notifyBridgeChanges(env, s, prevByStore[s], stores[s]))
      ));
    }

    return Response.json({ success: true, storesWritten }, { headers: CORS_HEADERS });

  } catch (err) {
    console.error('D1 bulk write error:', err);
    return Response.json({ error: 'Bulk write failed', details: err.message }, { status: 500, headers: CORS_HEADERS });
  }
}

// DELETE /api/data?username=xxx&store=yyy  — Delete a specific store for a user
export async function onRequestDelete(context) {
  const { env } = context;
  const url = new URL(context.request.url);
  const username = url.searchParams.get('username');
  const store = url.searchParams.get('store');

  if (!username) {
    return Response.json({ error: 'Missing username' }, { status: 400, headers: CORS_HEADERS });
  }

  const DB = env.DB;
  if (!DB) {
    return Response.json({ error: 'D1 database not bound.' }, { status: 500, headers: CORS_HEADERS });
  }

  try {
    if (store) {
      await deleteStore(DB, username, store);
    } else {
      // Delete ALL stores for this user (including chunks)
      await DB.prepare(
        'DELETE FROM user_data WHERE username = ?'
      ).bind(username).run();
    }

    return Response.json({ success: true }, { headers: CORS_HEADERS });

  } catch (err) {
    console.error('D1 delete error:', err);
    return Response.json({ error: 'Delete failed', details: err.message }, { status: 500, headers: CORS_HEADERS });
  }
}

function getDefaultForStore(storeName) {
  if (storeName === 'credits') return 1000;
  if (storeName === 'drafts') return null;
  if (storeName === 'parts_image_pool') return {};
  return [];
}
