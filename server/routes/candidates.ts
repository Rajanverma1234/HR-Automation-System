import { Router, type Request, type Response } from "express";
import type { CallRecord, Candidate, PhoneCallJob } from "../../shared/types.js";
import { candidateNotFound as notFound, recordCall } from "../callRecorder.js";
import { AppError } from "../errors.js";
import { getPhoneCallJob, startPhoneCall } from "../phoneCalls.js";
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

/** Places a real phone call through Vapi. The server tracks it; poll GET /:id/phone-call for progress. */
candidatesRouter.post(
  "/:id/phone-call",
  async (req: Request<{ id: string }>, res: Response<PhoneCallJob>) => {
    const candidate = await candidateRepository.get(req.params.id);
    if (!candidate) throw notFound();
    res.status(202).json(await startPhoneCall(candidate));
  },
);

/** The latest phone call job for this candidate (dialing, in-progress, analysing, done or error). */
candidatesRouter.get(
  "/:id/phone-call",
  async (req: Request<{ id: string }>, res: Response<PhoneCallJob>) => {
    const job = getPhoneCallJob(req.params.id);
    if (!job) throw new AppError(404, "No phone call has been placed to this candidate since the server started.", "NO_PHONE_CALL");
    res.json(job);
  },
);

candidatesRouter.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  const deleted = await candidateRepository.delete(req.params.id);
  if (!deleted) throw notFound();
  res.status(204).end();
});
