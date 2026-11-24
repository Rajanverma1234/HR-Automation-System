import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { CallRecord, Candidate, Interview } from "../../shared/types.js";
import { candidateNotFound as notFound, recordCall } from "../callRecorder.js";
import { AppError } from "../errors.js";
import { candidateRepository } from "../repository.js";
import { validateSaveCallRequest, validateUpdateInterviewRequest } from "../validation.js";

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

candidatesRouter.post(
  "/:id/calls",
  async (req: Request<{ id: string }>, res: Response<SaveCallResponse>) => {
    const body = validateSaveCallRequest(req.body);
    const { candidate, call } = await recordCall(req.params.id, body);
    res.status(201).json({ candidate, call });
  },
);

/**
 * Recruiter edits: mark the interview completed / no-show / cancelled, reschedule it, or create one by hand.
 * Creating requires scheduledAt. Any edit marks the interview as recruiter-set.
 */
candidatesRouter.patch(
  "/:id/interview",
  async (req: Request<{ id: string }>, res: Response<Candidate>) => {
    const body = validateUpdateInterviewRequest(req.body);
    const existing = await candidateRepository.get(req.params.id);
    if (!existing) throw notFound();
    if (!existing.interview && body.scheduledAt === undefined) {
      throw new AppError(400, "This candidate has no interview yet: send scheduledAt to schedule one.", "INVALID_BODY");
    }

    const now = new Date().toISOString();
    const updated = await candidateRepository.update(existing.id, (c) => {
      const current = c.interview;
      const interview: Interview = current
        ? {
            ...current,
            ...body,
            // Rescheduling a no-show or cancelled interview puts it back on the calendar.
            status: body.status ?? (body.scheduledAt !== undefined && body.scheduledAt !== current.scheduledAt ? "scheduled" : current.status),
            source: "recruiter",
            updatedAt: now,
          }
        : {
            id: randomUUID(),
            scheduledAt: body.scheduledAt ?? now,
            timeSpecified: body.timeSpecified ?? true,
            status: body.status ?? "scheduled",
            source: "recruiter",
            callRecordId: null,
            candidateStatement: null,
            notes: body.notes ?? null,
            createdAt: now,
            updatedAt: now,
          };
      return { ...c, interview };
    });
    if (!updated) throw notFound();
    res.json(updated);
  },
);

candidatesRouter.delete("/:id/interview", async (req: Request<{ id: string }>, res: Response<Candidate>) => {
  const updated = await candidateRepository.update(req.params.id, (c) => ({ ...c, interview: null }));
  if (!updated) throw notFound();
  res.json(updated);
});

candidatesRouter.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  const deleted = await candidateRepository.delete(req.params.id);
  if (!deleted) throw notFound();
  res.status(204).end();
});
