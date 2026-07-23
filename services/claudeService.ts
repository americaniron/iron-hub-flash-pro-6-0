/**
 * Iron Hub AI service.
 *
 * Text AI:       Worker-managed Claude with Cloudflare GPT fallback
 * Image Gen:     Claude API image generation tool
 * Voice output:  Cloudflare Workers AI multilingual synthesis
 */

import { QuoteItem, ClientInfo, AppConfig, EmailDraft, InvoiceData } from "../types.ts";
import { hubApiFetch } from './hubApi.ts';

const STANDARD_MAX_TOKENS = 2048;
const THINKING_MAX_TOKENS = 16000;
const THINKING_BUDGET_TOKENS = 10000;

const containsArabic = (text: string): boolean => /[\u0600-\u06FF]/.test(text);

// ─── Proxy helpers ───────────────────────────────────────────

async function callClaude(params: {
  action: 'text' | 'image';
  messages?: Array<{ role: string; content: any }>;
  system?: string;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  thinking?: { budget_tokens: number };
  prompt?: string; // for image action
}) {
  const response = await hubApiFetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.details || errorData.error || `Claude proxy error (${response.status})`);
  }

  return await response.json();
}

async function callVoiceSynthesis(text: string) {
  const response = await hubApiFetch("/api/elevenlabs-tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.details || errorData.error || `Cloudflare voice synthesis error (${response.status})`);
  }

  return await response.json();
}

export type TranscriptionLanguage = 'en' | 'ar';

export async function transcribeAudio(audio: Blob, language: TranscriptionLanguage): Promise<{ text: string; model: string }> {
  if (!(audio instanceof Blob) || audio.size === 0) {
    throw new Error('Record audio before requesting a transcription.');
  }
  if (audio.size > 10 * 1024 * 1024) {
    throw new Error('Recordings must be 10 MB or smaller.');
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  const response = await hubApiFetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audioBase64: btoa(binary),
      language,
      mimeType: audio.type || 'audio/webm',
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: unknown; message?: unknown };
    throw new Error(String(error.error || error.message || `Voice transcription failed (${response.status})`));
  }
  const body = await response.json() as { text?: unknown; model?: unknown };
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw new Error('Voice transcription returned no text.');
  return { text, model: typeof body.model === 'string' ? body.model : 'Whisper' };
}

// ─── Error handling ──────────────────────────────────────────

function handleAPIError(error: any): never {
  const msg = error?.message || String(error);

  if (msg.includes("credit balance") || msg.includes("purchase credits") || msg.includes("billing")) {
    throw new Error("Claude and the Cloudflare Workers AI fallback could not complete this request. Please retry shortly.");
  }
  if (msg.includes("401") || msg.includes("invalid") || msg.includes("not configured")) {
    throw new Error("The protected AI service is not configured or could not verify its server credentials.");
  }
  if (msg.includes("429") || msg.includes("rate") || msg.includes("quota")) {
    throw new Error("The AI providers are temporarily rate limited. Please try again in a moment.");
  }
  throw new Error(`AI Service Error: ${msg}`);
}

// ─── Circuit Breaker ─────────────────────────────────────────

class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private readonly failureThreshold = 5;
  private readonly resetTimeout = 10000;
  private lastFailureTime: number | null = null;

  async execute<T>(action: () => Promise<T>, fallback: (error?: any) => T | Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - (this.lastFailureTime || 0) > this.resetTimeout) {
        this.state = 'HALF_OPEN';
      } else {
        return fallback(new Error("Circuit breaker is OPEN"));
      }
    }

    try {
      const result = await action();
      this.failureCount = 0;
      this.state = 'CLOSED';
      return result;
    } catch (error: any) {
      const msg = error?.message || String(error);
      if (msg.includes("429") || msg.includes("500") || msg.includes("503") || msg.includes("fetch failed") || msg.includes("timeout")) {
        this.failureCount++;
        if (this.failureCount >= this.failureThreshold) {
          this.state = 'OPEN';
          this.lastFailureTime = Date.now();
        }
      }
      if (
        msg.includes("401") ||
        msg.includes("invalid") ||
        msg.includes("not configured") ||
        msg.includes("credit balance") ||
        msg.includes("purchase credits") ||
        msg.includes("billing") ||
        msg.includes("quota") ||
        msg.includes("rate")
      ) {
        handleAPIError(error);
      }
      return fallback(error);
    }
  }
}

const breaker = new CircuitBreaker();

// ─── Image Generation Queue ──────────────────────────────────

const MAX_CONCURRENT = 2;
let activeGens = 0;
const imageQueue: { task: () => Promise<string | null>; resolve: (v: string | null) => void; reject: (e?: any) => void }[] = [];

