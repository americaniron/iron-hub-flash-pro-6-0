import { QuoteItem, ClientInfo, AppConfig, EmailDraft, InvoiceData } from "../types.ts";

const GEMINI_FREE_MODEL = "gemini-3.1-flash-lite";
const GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";
const STANDARD_MAX_TOKENS = 2048;

type GeminiProxyParams = {
  model: string;
  contents: any;
  config?: any;
};

async function callGeminiProxy(params: GeminiProxyParams) {
  const response = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload.details || payload.error || `Gemini proxy error (${response.status})`;
    throw new Error(`${message}${payload.status ? ` (${payload.status})` : ""}`);
  }

  return payload;
}

function extractText(response: any, fallback = ""): string {
  return (
    response?.text ||
    response?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part.text || "")
      .join("") ||
    fallback
  );
}

function handleGeminiError(error: any): never {
  console.error("Gemini API Error:", error);

  const errorMessage = error?.message || String(error);

  if (
    errorMessage.includes("401") ||
    errorMessage.includes("403") ||
    errorMessage.includes("API_KEY_INVALID") ||
    errorMessage.includes("key not configured") ||
    errorMessage.includes("not configured") ||
    errorMessage.includes("invalid")
  ) {
    throw new Error("Gemini API key is not configured, invalid, or lacks required permissions. Please ensure GEMINI_API_KEY is set in Cloudflare Pages.");
  }

  if (
    errorMessage.includes("429") ||
    errorMessage.includes("quota") ||
    errorMessage.includes("RESOURCE_EXHAUSTED") ||
    errorMessage.includes("rate limit")
  ) {
    throw new Error("Gemini free-tier quota or rate limit was exceeded. Please try again later or check the Gemini API quota.");
  }

  throw new Error(`AI Service Error: ${errorMessage}`);
}

class CircuitBreaker {
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private failureCount = 0;
  private readonly failureThreshold = 5;
  private readonly resetTimeout = 10000;
  private lastFailureTime: number | null = null;

  async execute<T>(action: () => Promise<T>, fallback: (error?: any) => T | Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - (this.lastFailureTime || 0) > this.resetTimeout) {
        this.state = "HALF_OPEN";
      } else {
        console.warn("Gemini circuit breaker is open. Returning fallback.");
        return fallback(new Error("Circuit breaker is open"));
      }
    }

    try {
      const result = await action();
      this.onSuccess();
      return result;
    } catch (error: any) {
      const errorMessage = error?.message || String(error);

      if (
        errorMessage.includes("429") ||
        errorMessage.includes("500") ||
        errorMessage.includes("503") ||
        errorMessage.includes("quota") ||
        errorMessage.includes("RESOURCE_EXHAUSTED") ||
        errorMessage.includes("rate limit") ||
        errorMessage.includes("fetch failed") ||
        errorMessage.includes("timeout")
      ) {
        this.onFailure(error);
      }

      if (
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("API_KEY_INVALID") ||
        errorMessage.includes("key not configured") ||
        errorMessage.includes("not configured") ||
        errorMessage.includes("invalid") ||
        errorMessage.includes("quota") ||
        errorMessage.includes("RESOURCE_EXHAUSTED") ||
        errorMessage.includes("rate limit")
      ) {
        handleGeminiError(error);
      }

      console.warn("Gemini call failed, returning fallback.", error);
      return fallback(error);
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    this.state = "CLOSED";
  }

  private onFailure(error?: any) {
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      this.lastFailureTime = Date.now();
      console.error(`Gemini circuit breaker opened for ${this.resetTimeout}ms. Last error: ${error?.message || error}`);
    }
  }
}

const geminiCircuitBreaker = new CircuitBreaker();
const containsArabic = (text: string): boolean => /[\u0600-\u06FF]/.test(text);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.includes(",") ? base64.split(",")[1] : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function pcm16Base64ToWavBase64(pcmBase64: string, sampleRate = 24000): string {
  const pcm = base64ToBytes(pcmBase64);
  const wav = new Uint8Array(44 + pcm.length);
  const view = new DataView(wav.buffer);
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.length, true);
  wav.set(pcm, 44);

  return bytesToBase64(wav);
}

