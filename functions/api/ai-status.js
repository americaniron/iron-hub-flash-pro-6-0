// ---------------------------------------------------------------------------
// Cloudflare Pages Function — /api/ai-status
// Returns whether production AI providers are configured
// ---------------------------------------------------------------------------

const H = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export async function onRequestGet(context) {
  const { env } = context;
  const anthropicConfigured = !!env.ANTHROPIC_API_KEY;
  const elevenLabsConfigured = !!env.ELEVENLABS_API_KEY;
  return Response.json(
    {
      configured: anthropicConfigured && elevenLabsConfigured,
      mode: 'server-proxy',
      providers: {
        anthropic: anthropicConfigured,
        elevenlabs: elevenLabsConfigured,
        gemini: !!env.GEMINI_API_KEY,
      },
    },
    { status: 200, headers: H }
  );
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: H });
}
