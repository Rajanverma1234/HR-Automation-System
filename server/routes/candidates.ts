import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { CallAnalysis, CallRecord, Candidate } from "../../shared/types.js";
import { analyseCall } from "../callAnalyzer.js";
import { AppError } from "../errors.js";
import { candidateRepository } from "../repository.js";
import { validateSaveCallRequest } from "../validation.js";

function notFound(): AppError {
  return new AppError(404, "Candidate not found", "NOT_FOUND");
}

export const candidatesRouter = Router();

candidatesRouter.get("/", async (_req: Request, res: Response<Candidate[]>) => {
  res.json(await candidateRepository.list());
});

candidatesRouter.get("/:id", async (req: Request<{ id: string }>, res: Response<Candidate>) => {
  const candidate = await candidateRepository.get(req.params.id);
  if (!candidate) throw notFound();
  res.json(candidate);
});

type SaveCallResponse = { candidate: Candidate; call: CallRecord };

const NO_SPEECH_ERROR = "No candidate speech was captured, so the call could not be analysed.";

candidatesRouter.post(
  "/:id/calls",
  async (req: Request<{ id: string }>, res: Response<SaveCallResponse>) => {
    const body = validateSaveCallRequest(req.body);

    const candidate = await candidateRepository.get(req.params.id);
    if (!candidate) throw notFound();

    let analysis: CallAnalysis | null = null;
    let analysisError: string | null = null;

    if (!body.transcript.some((line) => line.role === "user")) {
      analysisError = NO_SPEECH_ERROR;
    } else {
      // The transcript must never be lost: any analysis failure is recorded on the call instead of failing the request.
      try {
        analysis = await analyseCall(candidate, body.transcript);
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

    const updated = await candidateRepository.update(candidate.id, (c) => ({
      ...c,
      status: "called",
      calls: [...c.calls, call],
    }));
    // The candidate was deleted while Gemini was running.
    if (!updated) throw notFound();

    res.status(201).json({ candidate: updated, call });
  },
);

candidatesRouter.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  const deleted = await candidateRepository.delete(req.params.id);
  if (!deleted) throw notFound();
  res.status(204).end();
});
