// HR login and API access control.
//
// - Super admins (owners) come from the HR_USERS env var: comma-separated `username:scryptHash[:Display name]`
//   entries (make one with `npm run hr-user -- nisha --name Nisha`). They can't be changed from the app.
// - Recruiters are added by a super admin on the Team page and stored with the candidates (server/repository.ts).
// - A signed, httpOnly session cookie (HMAC with AUTH_SECRET) keeps an HR user signed in for 7 days.
//   Changing that user's password, removing the account, or changing AUTH_SECRET signs them out.
// - Every /api route needs an HR session, except the few the public /apply page uses. The candidate on /apply
//   gets a signed token for their own record when they upload, and can read only that record and save its call.
// - Managing the team and deleting candidates is for super admins only.
// - Auth is off only for local development with HR_USERS unset. On Vercel a missing config locks the API (503).
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { ApiErrorBody, AuthSession, Candidate, HrRole, HrSessionUser } from "../shared/types.js";
import { AppError } from "./errors.js";
import { hrUserRepository } from "./repository.js";

const SESSION_COOKIE = "hr_session";
const SESSION_TTL_SEC = 7 * 24 * 60 * 60;
const CANDIDATE_TOKEN_TTL_SEC = 48 * 60 * 60;
export const CANDIDATE_TOKEN_HEADER = "x-candidate-token";
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

/** Login ids: a plain username ("nisha") or an email. Lowercase; no ":" or "," (the HR_USERS separators). */
export const USERNAME_RE = /^[a-z0-9][a-z0-9._@+-]{2,63}$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

// ---------- password hashing (scrypt, no extra dependency) ----------

const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 32 } as const;

function scryptAsync(password: string, salt: Buffer, N: number, keyLen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLen, { N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** `scrypt$N$saltBase64url$hashBase64url` */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.N, SCRYPT.keyLen);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, nText, saltText, hashText] = stored.split("$");
  const N = Number(nText);
  if (scheme !== "scrypt" || !Number.isInteger(N) || N < 2 || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  if (expected.length === 0) return false;
  const actual = await scryptAsync(password, Buffer.from(saltText, "base64url"), N, expected.length);
  return timingSafeEqual(actual, expected);
}

// ---------- configuration ----------

/** Anyone who can sign in: an owner from HR_USERS or a stored recruiter. */
export type HrAccount = {
  id: string;
  username: string;
  name: string | null;
  role: HrRole;
  passwordHash: string;
  source: "env" | "stored";
};

type AuthConfig =
  | { mode: "on"; owners: Map<string, HrAccount>; secret: string }
  /** Local dev with HR_USERS unset: everything is open, as before login existed. */
  | { mode: "off"; secret: string }
  /** Deployed without (valid) config: the HR API refuses every request. */
  | { mode: "misconfigured"; reason: string; secret: string };

function parseOwners(raw: string): Map<string, HrAccount> | string {
  const owners = new Map<string, HrAccount>();
  for (const entry of raw.split(",").map((e) => e.trim()).filter(Boolean)) {
    // username:scrypt$N$salt$hash[:Display name]
    const [login = "", passwordHash = "", ...nameParts] = entry.split(":");
    const username = normalizeUsername(login);
    const name = nameParts.join(":").trim() || null;
    if (!USERNAME_RE.test(username) || !passwordHash.startsWith("scrypt$")) {
      return "HR_USERS has an invalid entry (expected username:scrypt$...[:Name]). Make entries with `npm run hr-user`.";
    }
    owners.set(username, { id: `env:${username}`, username, name, role: "superadmin", passwordHash: passwordHash.trim(), source: "env" });
  }
  return owners.size > 0 ? owners : "HR_USERS has no entries.";
}

/** Process-local fallback for signing candidate tokens when auth is off. */
const EPHEMERAL_SECRET = randomBytes(32).toString("hex");

let cachedConfig: AuthConfig | null = null;

