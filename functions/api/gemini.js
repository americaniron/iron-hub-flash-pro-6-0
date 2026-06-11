// ---------------------------------------------------------------------------
// Cloudflare Pages Function — /api/gemini
// Server-side proxy for Google Gemini AI API calls
// Uses GEMINI_API_KEY from Cloudflare Pages environment variables
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const FREE_TIER_MODELS = new Set([
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash-tts-preview',
]);

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const GEMINI_API_KEY = env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    return Response.json(
      { error: 'Gemini API key not configured on server. Please set GEMINI_API_KEY in the environment.' },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const { model, contents, config } = body;

  if (!model || !contents) {
    return Response.json(
      { error: 'Missing required fields: model, contents' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  if (!FREE_TIER_MODELS.has(model)) {
    return Response.json(
      { error: `Model ${model} is not enabled. This app is restricted to free-tier Gemini models.` },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Build the Gemini API request
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  const geminiPayload = {
    contents: typeof contents === 'string'
      ? [{ parts: [{ text: contents }] }]
      : Array.isArray(contents)
        ? contents
        : [contents],
  };

  // Map config fields to Gemini API format
  if (config) {
    const generationConfig = {};

    if (config.responseMimeType) {
      generationConfig.responseMimeType = config.responseMimeType;
    }
    if (config.responseSchema) {
      generationConfig.responseSchema = config.responseSchema;
    }
    if (config.temperature !== undefined) {
      generationConfig.temperature = config.temperature;
    }
    if (config.maxOutputTokens !== undefined) {
      generationConfig.maxOutputTokens = config.maxOutputTokens;
    }
    if (config.topP !== undefined) {
      generationConfig.topP = config.topP;
    }
    if (config.topK !== undefined) {
      generationConfig.topK = config.topK;
    }
    if (config.thinkingConfig) {
      generationConfig.thinkingConfig = config.thinkingConfig;
    }

    if (Object.keys(generationConfig).length > 0) {
      geminiPayload.generationConfig = generationConfig;
    }

    // Handle response modalities
    if (config.responseModalities) {
      geminiPayload.generationConfig = geminiPayload.generationConfig || {};
      geminiPayload.generationConfig.responseModalities = config.responseModalities;
    }

    // Handle speech config for TTS
    if (config.speechConfig) {
      geminiPayload.generationConfig = geminiPayload.generationConfig || {};
      geminiPayload.generationConfig.speechConfig = config.speechConfig;
    }
  }

  try {
    const geminiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      let errorDetail;
      try {
        errorDetail = JSON.parse(errorText);
      } catch {
        errorDetail = { message: errorText };
      }
      return Response.json(
        {
          error: 'Gemini API Error',
          details: errorDetail?.error?.message || errorText,
          status: geminiResponse.status,
        },
        { status: geminiResponse.status, headers: CORS_HEADERS }
      );
    }

    const data = await geminiResponse.json();

    // Extract text from response for compatibility with @google/genai SDK format
    let text = '';
    try {
      if (data.candidates && data.candidates[0]?.content?.parts) {
        const parts = data.candidates[0].content.parts;
        // Collect text parts
        text = parts
          .filter(p => p.text !== undefined)
          .map(p => p.text)
          .join('');
      }
    } catch {
      // If extraction fails, return raw
    }

    // Return in a format compatible with what the front-end expects
    // The front-end calls: response.text, response.candidates, etc.
    return Response.json(
      {
        text,
        candidates: data.candidates,
        usageMetadata: data.usageMetadata,
        modelVersion: data.modelVersion,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return Response.json(
      {
        error: 'Gemini API Error',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
