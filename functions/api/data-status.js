// ---------------------------------------------------------------------------
// Cloudflare Pages Function — /api/data-status
// Health check for D1 database connectivity
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const DB = context.env.DB;

  if (!DB) {
    return Response.json({
      status: 'unavailable',
      message: 'D1 database not bound. Data will fall back to browser storage.',
      serverStorage: false,
    }, { headers: CORS_HEADERS });
  }

  try {
    // Quick connectivity test
    const result = await DB.prepare("SELECT COUNT(*) as count FROM user_data").first();
    return Response.json({
      status: 'connected',
      message: 'D1 cloud database is active.',
      serverStorage: true,
      totalRecords: result?.count || 0,
    }, { headers: CORS_HEADERS });
  } catch (err) {
    return Response.json({
      status: 'error',
      message: 'D1 database error: ' + err.message,
      serverStorage: false,
    }, { headers: CORS_HEADERS });
  }
}
