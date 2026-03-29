// One-time seed endpoint to populate inventory in D1
// DELETE THIS FILE after seeding is complete

import { SEED_INVENTORY } from './inventory-seed-data.js';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const CHUNK_SIZE = 800000;

export async function onRequestPost(context) {
  const { env } = context;
  const DB = env.DB;
  if (!DB) return Response.json({ error: 'No DB' }, { status: 500, headers: CORS_HEADERS });

  const url = new URL(context.request.url);
  const username = url.searchParams.get('username') || 'ironman1111';

  try {
    const jsonData = JSON.stringify(SEED_INVENTORY);
    
    // Delete old inventory data
    await DB.prepare(
      "DELETE FROM user_data WHERE username = ? AND (store_name = 'inventory' OR store_name LIKE 'inventory__chunk_%')"
    ).bind(username).run();

    if (jsonData.length <= CHUNK_SIZE) {
      await DB.prepare(
        "INSERT INTO user_data (username, store_name, data, updated_at) VALUES (?, 'inventory', ?, datetime('now'))"
      ).bind(username, jsonData).run();
    } else {
      const statements = [];
      let idx = 0;
      for (let off = 0; off < jsonData.length; off += CHUNK_SIZE) {
        const chunk = jsonData.substring(off, off + CHUNK_SIZE);
        const name = 'inventory__chunk_' + String(idx).padStart(4, '0');
        statements.push(
          DB.prepare(
            "INSERT INTO user_data (username, store_name, data, updated_at) VALUES (?, ?, ?, datetime('now'))"
          ).bind(username, name, chunk)
        );
        idx++;
      }
      await DB.batch(statements);
    }

    return Response.json({ 
      success: true, 
      items: SEED_INVENTORY.length,
      size: jsonData.length,
      username 
    }, { headers: CORS_HEADERS });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers: CORS_HEADERS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