function authConfig(): AuthConfig {
  if (cachedConfig) return cachedConfig;
  const rawUsers = process.env.HR_USERS?.trim() ?? "";
  const secret = process.env.AUTH_SECRET?.trim() ?? "";
  const deployed = Boolean(process.env.VERCEL);

  let config: AuthConfig;
  if (!rawUsers) {
    config = deployed
      ? { mode: "misconfigured", reason: "HR_USERS is not set.", secret: secret || EPHEMERAL_SECRET }
      : { mode: "off", secret: secret || EPHEMERAL_SECRET };
  } else if (secret.length < 32) {
    config = { mode: "misconfigured", reason: "AUTH_SECRET must be set (at least 32 characters).", secret: EPHEMERAL_SECRET };
  } else {
    const owners = parseOwners(rawUsers);
    config = typeof owners === "string" ? { mode: "misconfigured", reason: owners, secret } : { mode: "on", owners, secret };
  }

  if (config.mode === "off") {
    console.warn("[auth] HR_USERS is not set: the HR dashboard is open without login (local development only).");
  } else if (config.mode === "misconfigured") {
    console.error(`[auth] HR login is misconfigured, the HR API is locked: ${config.reason}`);
  }
  cachedConfig = config;
  return config;
}

/** The owner (super admin) accounts from HR_USERS; empty when login is off or misconfigured. */
export function ownerAccounts(): HrAccount[] {
  const config = authConfig();
  return config.mode === "on" ? [...config.owners.values()] : [];
}

async function findAccount(username: string): Promise<HrAccount | null> {
  const config = authConfig();
  if (config.mode !== "on") return null;
  const owner = config.owners.get(username);
  if (owner) return owner;
  const stored = (await hrUserRepository.listHrUsers()).find((u) => u.username === username);
  return stored
    ? { id: stored.id, username: stored.username, name: stored.name, role: stored.role, passwordHash: stored.passwordHash, source: "stored" }
    : null;
}

// ---------- signing helpers ----------

function sign(secret: string, purpose: string, payload: string): string {
  return createHmac("sha256", secret).update(`${purpose}\n${payload}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Short fingerprint of the password hash: a password change invalidates existing sessions. */
function passwordVersion(secret: string, account: HrAccount): string {
  return sign(secret, "pwv", account.passwordHash).slice(0, 12);
}

// ---------- HR session cookie ----------

type SessionPayload = { u: string; exp: number; v: string };

function encodeSession(secret: string, account: HrAccount): string {
  const payload: SessionPayload = { u: account.username, exp: nowSec() + SESSION_TTL_SEC, v: passwordVersion(secret, account) };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(secret, "session", body)}`;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function isSessionPayload(value: unknown): value is SessionPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "u" in value &&
    typeof value.u === "string" &&
    "exp" in value &&
    typeof value.exp === "number" &&
    "v" in value &&
    typeof value.v === "string"
  );
}

/** The account behind the request's session cookie, if it is valid and the account still exists unchanged. */
async function sessionAccount(req: Request): Promise<HrAccount | null> {
  const config = authConfig();
  if (config.mode !== "on") return null;
  const raw = readCookie(req, SESSION_COOKIE);
  if (!raw) return null;
  const dot = raw.indexOf(".");
  if (dot < 0) return null;
  const body = raw.slice(0, dot);
  if (!safeEqual(raw.slice(dot + 1), sign(config.secret, "session", body))) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isSessionPayload(payload) || payload.exp <= nowSec()) return null;
  const account = await findAccount(payload.u);
  if (!account || payload.v !== passwordVersion(config.secret, account)) return null;
  return account;
}

