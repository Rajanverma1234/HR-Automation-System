import { ApiError, GoogleGenAI, type Part, type Schema } from "@google/genai";
import { getGeminiApiKey } from "./config.js";
import { AppError } from "./errors.js";

const MODEL = "gemini-3.8-flash";
const TIMEOUT_MS = 60_000;

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  // getGeminiApiKey() throws a 503 AppError when the key is missing.
  const apiKey = getGeminiApiKey();
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

function failed(cause: unknown): AppError {
  console.error("[gemini] request failed:", cause instanceof Error ? cause.stack : cause);
  return new AppError(
    502,
    "The AI service failed to process this request. Please try again.",
    "GEMINI_FAILED",
  );
}

export async function generateJson<T>({
  parts,
  schema,
  systemInstruction,
}: {
  parts: Part[];
  schema: Schema;
  systemInstruction: string;
}): Promise<T> {
  const ai = getClient();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let text: string | undefined;
  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0,
        abortSignal: controller.signal,
      },
    });
    text = response.text;
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) {
      console.error("[gemini] rate limited:", err.message);
      throw new AppError(429, "Gemini rate limit reached. Wait a minute and retry.", "GEMINI_RATE_LIMIT");
    }
    if (controller.signal.aborted) {
      throw failed(new Error(`Gemini request timed out after ${TIMEOUT_MS / 1000}s`, { cause: err }));
    }
    throw failed(err);
  } finally {
    clearTimeout(timer);
  }

  if (!text || !text.trim()) throw failed(new Error("Gemini returned an empty response"));

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw failed(new Error(`Gemini returned invalid JSON: ${text.slice(0, 500)}`, { cause: err }));
  }
}
