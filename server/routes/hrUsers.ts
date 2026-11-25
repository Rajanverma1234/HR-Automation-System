// The Team page API (super admins only; the access guard in server/auth.ts enforces that).
// Owner accounts come from HR_USERS and are listed read-only; recruiters are stored with the candidates.
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { CreateHrUserRequest, HrUserSummary, StoredHrUser, UpdateHrUserRequest } from "../../shared/types.js";
import {
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  normalizeUsername,
  ownerAccounts,
  requestUser,
  USERNAME_RE,
} from "../auth.js";
import { AppError } from "../errors.js";
import { hrUserRepository } from "../repository.js";

const MAX_NAME_LENGTH = 60;

function invalid(message: string): AppError {
  return new AppError(400, message, "INVALID_BODY");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseName(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw invalid("name must be a string or null.");
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length > MAX_NAME_LENGTH) throw invalid(`name must be at most ${MAX_NAME_LENGTH} characters.`);
  return name || null;
}

function parsePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) {
    throw invalid(`password must be ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters.`);
  }
  return value;
}

function validateCreate(body: unknown): CreateHrUserRequest {
  if (!isObject(body)) throw invalid("Body must be a JSON object.");
  const username = typeof body.username === "string" ? normalizeUsername(body.username) : "";
  if (!USERNAME_RE.test(username)) {
    throw invalid("username must be 3–64 characters: letters, digits and . _ - + @ (an email works too).");
  }
  return { username, name: parseName(body.name), password: parsePassword(body.password) };
}

function validateUpdate(body: unknown): UpdateHrUserRequest {
  if (!isObject(body)) throw invalid("Body must be a JSON object.");
  const update: UpdateHrUserRequest = {};
  if ("name" in body) update.name = parseName(body.name);
  if ("password" in body) update.password = parsePassword(body.password);
  if (update.name === undefined && update.password === undefined) throw invalid("Send name and/or password.");
  return update;
}

function summary(u: StoredHrUser): HrUserSummary {
  return { id: u.id, username: u.username, name: u.name, role: u.role, source: "stored", createdAt: u.createdAt, createdBy: u.createdBy };
}

function notFound(): AppError {
  return new AppError(404, "HR account not found. Owner accounts (from HR_USERS) can only be changed on the server.", "NOT_FOUND");
}

export const hrUsersRouter = Router();

hrUsersRouter.get("/", async (_req: Request, res: Response<HrUserSummary[]>) => {
  const owners: HrUserSummary[] = ownerAccounts().map((o) => ({
    id: o.id,
    username: o.username,
    name: o.name,
    role: o.role,
    source: "env",
    createdAt: null,
    createdBy: null,
  }));
  const stored = (await hrUserRepository.listHrUsers()).map(summary);
  res.setHeader("Cache-Control", "no-store");
  res.json([...owners, ...stored]);
});

hrUsersRouter.post("/", async (req: Request, res: Response<HrUserSummary>) => {
  const body = validateCreate(req.body);
  const ownerNames = new Set(ownerAccounts().map((o) => o.username));
  const now = new Date().toISOString();
  const created = await hrUserRepository.createHrUser(
    {
      id: randomUUID(),
      username: body.username,
      name: body.name,
      role: "recruiter",
      passwordHash: await hashPassword(body.password),
      createdAt: now,
      updatedAt: now,
      createdBy: requestUser(req).username,
    },
    (username) => ownerNames.has(username),
  );
  res.status(201).json(summary(created));
});

/** Rename and/or reset the password. A new password signs the account out everywhere. */
hrUsersRouter.patch("/:id", async (req: Request<{ id: string }>, res: Response<HrUserSummary>) => {
  const body = validateUpdate(req.body);
  const passwordHash = body.password !== undefined ? await hashPassword(body.password) : undefined;
  const updated = await hrUserRepository.updateHrUser(req.params.id, (u) => ({
    ...u,
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(passwordHash !== undefined ? { passwordHash } : {}),
  }));
  if (!updated) throw notFound();
  res.json(summary(updated));
});

hrUsersRouter.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  const deleted = await hrUserRepository.deleteHrUser(req.params.id);
  if (!deleted) throw notFound();
  res.status(204).end();
});
