import type {
  ApiErrorBody,
  AuthSession,
  CallRecord,
  Candidate,
  CreateHrUserRequest,
  HrUserSummary,
  SaveCallRequest,
  UpdateHrUserRequest,
  UpdateInterviewRequest,
} from "../shared/types";

export type HealthResponse = { ok: boolean; geminiConfigured: boolean };

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string" &&
    (!("code" in value) || value.code === undefined || typeof value.code === "string")
  );
}

/** Called on any 401, so the HR dashboard can drop back to the sign-in screen. */
let onUnauthenticated: (() => void) | null = null;

export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

/**
 * The /apply page's access to the record it uploaded: the server returns a signed token with the upload,
 * and the page sends it back to read that record and save its call. (HR uses the session cookie instead.)
 */
const CANDIDATE_TOKEN_HEADER = "X-Candidate-Token";
const candidateTokens = new Map<string, string>();

export function rememberCandidateToken(candidateId: string, token: string): void {
  candidateTokens.set(candidateId, token);
}

export function candidateToken(candidateId: string): string | null {
  return candidateTokens.get(candidateId) ?? null;
}

function candidateHeaders(candidateId: string): Record<string, string> {
  const token = candidateTokens.get(candidateId);
  return token ? { [CANDIDATE_TOKEN_HEADER]: token } : {};
}

/** fetch() that throws ApiRequestError for network failures and non-2xx responses. */
async function fetchOrThrow(url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiRequestError("Can't reach the server. Is `npm run dev` running?", 0, "NETWORK_ERROR");
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Non-JSON error body: fall back to the status text below.
    }
    if (isApiErrorBody(body)) {
      if (body.code === "UNAUTHENTICATED") onUnauthenticated?.();
      throw new ApiRequestError(body.error, res.status, body.code);
    }
    throw new ApiRequestError(res.statusText || `Request failed (HTTP ${res.status})`, res.status);
  }
  return res;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetchOrThrow(url, init);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Downloads the CSV export as a Blob, with the server-suggested filename. */
export async function downloadExportCsv(): Promise<{ blob: Blob; fileName: string }> {
  const res = await fetchOrThrow("/api/export.csv");
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const fileName = match?.[1] ?? `candidates-${new Date().toISOString().slice(0, 10)}.csv`;
  return { blob: await res.blob(), fileName };
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health");
}

export function listCandidates(): Promise<Candidate[]> {
  return request<Candidate[]>("/api/candidates");
}

export function getCandidate(id: string): Promise<Candidate> {
  return request<Candidate>(`/api/candidates/${encodeURIComponent(id)}`, { headers: candidateHeaders(id) });
}

export function deleteCandidate(id: string): Promise<void> {
  return request<void>(`/api/candidates/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function uploadResume(file: File): Promise<Candidate> {
  const form = new FormData();
  form.append("resume", file);
  const res = await fetchOrThrow("/api/resume", { method: "POST", body: form });
  const candidate = (await res.json()) as Candidate;
  const token = res.headers.get(CANDIDATE_TOKEN_HEADER);
  if (token) rememberCandidateToken(candidate.id, token);
  return candidate;
}

export type SaveCallResponse = { candidate: Candidate; call: CallRecord };

export function saveCall(candidateId: string, payload: SaveCallRequest): Promise<SaveCallResponse> {
  return request<SaveCallResponse>(`/api/candidates/${encodeURIComponent(candidateId)}/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...candidateHeaders(candidateId) },
    body: JSON.stringify(payload),
  });
}

/** Marks the interview completed / no-show / cancelled, reschedules it, or creates one (needs scheduledAt). */
export function updateInterview(candidateId: string, payload: UpdateInterviewRequest): Promise<Candidate> {
  return request<Candidate>(`/api/candidates/${encodeURIComponent(candidateId)}/interview`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteInterview(candidateId: string): Promise<Candidate> {
  return request<Candidate>(`/api/candidates/${encodeURIComponent(candidateId)}/interview`, { method: "DELETE" });
}

export function getSession(): Promise<AuthSession> {
  return request<AuthSession>("/api/auth/session");
}

export function login(username: string, password: string): Promise<AuthSession> {
  return request<AuthSession>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

// ---------- Team (super admins only) ----------

export function listHrUsers(): Promise<HrUserSummary[]> {
  return request<HrUserSummary[]>("/api/hr-users");
}

export function createHrUser(payload: CreateHrUserRequest): Promise<HrUserSummary> {
  return request<HrUserSummary>("/api/hr-users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateHrUser(id: string, payload: UpdateHrUserRequest): Promise<HrUserSummary> {
  return request<HrUserSummary>(`/api/hr-users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteHrUser(id: string): Promise<void> {
  return request<void>(`/api/hr-users/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function logout(): Promise<void> {
  return request<void>("/api/auth/logout", { method: "POST" });
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
