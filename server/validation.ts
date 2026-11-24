import type { SaveCallRequest, TranscriptLine } from "../shared/types.js";
import { AppError } from "./errors.js";
import { isRecord } from "./normalize.js";

const MAX_TRANSCRIPT_LINES = 2000;
const MAX_LINE_CHARS = 5000;
// e.g. 2026-11-24T10:15:00Z, 2026-11-24T10:15:00.123+05:30
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

function invalid(message: string): AppError {
  return new AppError(400, message, "INVALID_BODY");
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
}

export function validateSaveCallRequest(body: unknown): SaveCallRequest {
  if (!isRecord(body)) throw invalid("Request body must be a JSON object.");

  const { callId, startedAt, endedAt, durationSec, transcript } = body;

  if (callId !== null && typeof callId !== "string") throw invalid("callId must be a string or null.");
  if (!isIsoDate(startedAt)) throw invalid("startedAt must be an ISO date string.");
  if (!isIsoDate(endedAt)) throw invalid("endedAt must be an ISO date string.");
  if (typeof durationSec !== "number" || !Number.isFinite(durationSec) || durationSec < 0) {
    throw invalid("durationSec must be a finite number >= 0.");
  }
  if (!Array.isArray(transcript)) throw invalid("transcript must be an array.");
  if (transcript.length > MAX_TRANSCRIPT_LINES) {
    throw invalid(`transcript must have at most ${MAX_TRANSCRIPT_LINES} lines.`);
  }

  const lines: TranscriptLine[] = transcript.map((line: unknown, i): TranscriptLine => {
    if (!isRecord(line)) throw invalid(`transcript[${i}] must be an object.`);
    const { role, text, at } = line;
    if (role !== "assistant" && role !== "user") {
      throw invalid(`transcript[${i}].role must be "assistant" or "user".`);
    }
    if (typeof text !== "string" || text.trim() === "") {
      throw invalid(`transcript[${i}].text must be a non-empty string.`);
    }
    if (text.length > MAX_LINE_CHARS) {
      throw invalid(`transcript[${i}].text must be at most ${MAX_LINE_CHARS} characters.`);
    }
    if (typeof at !== "string") throw invalid(`transcript[${i}].at must be a string.`);
    return { role, text, at };
  });

  return {
    callId,
    startedAt,
    endedAt,
    durationSec: Math.round(durationSec),
    transcript: lines,
  };
}