async function translateForSpeech(text: string, language: "en" | "ar"): Promise<string> {
  if (language !== "ar" || !text || containsArabic(text)) {
    return text;
  }

  const response = await callGeminiProxy({
    model: GEMINI_FREE_MODEL,
    contents: `Translate the following quote-analysis brief to Arabic. Preserve heavy-equipment technical terms and return only the Arabic text.\n\nText:\n${text}`,
    config: {
      temperature: 0.1,
      maxOutputTokens: STANDARD_MAX_TOKENS,
    },
  });

  return extractText(response, text).trim() || text;
}

// Image output is intentionally disabled in free-only mode. Google's Gemini
// image-generation models are not listed as free-tier models, so these helpers
// return null instead of making paid image calls.
function freeTierImageUnavailable(): null {
  console.warn("Gemini image generation/editing is unavailable in free-tier mode.");
  return null;
}

const MAX_CONCURRENT_IMAGE_GENERATIONS = 2;
let activeImageGenerations = 0;
const imageGenerationQueue: {
  task: () => Promise<string | null>;
  resolve: (value: string | null) => void;
  reject: (reason?: any) => void;
}[] = [];

async function processImageGenerationQueue() {
  if (activeImageGenerations >= MAX_CONCURRENT_IMAGE_GENERATIONS || imageGenerationQueue.length === 0) {
    return;
  }

  activeImageGenerations++;
  const job = imageGenerationQueue.shift();
  if (!job) {
    activeImageGenerations--;
    return;
  }

  try {
    const result = await job.task();
    job.resolve(result);
  } catch (error) {
    job.reject(error);
  } finally {
    activeImageGenerations--;
    processImageGenerationQueue();
  }
}

export const translateText = async (text: string, targetLanguage: "en" | "ar"): Promise<string> => {
  return geminiCircuitBreaker.execute(async () => {
    const response = await callGeminiProxy({
      model: GEMINI_FREE_MODEL,
      contents: `Translate the following text to ${targetLanguage === "ar" ? "Arabic" : "English"}. Preserve the original tone and technical terminology. Return only the translation.\n\nText:\n${text}`,
      config: {
        temperature: 0.1,
        maxOutputTokens: STANDARD_MAX_TOKENS,
      },
    });

    return extractText(response, text).trim() || text;
  }, () => text);
};

export const analyzeQuoteData = async (
  items: QuoteItem[],
  useThinking = false,
  language: "en" | "ar" = "en",
): Promise<string> => {
  return geminiCircuitBreaker.execute(async () => {
    const context = items.map((i, idx) => `Line ${(idx + 1).toString().padStart(2, "0")}: ${i.qty}x ${i.partNo} (${i.desc})`).join("\n");
    const prompt = `You are a senior heavy machinery logistics engineer at American Iron.
Analyze this machinery parts list:
${context}

TASK:
1. Identify the primary machine system being repaired.
2. Identify any critical missing components.
3. Provide one proactive maintenance recommendation.

${useThinking ? "Reason through subsystem relationships before writing the final brief." : ""}
OUTPUT: Provide a cohesive, authoritative 2-3 sentence engineering brief.
${language === "ar" ? "IMPORTANT: Provide the entire analysis in Arabic." : "Provide the analysis in English."}`;

    const response = await callGeminiProxy({
      model: GEMINI_FREE_MODEL,
      contents: prompt,
      config: {
        temperature: 0.2,
        maxOutputTokens: useThinking ? STANDARD_MAX_TOKENS : 1024,
      },
    });

    return extractText(response, "Diagnostic analysis yielded no specific concerns.").trim();
  }, () => "Diagnostic analysis is currently unavailable due to system load. Please proceed with standard manual review.");
};

export const generateTTS = async (text: string, language: "en" | "ar" = "en"): Promise<string | null> => {
  return geminiCircuitBreaker.execute(async () => {
    const textToSpeak = await translateForSpeech(text, language);
    const response = await callGeminiProxy({
      model: GEMINI_TTS_MODEL,
      contents: [{ parts: [{ text: `Say clearly and professionally: ${textToSpeak}` }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Kore" },
          },
        },
      },
    });

    const audioPart = response?.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData?.data);
    const base64Audio = audioPart?.inlineData?.data;
    const mimeType = audioPart?.inlineData?.mimeType || "";

    if (!base64Audio) {
      return null;
    }

    return mimeType.includes("wav") ? base64Audio : pcm16Base64ToWavBase64(base64Audio);
  }, () => null);
};

