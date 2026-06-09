// ---------------------------------------------------------------------------
// Cloudflare Pages Function — /api/claude
// Server-side proxy for Anthropic Claude API + Image Generation
// Uses ANTHROPIC_API_KEY from Cloudflare Pages environment variables
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const DEFAULT_TEXT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_IMAGE_MODEL = 'claude-sonnet-4-6';
const MAX_MANUAL_THINKING_TOKENS = 60000;

function normalizeTextModel(model) {
  if (!model || model === 'claude-opus-4-6') {
    return DEFAULT_TEXT_MODEL;
  }
  return model;
}

function normalizeMaxTokens(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;

  if (!ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'Anthropic API key not configured. Please set ANTHROPIC_API_KEY in Cloudflare Pages environment.' },
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

  const { action } = body;

  // ── Route: text — Standard Claude Messages API ──
  if (action === 'text') {
    return handleTextRequest(body, ANTHROPIC_API_KEY);
  }

  // ── Route: image — Claude Image Generation ──
  if (action === 'image') {
    return handleImageRequest(body, ANTHROPIC_API_KEY);
  }

  return Response.json(
    { error: `Unknown action: ${action}. Use "text" or "image".` },
    { status: 400, headers: CORS_HEADERS }
  );
}

// ─────────────────────────────────────────────────────────────
// Text: Claude Messages API
// ─────────────────────────────────────────────────────────────
async function handleTextRequest(body, apiKey) {
  const {
    model,
    messages,
    system,
    max_tokens,
    temperature,
    thinking,
  } = body;

  if (!messages || !Array.isArray(messages)) {
    return Response.json(
      { error: 'Missing required field: messages (array)' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const payloadModel = normalizeTextModel(model);
  const payload = {
    model: payloadModel,
    max_tokens: normalizeMaxTokens(max_tokens, 4096),
    messages,
  };

  if (system) payload.system = system;
  if (temperature !== undefined) payload.temperature = temperature;

  // Extended thinking support
  if (thinking) {
    delete payload.temperature;
    const requestedBudget = normalizeMaxTokens(thinking.budget_tokens, 10000);
    const safeBudget = Math.min(Math.max(requestedBudget, 1024), MAX_MANUAL_THINKING_TOKENS);
    if (safeBudget >= payload.max_tokens) {
      payload.max_tokens = safeBudget + 1024;
    }
    payload.thinking = {
      type: 'enabled',
      budget_tokens: safeBudget,
      display: thinking.display || 'omitted',
    };
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorDetail;
      try { errorDetail = JSON.parse(errorText); } catch { errorDetail = { message: errorText }; }
      return Response.json(
        { error: 'Claude API Error', details: errorDetail?.error?.message || errorText, status: response.status },
        { status: response.status, headers: CORS_HEADERS }
      );
    }

    const data = await response.json();

    // Extract text from response content blocks
    let text = '';
    if (data.content) {
      text = data.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
    }

    return Response.json(
      { text, content: data.content, model: data.model, usage: data.usage, stop_reason: data.stop_reason },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return Response.json(
      { error: 'Claude API Error', details: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Image: Claude Image Generation via Messages API tool_use
// Uses the built-in image generation tool
// ─────────────────────────────────────────────────────────────
async function handleImageRequest(body, apiKey) {
  const { prompt } = body;

  if (!prompt) {
    return Response.json(
      { error: 'Missing required field: prompt' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const payload = {
    model: DEFAULT_IMAGE_MODEL,
    max_tokens: 16384,
    tools: [{
      type: 'image_generation',
      name: 'image_generation',
      input_schema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Image generation prompt' },
        },
        required: ['prompt'],
      },
    }],
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2025-04-14',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorDetail;
      try { errorDetail = JSON.parse(errorText); } catch { errorDetail = { message: errorText }; }
      return Response.json(
        { error: 'Claude Image API Error', details: errorDetail?.error?.message || errorText, status: response.status },
        { status: response.status, headers: CORS_HEADERS }
      );
    }

    const data = await response.json();

    // Extract image from tool_use result blocks
    let imageBase64 = null;
    let imageMimeType = 'image/png';
    if (data.content) {
      for (const block of data.content) {
        if (block.type === 'image') {
          imageBase64 = block.source?.data || null;
          imageMimeType = block.source?.media_type || 'image/png';
          break;
        }
        // Also check for tool_result with image
        if (block.type === 'tool_result' && block.content) {
          for (const inner of (Array.isArray(block.content) ? block.content : [block.content])) {
            if (inner.type === 'image') {
              imageBase64 = inner.source?.data || null;
              imageMimeType = inner.source?.media_type || 'image/png';
              break;
            }
          }
        }
      }
    }

    return Response.json(
      { imageBase64, imageMimeType, content: data.content, usage: data.usage },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return Response.json(
      { error: 'Claude Image API Error', details: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
