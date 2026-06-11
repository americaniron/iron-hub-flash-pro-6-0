// ---------------------------------------------------------------------------
// Cloudflare Pages Function — /api/ai-status
// Returns whether production Gemini AI is configured
// ---------------------------------------------------------------------------

const H = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export async function onRequestGet(context) {
  const { env } = context;
  const geminiConfigured = !!env.GEMINI_API_KEY;
  return Response.json(
    {
      configured: geminiConfigured,
      mode: 'server-proxy',
      providers: {
        gemini: geminiConfigured,
      },
    },
    { status: 200, headers: H }
  );
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: H });
}
