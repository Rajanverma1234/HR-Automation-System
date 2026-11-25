// HR login and API access control.
//
// - HR accounts come from the HR_USERS env var: comma-separated `email:scryptHash` entries
//   (make one with `npm run hr-user -- someone@company.com`).
// - A signed, httpOnly session cookie (HMAC with AUTH_SECRET) keeps an HR user signed in for 7 days.
//   Changing that user's password, removing them from HR_USERS, or changing AUTH_SECRET signs them out.
// - Every /api route needs an HR session, except the few the public /apply page uses. The candidate on /apply
//   gets a signed token for their own record when they upload, and can read only that record and save its call.
// - Auth is off only for local development with HR_USERS unset. On Vercel a missing config locks the API (503).
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { ApiErrorBody, AuthSession, Candidate } from "../shared/types.js";
import { AppError } from "./errors.js";

const SESSION_COOKIE = "hr_session";
const SESSION_TTL_SEC = 7 * 24 * 60 * 60;
const CANDIDATE_TOKEN_TTL_SEC = 48 * 60 * 60;
export const CANDIDATE_TOKEN_HEADER = "x-candidate-token";

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

type HrUser = { email: string; passwordHash: string };

type AuthConfig =
  | { mode: "on"; users: Map<string, HrUser>; secret: string }
  /** Local dev with HR_USERS unset: everything is open, as before this feature. */
  | { mode: "off"; secret: string }
  /** Deployed without (valid) config: the HR API refuses every request. */
  | { mode: "misconfigured"; reason: string; secret: string };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseUsers(raw: string): Map<string, HrUser> | string {
  const users = new Map<string, HrUser>();
  for (const entry of raw.split(",").map((e) => e.trim()).filter(Boolean)) {
    const sep = entry.indexOf(":");
    const email = sep > 0 ? normalizeEmail(entry.slice(0, sep)) : "";
    const passwordHash = sep > 0 ? entry.slice(sep + 1).trim() : "";
    if (!email.includes("@") || !passwordHash.startsWith("scrypt$")) {
      return `HR_USERS has an invalid entry (expected email:scrypt$...). Make entries with \`npm run hr-user\`.`;
    }
    users.set(email, { email, passwordHash });
  }
  return users.size > 0 ? users : "HR_USERS has no entries.";
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
    const users = parseUsers(rawUsers);
    config = typeof users === "string" ? { mode: "misconfigured", reason: users, secret } : { mode: "on", users, secret };
  }

  if (config.mode === "off") {
    console.warn("[auth] HR_USERS is not set: the HR dashboard is open without login (local development only).");
  } else if (config.mode === "misconfigured") {
    console.error(`[auth] HR login is misconfigured, the HR API is locked: ${config.reason}`);
  }
  cachedConfig = config;
  return config;
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
function passwordVersion(secret: string, user: HrUser): string {
  return sign(secret, "pwv", user.passwordHash).slice(0, 12);
}

// ---------- HR session cookie ----------

type SessionPayload = { e: string; exp: number; v: string };

function encodeSession(secret: string, user: HrUser): { value: string; exp: number } {
  const exp = nowSec() + SESSION_TTL_SEC;
  const payload: SessionPayload = { e: user.email, exp, v: passwordVersion(secret, user) };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { value: `${body}.${sign(secret, "session", body)}`, exp };
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
    "e" in value &&
    typeof value.e === "string" &&
    "exp" in value &&
    typeof value.exp === "number" &&
    "v" in value &&
    typeof value.v === "string"
  );
}