function isHttps(req: Request): boolean {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

function setSessionCookie(req: Request, res: Response, value: string, maxAgeSec: number): void {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (isHttps(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function sessionUserOf(account: HrAccount): HrSessionUser {
  return { username: account.username, name: account.name, role: account.role };
}

// ---------- candidate token (the /apply page's access to its own record) ----------

export function issueCandidateToken(candidateId: string): string {
  const exp = nowSec() + CANDIDATE_TOKEN_TTL_SEC;
  return `${exp}.${sign(authConfig().secret, "candidate", `${candidateId}\n${exp}`)}`;
}

function hasCandidateToken(req: Request, candidateId: string): boolean {
  const token = req.headers[CANDIDATE_TOKEN_HEADER];
  if (typeof token !== "string") return false;
  const dot = token.indexOf(".");
  const exp = Number(token.slice(0, dot));
  if (dot < 0 || !Number.isInteger(exp) || exp <= nowSec()) return false;
  return safeEqual(token.slice(dot + 1), sign(authConfig().secret, "candidate", `${candidateId}\n${exp}`));
}

/** What the candidate's own page may see: no AI analysis, recommendation or recruiter notes. */
export function candidateView(candidate: Candidate): Candidate {
  return {
    ...candidate,
    calls: candidate.calls.map((call) => ({ ...call, analysis: null, analysisError: null })),
    interview: candidate.interview ? { ...candidate.interview, notes: null } : null,
  };
}

// ---------- access guard ----------

type Access = { audience: "candidate" } | { audience: "hr"; user: HrSessionUser };
const accessByRequest = new WeakMap<Request, Access>();

/** With login off (local dev) the user acts as a super admin. */
const LOCAL_DEV_USER: HrSessionUser = { username: "local-dev", name: "Local development", role: "superadmin" };

/** "candidate" when the request was let in by a candidate token rather than an HR session. */
export function requestAudience(req: Request): "hr" | "candidate" {
  return accessByRequest.get(req)?.audience ?? "hr";
}

/** The signed-in HR user. Only valid on routes the guard let in with an HR session. */
export function requestUser(req: Request): HrSessionUser {
  const access = accessByRequest.get(req);
  if (access?.audience === "hr") return access.user;
  throw new AppError(401, "Please sign in to the HR dashboard.", "UNAUTHENTICATED");
}

type Route = { method: string; path: RegExp };

const PUBLIC_ROUTES: Route[] = [
  { method: "GET", path: /^\/api\/health\/?$/ },
  { method: "GET", path: /^\/api\/auth\/session\/?$/ },
  { method: "POST", path: /^\/api\/auth\/login\/?$/ },
  { method: "POST", path: /^\/api\/auth\/logout\/?$/ },
  // The /apply page: a candidate uploads their resume (the response carries their candidate token).
  { method: "POST", path: /^\/api\/resume\/?$/ },
];

/** Routes a candidate token opens, for that candidate's id only. */
const CANDIDATE_ROUTES: Route[] = [
  { method: "GET", path: /^\/api\/candidates\/([^/]+)\/?$/ },
  { method: "POST", path: /^\/api\/candidates\/([^/]+)\/calls\/?$/ },
];

/** Super admins only: managing the team, and deleting candidates. */
const SUPERADMIN_ROUTES: Route[] = [
  { method: "*", path: /^\/api\/hr-users(\/.*)?$/ },
  { method: "DELETE", path: /^\/api\/candidates\/[^/]+\/?$/ },
];

function matches(routes: Route[], req: Request): boolean {
  return routes.some((r) => (r.method === "*" || r.method === req.method) && r.path.test(req.path));
}

function notConfigured(): AppError {
  return new AppError(503, "HR login is not configured on the server yet. Ask the admin to set HR_USERS and AUTH_SECRET.", "AUTH_NOT_CONFIGURED");
}

/** Deny by default: every /api request needs an HR session unless listed above. */
export async function apiAccessGuard(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const path = req.path;
  if (!path.startsWith("/api/") || matches(PUBLIC_ROUTES, req)) {
    next();
    return;
  }

  const config = authConfig();
  let user: HrSessionUser | null = null;
  if (config.mode === "off") {
    user = LOCAL_DEV_USER;
  } else if (config.mode === "on") {
    const account = await sessionAccount(req);
    if (account) user = sessionUserOf(account);
  }

  if (user) {
    if (user.role !== "superadmin" && matches(SUPERADMIN_ROUTES, req)) {
      throw new AppError(403, "Only a super admin can do this.", "FORBIDDEN");
    }
    accessByRequest.set(req, { audience: "hr", user });
    next();
    return;
  }

  for (const route of CANDIDATE_ROUTES) {
    if (route.method !== req.method) continue;
    const match = route.path.exec(path);
    const id = match?.[1] ? decodeURIComponent(match[1]) : null;
    if (id && hasCandidateToken(req, id)) {
      accessByRequest.set(req, { audience: "candidate" });
      next();
      return;
    }
  }

  if (config.mode === "misconfigured") throw notConfigured();
  throw new AppError(401, "Please sign in to the HR dashboard.", "UNAUTHENTICATED");
}

// ---------- login rate limit (best effort: per server instance) ----------

const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const failures = new Map<string, number[]>();

function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined;
  return first || req.socket.remoteAddress || "unknown";
}

function recentFailures(key: string): number[] {
  const cutoff = Date.now() - FAILURE_WINDOW_MS;
  const list = (failures.get(key) ?? []).filter((t) => t > cutoff);
  if (list.length > 0) failures.set(key, list);
  else failures.delete(key);
  return list;
}

// ---------- routes ----------

/** Used for unknown usernames, so a wrong username takes as long as a wrong password. */
let dummyHash: Promise<string> | null = null;

export const authRouter = Router();

async function sessionBody(req: Request): Promise<AuthSession> {
  const config = authConfig();
  if (config.mode === "off") return { authRequired: false, configured: true, user: null };
  if (config.mode === "misconfigured") return { authRequired: true, configured: false, user: null };
  const account = await sessionAccount(req);
  return { authRequired: true, configured: true, user: account ? sessionUserOf(account) : null };
}

function stringField(body: unknown, key: string): string {
  if (typeof body !== "object" || body === null || !(key in body)) return "";
  const value: unknown = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

authRouter.get("/session", async (req: Request, res: Response<AuthSession>) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await sessionBody(req));
});

authRouter.post("/login", async (req: Request, res: Response<AuthSession | ApiErrorBody>) => {
  const config = authConfig();
  if (config.mode === "off") {
    res.json(await sessionBody(req));
    return;
  }
  if (config.mode === "misconfigured") throw notConfigured();

  // `email` is accepted too, for clients written before usernames.
  const username = normalizeUsername(stringField(req.body, "username") || stringField(req.body, "email"));
  const password = stringField(req.body, "password");
  if (!username || !password || password.length > MAX_PASSWORD_LENGTH) {
    throw new AppError(400, "Enter your username and password.", "INVALID_BODY");
  }

  const ipKey = `ip:${clientIp(req)}`;
  const userKey = `user:${username}`;
  if (recentFailures(ipKey).length >= MAX_FAILURES * 3 || recentFailures(userKey).length >= MAX_FAILURES) {
    throw new AppError(429, "Too many failed sign-in attempts. Try again in 15 minutes.", "TOO_MANY_ATTEMPTS");
  }

  const account = await findAccount(username);
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  const valid = await verifyPassword(password, account?.passwordHash ?? (await dummyHash));
  if (!account || !valid) {
    for (const key of [ipKey, userKey]) failures.set(key, [...recentFailures(key), Date.now()]);
    throw new AppError(401, "Wrong username or password.", "INVALID_CREDENTIALS");
  }

  failures.delete(userKey);
  setSessionCookie(req, res, encodeSession(config.secret, account), SESSION_TTL_SEC);
  res.setHeader("Cache-Control", "no-store");
  res.json({ authRequired: true, configured: true, user: sessionUserOf(account) });
});

authRouter.post("/logout", (req: Request, res: Response) => {
  setSessionCookie(req, res, "", 0);
  res.status(204).end();
});
