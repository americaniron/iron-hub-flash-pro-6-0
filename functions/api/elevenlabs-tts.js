// ---------------------------------------------------------------------------
// Cloudflare Pages Function — /api/elevenlabs-tts
// Server-side proxy for ElevenLabs Text-to-Speech API
// Uses ELEVENLABS_API_KEY from Cloudflare Pages environment variables
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const ELEVENLABS_API_KEY = env.ELEVENLABS_API_KEY;

  if (!ELEVENLABS_API_KEY) {
    return Response.json(
      { error: 'ElevenLabs API key not configured. Please set ELEVENLABS_API_KEY in Cloudflare Pages environment.' },
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  const {
    text,
    voice_id = 'pNInz6obpgDQGcFmaJgB',  // "Adam" — deep professional male voice
    model_id = 'eleven_multilingual_v2',    // Supports English + Arabic
    stability = 0.5,
    similarity_boost = 0.75,
  } = body;

  if (!text) {
    return Response.json(
      { error: 'Missing required field: text' },
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  const apiUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id,
        voice_settings: {
          stability,
          similarity_boost,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorDetail;
      try { errorDetail = JSON.parse(errorText); } catch { errorDetail = { message: errorText }; }
      return Response.json(
        { error: 'ElevenLabs API Error', details: errorDetail?.detail?.message || errorText, status: response.status },
        { status: response.status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Convert audio buffer to base64
    const audioBuffer = await response.arrayBuffer();
    const base64Audio = btoa(
      new Uint8Array(audioBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    return Response.json(
      { audioBase64: base64Audio, mimeType: 'audio/mpeg' },
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return Response.json(
      { error: 'ElevenLabs API Error', details: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
}
