import { QuoteItem, ClientInfo, AppConfig, EmailDraft, InvoiceData } from "../types.ts";

const GEMINI_FREE_MODEL = "gemini-3.1-flash-lite";
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

async function callElevenLabsTTS(text: string, voiceId?: string) {
  const response = await fetch("/api/elevenlabs-tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      voice_id: voiceId || "pNInz6obpgDQGcFmaJgB",
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.details || payload.error || `ElevenLabs proxy error (${response.status})`);
  }

  return payload;
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

function handleProviderAccessError(error: any): never {
  const errorMessage = error?.message || String(error);
  if (errorMessage.includes("ElevenLabs")) {
    throw new Error(`ElevenLabs TTS Error: ${errorMessage}`);
  }
  handleGeminiError(error);
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
        errorMessage.includes("ElevenLabs") ||
        errorMessage.includes("API_KEY_INVALID") ||
        errorMessage.includes("key not configured") ||
        errorMessage.includes("not configured") ||
        errorMessage.includes("invalid") ||
        errorMessage.includes("quota") ||
        errorMessage.includes("RESOURCE_EXHAUSTED") ||
        errorMessage.includes("rate limit")
      ) {
        handleProviderAccessError(error);
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
    const response = await callElevenLabsTTS(textToSpeak);
    return response.audioBase64 || null;
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
