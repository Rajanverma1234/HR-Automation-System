import { Router, type Request, type Response } from "express";
import type { CallRecord, Candidate } from "../../shared/types.js";
import { candidateNotFound as notFound, recordCall } from "../callRecorder.js";
import { candidateRepository } from "../repository.js";
import { validateSaveCallRequest } from "../validation.js";

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

candidatesRouter.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  const deleted = await candidateRepository.delete(req.params.id);
  if (!deleted) throw notFound();
  res.status(204).end();
});
