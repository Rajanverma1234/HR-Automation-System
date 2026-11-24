import { Router, type Request, type Response } from "express";
import type { Candidate } from "../../shared/types.js";
import { AppError } from "../errors.js";
import { candidateRepository } from "../repository.js";

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

candidatesRouter.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  const deleted = await candidateRepository.delete(req.params.id);
  if (!deleted) throw notFound();
  res.status(204).end();
});