function sessionUser(req: Request): HrUser | null {
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
  const user = config.users.get(payload.e);
  if (!user || payload.v !== passwordVersion(config.secret, user)) return null;
  return user;
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

type Audience = "hr" | "candidate";
const audiences = new WeakMap<Request, Audience>();

/** "candidate" when the request was let in by a candidate token rather than an HR session. */
export function requestAudience(req: Request): Audience {
  return audiences.get(req) ?? "hr";
}

const PUBLIC_ROUTES: { method: string; path: RegExp }[] = [
  { method: "GET", path: /^\/api\/health\/?$/ },
  { method: "GET", path: /^\/api\/auth\/session\/?$/ },
  { method: "POST", path: /^\/api\/auth\/login\/?$/ },
  { method: "POST", path: /^\/api\/auth\/logout\/?$/ },
  // The /apply page: a candidate uploads their resume (the response carries their candidate token).
  { method: "POST", path: /^\/api\/resume\/?$/ },
];

/** Routes a candidate token opens, for that candidate's id only. */
const CANDIDATE_ROUTES: { method: string; path: RegExp }[] = [
  { method: "GET", path: /^\/api\/candidates\/([^/]+)\/?$/ },
  { method: "POST", path: /^\/api\/candidates\/([^/]+)\/calls\/?$/ },
];

function unauthenticated(): AppError {
  return new AppError(401, "Please sign in to the HR dashboard.", "UNAUTHENTICATED");
}

/** Deny by default: every /api request needs an HR session unless listed above. */
export function apiAccessGuard(req: Request, _res: Response, next: NextFunction): void {
  const path = req.path;
  if (!path.startsWith("/api/") && path !== "/api") {
    next();
    return;
  }
  if (PUBLIC_ROUTES.some((r) => r.method === req.method && r.path.test(path))) {
    next();
    return;
  }

  const config = authConfig();
  if (config.mode === "off") {
    next();
    return;
  }
  if (config.mode === "on" && sessionUser(req)) {
    next();
    return;
  }

  for (const route of CANDIDATE_ROUTES) {
    if (route.method !== req.method) continue;
    const match = route.path.exec(path);
    const id = match?.[1] ? decodeURIComponent(match[1]) : null;
    if (id && hasCandidateToken(req, id)) {
      audiences.set(req, "candidate");
      next();
      return;
    }
  }

  if (config.mode === "misconfigured") {
    throw new AppError(503, "HR login is not configured on the server yet. Ask the admin to set HR_USERS and AUTH_SECRET.", "AUTH_NOT_CONFIGURED");
  }
  throw unauthenticated();
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

/** Used for unknown emails, so a wrong email takes as long as a wrong password. */
let dummyHash: Promise<string> | null = null;

export const authRouter = Router();

function sessionBody(req: Request): AuthSession {
  const config = authConfig();
  if (config.mode === "off") return { authRequired: false, configured: true, user: null };
  if (config.mode === "misconfigured") return { authRequired: true, configured: false, user: null };
  const user = sessionUser(req);
  return { authRequired: true, configured: true, user: user ? { email: user.email } : null };
}

authRouter.get("/session", (req: Request, res: Response<AuthSession>) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(sessionBody(req));
});

authRouter.post("/login", async (req: Request, res: Response<AuthSession | ApiErrorBody>) => {
  const config = authConfig();
  if (config.mode === "off") {
    res.json(sessionBody(req));
    return;
  }
  if (config.mode === "misconfigured") {
    throw new AppError(503, "HR login is not configured on the server yet. Ask the admin to set HR_USERS and AUTH_SECRET.", "AUTH_NOT_CONFIGURED");
  }

  const body: unknown = req.body;
  const email = typeof body === "object" && body !== null && "email" in body && typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const password = typeof body === "object" && body !== null && "password" in body && typeof body.password === "string" ? body.password : "";
  if (!email || !password || password.length > 200) {
    throw new AppError(400, "Enter your email and password.", "INVALID_BODY");
  }

  const ipKey = `ip:${clientIp(req)}`;
  const emailKey = `email:${email}`;
  if (recentFailures(ipKey).length >= MAX_FAILURES * 3 || recentFailures(emailKey).length >= MAX_FAILURES) {
    throw new AppError(429, "Too many failed sign-in attempts. Try again in 15 minutes.", "TOO_MANY_ATTEMPTS");
  }

  const user = config.users.get(email);
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  const valid = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !valid) {
    for (const key of [ipKey, emailKey]) failures.set(key, [...recentFailures(key), Date.now()]);
    throw new AppError(401, "Wrong email or password.", "INVALID_CREDENTIALS");
  }

  failures.delete(emailKey);
  const session = encodeSession(config.secret, user);
  setSessionCookie(req, res, session.value, SESSION_TTL_SEC);
  res.setHeader("Cache-Control", "no-store");
  res.json({ authRequired: true, configured: true, user: { email: user.email } });
});

authRouter.post("/logout", (req: Request, res: Response) => {
  setSessionCookie(req, res, "", 0);
  res.status(204).end();
});
