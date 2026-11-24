import type { ApiErrorBody, CallRecord, Candidate, PhoneCallConfig, PhoneCallJob, SaveCallRequest } from "../shared/types";

export type HealthResponse = { ok: boolean; geminiConfigured: boolean; phoneCall: PhoneCallConfig };

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
    if (isApiErrorBody(body)) throw new ApiRequestError(body.error, res.status, body.code);
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
  return request<Candidate>(`/api/candidates/${encodeURIComponent(id)}`);
}

export function deleteCandidate(id: string): Promise<void> {
  return request<void>(`/api/candidates/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function uploadResume(file: File): Promise<Candidate> {
  const form = new FormData();
  form.append("resume", file);
  return request<Candidate>("/api/resume", { method: "POST", body: form });
}

export type SaveCallResponse = { candidate: Candidate; call: CallRecord };

export function saveCall(candidateId: string, payload: SaveCallRequest): Promise<SaveCallResponse> {
  return request<SaveCallResponse>(`/api/candidates/${encodeURIComponent(candidateId)}/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Asks the server to dial the candidate through Vapi. Resolves with the new job (status "dialing"). */
export function startPhoneCall(candidateId: string): Promise<PhoneCallJob> {
  return request<PhoneCallJob>(`/api/candidates/${encodeURIComponent(candidateId)}/phone-call`, { method: "POST" });
}

/** The candidate's latest phone call job, or null if none was placed since the server started. */
export async function getPhoneCall(candidateId: string, signal?: AbortSignal): Promise<PhoneCallJob | null> {
  try {
    return await request<PhoneCallJob>(`/api/candidates/${encodeURIComponent(candidateId)}/phone-call`, { signal });
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404 && err.code === "NO_PHONE_CALL") return null;
    throw err;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
