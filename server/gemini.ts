import { ApiError, GoogleGenAI, type Part, type Schema } from "@google/genai";
import { getGeminiApiKey } from "./config.js";
import { AppError } from "./errors.js";

/** Override with GEMINI_MODEL in .env (e.g. when a model is overloaded or unavailable to your key). */
const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
const TIMEOUT_MS = 60_000;
/** Waits before each retry of a 503 "high demand" response; its length is the number of retries. */
const OVERLOAD_RETRY_DELAYS_MS = [3_000, 8_000];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

  let text: string | undefined;
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
      break;
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        console.error("[gemini] rate limited:", err.message);
        throw new AppError(429, "Gemini rate limit reached. Wait a minute and retry.", "GEMINI_RATE_LIMIT");
      }
      if (err instanceof ApiError && err.status === 503) {
        // "High demand" spikes are usually brief: retry a couple of times before giving up.
        const delay = OVERLOAD_RETRY_DELAYS_MS[attempt];
        if (delay !== undefined) {
          console.warn(`[gemini] overloaded (attempt ${attempt + 1}), retrying in ${delay / 1000}s`);
          await sleep(delay);
          continue;
        }
        console.error("[gemini] overloaded:", err.message);
        throw new AppError(
          502,
          "The AI service is overloaded right now. Please try again in a minute.",
          "GEMINI_OVERLOADED",
        );
      }
      if (controller.signal.aborted) {
        throw failed(new Error(`Gemini request timed out after ${TIMEOUT_MS / 1000}s`, { cause: err }));
      }
      throw failed(err);
    } finally {
      clearTimeout(timer);
    }
  }

  if (!text || !text.trim()) throw failed(new Error("Gemini returned an empty response"));

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw failed(new Error(`Gemini returned invalid JSON: ${text.slice(0, 500)}`, { cause: err }));
  }
}
