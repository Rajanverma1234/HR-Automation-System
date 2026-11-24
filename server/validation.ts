import type { InterviewStatus, SaveCallRequest, TranscriptLine, UpdateInterviewRequest } from "../shared/types.js";
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

const INTERVIEW_STATUSES: readonly InterviewStatus[] = ["scheduled", "completed", "no-show", "cancelled"];
const MAX_NOTES_CHARS = 2000;

export function validateUpdateInterviewRequest(body: unknown): UpdateInterviewRequest {
  if (!isRecord(body)) throw invalid("Request body must be a JSON object.");
  const { scheduledAt, timeSpecified, status, notes } = body;
  const out: UpdateInterviewRequest = {};

  if (scheduledAt !== undefined) {
    if (!isIsoDate(scheduledAt)) throw invalid("scheduledAt must be an ISO date string.");
    out.scheduledAt = new Date(scheduledAt).toISOString();
  }
  if (timeSpecified !== undefined) {
    if (typeof timeSpecified !== "boolean") throw invalid("timeSpecified must be a boolean.");
    out.timeSpecified = timeSpecified;
  }
  if (status !== undefined) {
    if (typeof status !== "string" || !(INTERVIEW_STATUSES as readonly string[]).includes(status)) {
      throw invalid(`status must be one of: ${INTERVIEW_STATUSES.join(", ")}.`);
    }
    out.status = status as InterviewStatus;
  }
  if (notes !== undefined) {
    if (notes !== null && typeof notes !== "string") throw invalid("notes must be a string or null.");
    if (typeof notes === "string" && notes.length > MAX_NOTES_CHARS) throw invalid(`notes must be at most ${MAX_NOTES_CHARS} characters.`);
    out.notes = typeof notes === "string" && notes.trim() !== "" ? notes.trim() : null;
  }
  if (Object.keys(out).length === 0) throw invalid("Nothing to update: send scheduledAt, timeSpecified, status or notes.");
  return out;
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
