// ---------------------------------------------------------------------------
// Cloudflare Pages Function — /api/ai-status
// Returns whether GEMINI_API_KEY is configured
// ---------------------------------------------------------------------------

const H = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export async function onRequestGet(context) {
  const { env } = context;
  return Response.json(
    { configured: !!env.GEMINI_API_KEY, mode: 'server-proxy' },
    { status: 200, headers: H }
  );
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: H });
}
