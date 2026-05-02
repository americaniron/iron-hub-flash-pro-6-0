// C-4: disabled — see ../sellparts-security/FIXES.md
//
// Previously proxied a username/password login to
// https://iron-hub-suite.replit.app and returned the session cookie.
// Returning 501 so callers fail loudly.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost() {
  return new Response(JSON.stringify({
    success: false,
    error: 'Not implemented — IronSuite proxy login was disabled in security remediation 2026-05-01.',
  }), {
    status: 501,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
