// C-4: disabled — see ../sellparts-security/FIXES.md
//
// Previously logged in to https://iron-hub-suite.replit.app on the caller's
// behalf and forwarded every account/quote/invoice/payment record. The
// CORS policy was * and there was no authentication on the calling side.
// Will be re-implemented as POST /api/crm/sync on iron-hub-api after
// Round 3 auth lands. Returning 501 so callers fail loudly.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost() {
  return new Response(JSON.stringify({
    success: false,
    error: 'Not implemented — IronSuite sync was disabled in security remediation 2026-05-01. Use Import/Export until the new authenticated CRM sync ships.',
  }), {
    status: 501,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
