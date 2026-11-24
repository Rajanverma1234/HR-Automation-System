import { AppError } from "./errors.js";

export function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new AppError(
      503,
      "GEMINI_API_KEY is not set. Add it to .env and restart `npm run dev`.",
      "GEMINI_NOT_CONFIGURED",
    );
  }
  return key;
}