export const editPartImage = async (
  _base64Image?: string,
  _prompt?: string,
): Promise<string | null> => {
  return freeTierImageUnavailable();
};

export const generatePartImage = (
  _partNo: string,
  _description: string,
  _size: "1K" | "2K" | "4K" = "1K",
): Promise<string | null> => {
  return new Promise((resolve, reject) => {
    const task = async (): Promise<string | null> => freeTierImageUnavailable();
    imageGenerationQueue.push({ task, resolve, reject });
    processImageGenerationQueue();
  });
};

export const analyzePartPhoto = async (
  base64Data: string,
  mimeType: string,
  useThinking = false,
): Promise<string> => {
  return geminiCircuitBreaker.execute(async () => {
    const response = await callGeminiProxy({
      model: GEMINI_FREE_MODEL,
      contents: {
        parts: [
          { inlineData: { mimeType, data: base64Data.split(",")[1] || base64Data } },
          {
            text: `Perform OCR to read any text or part numbers on the image. Based on the OCR results and visual analysis, identify the machinery part and provide maintenance or technical notes.${useThinking ? " Be thorough about visual evidence before answering." : ""}`,
          },
        ],
      },
      config: {
        temperature: 0.2,
        maxOutputTokens: useThinking ? STANDARD_MAX_TOKENS : 1024,
      },
    });

    return extractText(response, "No analysis generated.").trim();
  }, () => "Photo analysis is currently unavailable. Please manually identify the part.");
};

export const performIntelligentTask = async (prompt: string): Promise<string> => {
  return geminiCircuitBreaker.execute(async () => {
    const response = await callGeminiProxy({
      model: GEMINI_FREE_MODEL,
      contents: prompt,
      config: {
        temperature: 0.2,
        maxOutputTokens: STANDARD_MAX_TOKENS,
      },
    });

    return extractText(response, "Task complete.").trim();
  }, () => "Intelligence task failed or is currently unavailable.");
};

function parseEmailDraft(text: string, fallback: EmailDraft): EmailDraft {
  const clean = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  try {
    const parsed = JSON.parse(clean) as Partial<EmailDraft>;
    return {
      to: parsed.to || fallback.to,
      subject: parsed.subject || fallback.subject,
      body: parsed.body || fallback.body,
    };
  } catch {
    return fallback;
  }
}

export const generateEmailDraft = async (
  client: ClientInfo,
  config?: AppConfig,
  items?: QuoteItem[],
  tone = "professional",
  invoice?: InvoiceData | null,
  language = "en",
): Promise<EmailDraft> => {
  const isInvoice = !!invoice;
  const type = isInvoice ? "Invoice" : "Quotation";
  const documentId = isInvoice ? invoice.id : config?.quoteId;
  const lineItems = isInvoice ? invoice.items.map(i => `${i.hours}hr(s) of ${i.description}`) : items?.map(i => `${i.qty}x ${i.partNo}`);
  const itemsContext = lineItems?.join(", ").substring(0, 500) || "N/A";
  const langName = language === "es" ? "Spanish" : language === "ar" ? "Arabic" : "English";
  const fallback: EmailDraft = {
    to: client.email,
    subject: `American Iron: ${type} ${documentId}`,
    body: `Hello ${client.contactName},\n\nPlease find the attached ${type}.\n\nRegards,\nAmerican Iron Team`,
  };

  return geminiCircuitBreaker.execute(async () => {
    const prompt = `You are an automated logistics dispatch agent for American Iron LLC (americaniron1.com).
Generate a ${tone} email body in ${langName} for:
- Customer: ${client.contactName} at ${client.company}
- Customer email: ${client.email}
- Document: ${type} #${documentId}
- Line Items [${lineItems?.length || 0}]: ${itemsContext}

The email should:
1. Have a professional greeting.
2. Mention that the ${type} is attached.
3. Briefly summarize the contents.
4. Provide a clear call to action.
5. Include a professional sign-off from "American Iron Logistics Team".

Return only a valid JSON object with "to", "subject", and "body" fields.`;

    const response = await callGeminiProxy({
      model: GEMINI_FREE_MODEL,
      contents: prompt,
      config: {
        temperature: 0.3,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            to: { type: "STRING" },
            subject: { type: "STRING" },
            body: { type: "STRING" },
          },
          required: ["to", "subject", "body"],
        },
      },
    });

    return parseEmailDraft(extractText(response, "{}"), fallback);
  }, () => fallback);
};
