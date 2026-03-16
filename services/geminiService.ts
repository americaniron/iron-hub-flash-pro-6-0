import { Type, Modality, ThinkingLevel } from "@google/genai";
import { QuoteItem, ClientInfo, AppConfig, EmailDraft, InvoiceData } from "../types.ts";

async function callGeminiProxy(params: { model: string, contents: any, config?: any }) {
  const response = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.details || errorData.error || "Failed to call Gemini proxy");
  }
  
  return await response.json();
}

function handleGeminiError(error: any): never {
  console.error("Gemini API Error:", error);
  
  const errorMessage = error?.message || String(error);
  
  if (errorMessage.includes("401") || errorMessage.includes("API_KEY_INVALID") || errorMessage.includes("key not configured")) {
    throw new Error("Gemini API key is not configured or invalid. Please ensure GEMINI_API_KEY is set in the environment.");
  }
  
  if (errorMessage.includes("429") || errorMessage.includes("quota") || errorMessage.includes("rate limit")) {
    throw new Error("Gemini API usage limit exceeded. Please try again later or check your quota.");
  }
  
  throw new Error(`AI Service Error: ${errorMessage}`);
}

class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount: number = 0;
  private readonly failureThreshold: number = 5;
  private readonly resetTimeout: number = 10000; // 10 seconds
  private lastFailureTime: number | null = null;

  async execute<T>(action: () => Promise<T>, fallback: (error?: any) => T | Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - (this.lastFailureTime || 0) > this.resetTimeout) {
        this.state = 'HALF_OPEN';
      } else {
        console.warn("Circuit breaker is OPEN. Returning fallback.");
        return fallback(new Error("Circuit breaker is OPEN"));
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
        errorMessage.includes("quota") || 
        errorMessage.includes("rate limit") ||
        errorMessage.includes("500") ||
        errorMessage.includes("503") ||
        errorMessage.includes("fetch failed") ||
        errorMessage.includes("timeout")
      ) {
        this.onFailure(error);
      }
      
      if (
        errorMessage.includes("401") || 
        errorMessage.includes("API_KEY_INVALID") ||
        errorMessage.includes("key not configured")
      ) {
          handleGeminiError(error);
      }

      console.warn("API call failed, returning fallback.", error);
      return fallback(error);
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private onFailure(error?: any) {
    this.failureCount++;
    const errorMessage = error?.message || String(error || 'Unknown error');
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.lastFailureTime = Date.now();
      console.error(`Circuit breaker tripped! State is now OPEN for ${this.resetTimeout}ms. Last error: ${errorMessage}`);
    }
  }
}

const geminiCircuitBreaker = new CircuitBreaker();

// --- Image Generation Throttling Queue ---
const MAX_CONCURRENT_IMAGE_GENERATIONS = 2; // Conservative limit to avoid rate-limiting
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

  const { task, resolve, reject } = job;

  try {
    const result = await task();
    resolve(result);
  } catch (error) {
    reject(error);
  } finally {
    activeImageGenerations--;
    processImageGenerationQueue();
  }
}

/**
 * AI Brainstorming/Analysis using Gemini 3 Pro for complex reasoning.
 * Enhanced with Thinking Mode support.
 */
export const translateText = async (text: string, targetLanguage: 'en' | 'ar'): Promise<string> => {
  return geminiCircuitBreaker.execute(async () => {
    const prompt = `Translate the following text to ${targetLanguage === 'ar' ? 'Arabic' : 'English'}. Preserve the original tone and technical terminology where appropriate.\n\nText:\n${text}`;
    
    const response = await callGeminiProxy({
      model: 'gemini-3.1-flash-lite-preview',
      contents: prompt,
    });
    
    return response.candidates?.[0]?.content?.parts?.[0]?.text || text;
  }, () => text);
};