function processImageQueue() {
  if (activeGens >= MAX_CONCURRENT || imageQueue.length === 0) return;
  activeGens++;
  const job = imageQueue.shift()!;
  job.task().then(job.resolve).catch(job.reject).finally(() => { activeGens--; processImageQueue(); });
}

// ═══════════════════════════════════════════════════════════════
// ─── Exported features ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

/**
 * Translate text between English and Arabic using Claude.
 */
export const translateText = async (text: string, targetLanguage: 'en' | 'ar'): Promise<string> => {
  return breaker.execute(async () => {
    const resp = await callClaude({
      action: 'text',
      max_tokens: STANDARD_MAX_TOKENS,
      temperature: 0.1,
      messages: [{ role: 'user', content: `Translate the following text to ${targetLanguage === 'ar' ? 'Arabic' : 'English'}. Preserve the original tone and technical terminology. Return ONLY the translation, nothing else.\n\nText:\n${text}` }],
    });
    return resp.text || text;
  }, () => text);
};

/**
 * Analyze a parts quote using Claude Opus with optional extended thinking.
 */
export const analyzeQuoteData = async (items: QuoteItem[], useThinking: boolean = false, language: 'en' | 'ar' = 'en'): Promise<string> => {
  return breaker.execute(async () => {
    const context = items.map((i, idx) => `Line ${(idx + 1).toString().padStart(2, '0')}: ${i.qty}x ${i.partNo} (${i.desc})`).join("\n");

    const prompt = `You are a senior heavy machinery logistics engineer at American Iron.
Analyze this machinery parts list:
${context}

TASK:
1. Identify the primary machine system being repaired.
2. Identify any CRITICAL MISSING COMPONENTS.
3. Provide 1 proactive maintenance recommendation.

OUTPUT: Provide a cohesive, authoritative 2-3 sentence engineering brief.
${language === 'ar' ? 'IMPORTANT: Provide the entire analysis in ARABIC language.' : 'Provide the analysis in English.'}`;

    const params: any = {
      action: 'text',
      max_tokens: useThinking ? THINKING_MAX_TOKENS : 1024,
      messages: [{ role: 'user', content: prompt }],
    };

    if (useThinking) {
      params.thinking = { budget_tokens: THINKING_BUDGET_TOKENS };
    }

    // The authenticated Worker always tries Claude first and only falls back
    // to Cloudflare's GPT model for supported Anthropic credit/rate failures.
    const resp = await callClaude(params);
    return resp.text || "Diagnostic analysis yielded no specific concerns.";
  }, () => "Diagnostic analysis is currently unavailable due to system load. Please proceed with standard manual review.");
};

/**
 * Generate speech audio using Cloudflare Workers AI.
 * Supports English and Arabic via multilingual model.
 */
export const generateTTS = async (text: string, language: 'en' | 'ar' = 'en'): Promise<string | null> => {
  return breaker.execute(async () => {
    let textToSpeak = text;

    // Translate to Arabic first if needed
    if (language === 'ar' && text && !containsArabic(text)) {
      const translationPrompt = `Translate the following quote-analysis brief to Arabic. Preserve heavy-equipment technical terms and return only the Arabic text.\n\nText:\n${text}`;
      const translatedResponse = await callClaude({
        action: 'text',
        max_tokens: STANDARD_MAX_TOKENS,
        temperature: 0.1,
        messages: [{ role: 'user', content: translationPrompt }],
      });
      const translated = (translatedResponse.text || '').trim();

      // The voice model picks its language from the text itself, so silently
      // falling back to the English source produced an English voice reading
      // the English brief whenever translation failed. Arabic was requested:
      // either speak real Arabic or fail loudly so the UI can say so.
      if (!translated || !containsArabic(translated)) {
        throw new Error('Arabic translation was unavailable, so Arabic voice analysis was not generated. Please retry.');
      }
      textToSpeak = translated;
    }

    const resp = await callVoiceSynthesis(textToSpeak);
    return resp.audioBase64 || null;
  }, (error) => {
    // Surface voice failures (e.g. Arabic translation unavailable) to the UI
    // instead of silently producing no audio.
    throw error instanceof Error ? error : new Error('Voice analysis is temporarily unavailable.');
  });
};

/**
 * Edit an existing part image using Claude vision + image gen.
 */
export const editPartImage = async (base64Image: string, prompt: string): Promise<string | null> => {
  return breaker.execute(async () => {
    // Step 1: Have Claude analyze the current image
    const rawData = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;
    const analysisResp = await callClaude({
      action: 'text',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: rawData } },
          { type: 'text', text: `Describe this machinery part image in detail for re-generation. Focus on: shape, color, material, distinguishing features, and any visible text/numbers. The user wants to: ${prompt}` },
        ],
      }],
    });

    const description = analysisResp.text || '';

    // Step 2: Generate a new image based on the description + edit prompt
    const imgResp = await callClaude({
      action: 'image',
      prompt: `Generate a professional industrial catalog photo of this machinery part: ${description}. Apply this edit: ${prompt}. White background, studio lighting, sharp focus.`,
    });

    if (imgResp.imageBase64) {
      return `data:${imgResp.imageMimeType || 'image/png'};base64,${imgResp.imageBase64}`;
    }
    return null;
  }, () => null);
};

