import { randomUUID } from "node:crypto";
import { slotToIso } from "../shared/interview.js";
import type { CallAnalysis, CallRecord, Candidate, Interview, SaveCallRequest } from "../shared/types.js";
import { analyseCall } from "./callAnalyzer.js";
import { AppError } from "./errors.js";
import { candidateRepository } from "./repository.js";

export function candidateNotFound(): AppError {
  return new AppError(404, "Candidate not found", "NOT_FOUND");
}

const NO_SPEECH_ERROR = "No candidate speech was captured, so the call could not be analysed.";

export type RecordedCall = { candidate: Candidate; call: CallRecord };

/**
 * Analyses a finished call with Gemini and saves it on the candidate. Analysis failures are stored on the
 * call (analysisError) instead of thrown, so a transcript is never lost. Throws 404 if the candidate is gone.
 */
export async function recordCall(candidateId: string, body: SaveCallRequest): Promise<RecordedCall> {
  const candidate = await candidateRepository.get(candidateId);
  if (!candidate) throw candidateNotFound();

  let analysis: CallAnalysis | null = null;
  let analysisError: string | null = null;

  if (!body.transcript.some((line) => line.role === "user")) {
    analysisError = NO_SPEECH_ERROR;
  } else {
    try {
      analysis = await analyseCall(candidate, body.transcript, new Date(body.startedAt));
    } catch (err) {
      if (err instanceof AppError) {
        analysisError = err.message;
      } else {
        console.error("[calls] unexpected analysis error:", err instanceof Error ? err.stack : err);
        analysisError = "The AI service failed to process this request. Please try again.";
      }
    }
  }

  const call: CallRecord = {
    id: randomUUID(),
    callId: body.callId,
    startedAt: body.startedAt,
    endedAt: body.endedAt,
    durationSec: body.durationSec,
    transcript: body.transcript,
    analysis,
    analysisError,
    createdAt: new Date().toISOString(),
  };

  // No human step: a slot the candidate agreed to on the call becomes the candidate's interview straight away.
  // The newest agreement wins, so a later call that reschedules replaces the previous interview.
  const slot = analysis?.interviewSlot ?? null;
  const interview: Interview | null = slot
    ? {
        id: randomUUID(),
        scheduledAt: slotToIso(slot.date, slot.time),
        timeSpecified: slot.time !== null,
        status: "scheduled",
        source: "ai",
        callRecordId: call.id,
        candidateStatement: slot.candidateStatement,
        notes: null,
        createdAt: call.createdAt,
        updatedAt: call.createdAt,
      }
    : null;

  const updated = await candidateRepository.update(candidate.id, (c) => ({
    ...c,
    status: "called",
    calls: [...c.calls, call],
    interview: interview ?? c.interview,
  }));
  // The candidate was deleted while Gemini was running.
  if (!updated) throw candidateNotFound();

  return { candidate: updated, call };
}