export const analyzeQuoteData = async (items: QuoteItem[], useThinking: boolean = false, language: 'en' | 'ar' = 'en'): Promise<string> => {
  return geminiCircuitBreaker.execute(async () => {
    const context = items.map((i, idx) => `Line ${(idx + 1).toString().padStart(2, '0')}: ${i.qty}x ${i.partNo} (${i.desc})`).join("\n");
    
    const prompt = `
        You are a senior heavy machinery logistics engineer at American Iron.
        Analyze this machinery parts list:
        ${context}
        
        TASK:
        1. Identify the primary machine system being repaired.
        2. Identify any CRITICAL MISSING COMPONENTS.
        3. Provide 1 proactive maintenance recommendation.
        
        OUTPUT: Provide a cohesive, authoritative 2-3 sentence engineering brief.
        ${language === 'ar' ? 'IMPORTANT: Provide the entire analysis in ARABIC language.' : 'Provide the analysis in English.'}
    `.replace(/\s+/g, ' ').trim();

    const config: any = {};
    if (useThinking) {
      config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
    } else {
      config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
    }

    const response = await callGeminiProxy({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.text || "Diagnostic analysis yielded no specific concerns.";
  }, () => "Diagnostic analysis is currently unavailable due to system load. Please proceed with standard manual review.");
};

/**
 * Generates Speech (TTS) using Gemini 2.5 Flash Preview TTS.
 * Now includes on-the-fly translation for Arabic requests.
 */
export const generateTTS = async (text: string, language: 'en' | 'ar' = 'en'): Promise<string | null> => {
  return geminiCircuitBreaker.execute(async () => {
    let textToSpeak = text;
    let instruction = `Say clearly and professionally: ${textToSpeak}`;

    if (language === 'ar' && text) {
      const translationResponse = await callGeminiProxy({
        model: 'gemini-3-flash-preview',
        contents: `Translate the following English text to Arabic, providing only the Arabic translation: "${text}"`,
        config: {
            temperature: 0.1,
        },
      });
      
      const translatedText = translationResponse.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (!translatedText) {
        console.warn("Arabic translation failed. Falling back to English audio.");
      } else {
        textToSpeak = translatedText;
        instruction = textToSpeak;
      }
    }
      
    const response = await callGeminiProxy({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: instruction }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  }, () => null);
};

/**
 * Nano Banana Image Editor (Gemini 2.5 Flash Image)
 */
export const editPartImage = async (base64Image: string, prompt: string): Promise<string | null> => {
  return geminiCircuitBreaker.execute(async () => {
    const response = await callGeminiProxy({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image.split(',')[1] || base64Image,
              mimeType: 'image/jpeg',
            },
          },
          {
            text: `Edit this image based on the user request: ${prompt}. Maintain industrial catalog aesthetics.`,
          },
        ],
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    return null;
  }, () => null);
};

/**
 * Generates an exact part photo using Gemini 3 Pro Image with throttling.
 */
export const generatePartImage = (partNo: string, description: string, size: '1K' | '2K' | '4K' = '1K'): Promise<string | null> => {
  return new Promise((resolve, reject) => {
    const task = async (): Promise<string | null> => {
      return geminiCircuitBreaker.execute(async () => {
        const cleanDesc = description.replace(/CAT COMPONENT|CAT PART|ASSEMBLY|ENGINEERING|NEW|GENUINE/gi, '').trim();
        const prompt = `EXACT match required: Authentically detailed industrial product photograph of Caterpillar (CAT) heavy equipment part number ${partNo} (${cleanDesc}). Feature the SPECIFIC part in high technical detail with correct engineering textures. The part must be centered and isolated on a pure, seamless white studio background. Sharp focus, studio lighting, catalog quality.`;

        const response = await callGeminiProxy({
          model: 'gemini-3.1-flash-image-preview',
          contents: { parts: [{ text: prompt }] },
          config: { 
            imageConfig: { 
              aspectRatio: "1:1",
              imageSize: size
            },
          }
        });
        
        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          }
        }
        return null;
      }, (error) => {
        return null;
      });
    };

    imageGenerationQueue.push({ task, resolve, reject });
    processImageGenerationQueue();
  });
};

/**
 * Analyzes an uploaded photo using Gemini 3 Pro with integrated OCR.
 */
export const analyzePartPhoto = async (base64Data: string, mimeType: string, useThinking: boolean = false): Promise<string> => {
  return geminiCircuitBreaker.execute(async () => {
    const config: any = {};
    if (useThinking) {
      config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
    } else {
      config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
    }

    const response = await callGeminiProxy({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { mimeType, data: base64Data.split(',')[1] || base64Data } },
          { text: "Perform OCR to read any text/part numbers on the image. Based on the OCR results and visual analysis, identify the machinery part and provide maintenance or technical notes." }
        ]
      },
      config
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.text || "No analysis generated.";
  }, () => "Photo analysis is currently unavailable. Please manually identify the part.");
};

/**
 * Global Intelligence Task Handler (Gemini Flash-Lite for speed)
 */
export const performIntelligentTask = async (prompt: string): Promise<string> => {
  return geminiCircuitBreaker.execute(async () => {
    const response = await callGeminiProxy({
      model: 'gemini-flash-lite-latest',
      contents: prompt,
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.text || "Task complete.";
  }, () => "Intelligence task failed or is currently unavailable.");
};

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

  return geminiCircuitBreaker.execute(async () => {
    const prompt = `
      You are an automated logistics dispatch agent for American Iron LLC (americaniron1.com).
      Generate a ${tone} email body for:
      - Customer: ${client.contactName} at ${client.company}
      - Document: ${type} #${documentId}
      - Line Items [${lineItems?.length}]: ${itemsContext}
      
      Return only a JSON object.
    `;

    const response = await callGeminiProxy({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            to: { type: Type.STRING },
            subject: { type: Type.STRING },
            body: { type: Type.STRING }
          },
          required: ["to", "subject", "body"]
        }
      }
    });
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return JSON.parse(text) as EmailDraft;
  }, () => ({
    to: client.email,
    subject: `American Iron: ${type} ${documentId}`,
    body: `Hello ${client.contactName},\n\nPlease find the attached ${type}.\n\nRegards,\nAmerican Iron Team`
  }));
};