/**
 * Generate a part image using Claude's image generation tool.
 */
export const generatePartImage = (partNo: string, description: string, size: '1K' | '2K' | '4K' = '1K'): Promise<string | null> => {
  return new Promise((resolve, reject) => {
    const task = async (): Promise<string | null> => {
      return breaker.execute(async () => {
        const cleanDesc = description.replace(/CAT COMPONENT|CAT PART|ASSEMBLY|ENGINEERING|NEW|GENUINE/gi, '').trim();
        const prompt = `Generate a highly detailed, photorealistic industrial product photograph of Caterpillar (CAT) heavy equipment part number ${partNo} (${cleanDesc}). The part must be centered and isolated on a pure seamless white studio background. Sharp focus, professional studio lighting, catalog quality. Show the specific part with correct engineering textures and proportions.`;

        const resp = await callClaude({
          action: 'image',
          prompt,
        });

        if (resp.imageBase64) {
          return `data:${resp.imageMimeType || 'image/png'};base64,${resp.imageBase64}`;
        }
        return null;
      }, () => null);
    };

    imageQueue.push({ task, resolve, reject });
    processImageQueue();
  });
};

/**
 * Analyze an uploaded photo using Claude's vision capabilities.
 */
export const analyzePartPhoto = async (base64Data: string, mimeType: string, useThinking: boolean = false): Promise<string> => {
  return breaker.execute(async () => {
    const rawData = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;

    const params: any = {
      action: 'text',
      max_tokens: useThinking ? THINKING_MAX_TOKENS : 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: rawData } },
          { type: 'text', text: 'Perform OCR to read any text/part numbers on the image. Based on the OCR results and visual analysis, identify the machinery part and provide maintenance or technical notes.' },
        ],
      }],
    };

    if (useThinking) {
      params.thinking = { budget_tokens: THINKING_BUDGET_TOKENS };
    }

    const resp = await callClaude(params);
    return resp.text || "No analysis generated.";
  }, () => "Photo analysis is currently unavailable. Please manually identify the part.");
};

/**
 * General-purpose AI task handler using Claude.
 */
export const performIntelligentTask = async (prompt: string): Promise<string> => {
  return breaker.execute(async () => {
    const resp = await callClaude({
      action: 'text',
      max_tokens: STANDARD_MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    });
    return resp.text || "Task complete.";
  }, () => "Intelligence task failed or is currently unavailable.");
};

/**
 * Generate a professional email draft using Claude.
 */
export const generateEmailDraft = async (
  client: ClientInfo,
  config?: AppConfig,
  items?: QuoteItem[],
  tone: string = "professional",
  invoice?: InvoiceData | null,
  language: string = "en"
): Promise<EmailDraft> => {
  const isInvoice = !!invoice;
  const type = isInvoice ? "Invoice" : "Quotation";
  const documentId = isInvoice ? invoice.id : config?.quoteId;
  const lineItems = isInvoice ? invoice.items.map(i => `${i.hours}hr(s) of ${i.description}`) : items?.map(i => `${i.qty}x ${i.partNo}`);
  const itemsContext = lineItems?.join(', ').substring(0, 500) || 'N/A';

  return breaker.execute(async () => {
    const langName = language === 'es' ? 'Spanish' : language === 'ar' ? 'Arabic' : 'English';

    const prompt = `You are an automated logistics dispatch agent for American Iron LLC (americaniron1.com).
Generate a ${tone} email body in ${langName} for:
- Customer: ${client.contactName} at ${client.company}
- Document: ${type} #${documentId}
- Line Items [${lineItems?.length}]: ${itemsContext}

The email should:
1. Have a professional greeting.
2. Mention that the ${type} is attached.
3. Briefly summarize the contents.
4. Provide a clear call to action (e.g., "Please review and let us know if you have any questions").
5. Include a professional sign-off from "American Iron Logistics Team".

Return ONLY a valid JSON object with "to", "subject", and "body" fields. No markdown, no code fences.`;

    const resp = await callClaude({
      action: 'text',
      max_tokens: 1024,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    });

    // Parse JSON from response, strip markdown fences if present
    let text = resp.text || '{}';
    text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(text) as EmailDraft;
  }, () => ({
    to: client.email,
    subject: `American Iron: ${type} ${documentId}`,
    body: `Hello ${client.contactName},\n\nPlease find the attached ${type}.\n\nRegards,\nAmerican Iron Team`
  }));
};
