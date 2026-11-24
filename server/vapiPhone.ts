import type { AssistantOverrides } from "../shared/agentPrompt.js";
import type { PhoneCallConfig, TranscriptLine } from "../shared/types.js";
import { AppError } from "./errors.js";
import { asArray, cleanString, isRecord } from "./normalize.js";

const VAPI_API = "https://api.vapi.ai";
const REQUEST_TIMEOUT_MS = 20_000;

type VapiEnv = { privateKey: string; phoneNumberId: string; assistantId: string };

function readEnv(): { env: VapiEnv | null; missing: string[] } {
  const privateKey = process.env.VAPI_PRIVATE_KEY?.trim() ?? "";
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID?.trim() ?? "";
  // The same assistant as the browser call. VAPI_ASSISTANT_ID optionally overrides it for phone calls.
  const assistantId = (process.env.VAPI_ASSISTANT_ID || process.env.VITE_VAPI_ASSISTANT_ID)?.trim() ?? "";
  const missing = [
    ...(privateKey ? [] : ["VAPI_PRIVATE_KEY"]),
    ...(phoneNumberId ? [] : ["VAPI_PHONE_NUMBER_ID"]),
    ...(assistantId ? [] : ["VITE_VAPI_ASSISTANT_ID"]),
  ];
  return { env: missing.length === 0 ? { privateKey, phoneNumberId, assistantId } : null, missing };
}

export function getPhoneCallConfig(): PhoneCallConfig {
  const { missing } = readEnv();
  return { configured: missing.length === 0, missingEnvVars: missing };
}

/** Throws 503 PHONE_NOT_CONFIGURED when a phone-call env var is missing. */
export function requireEnv(): VapiEnv {
  const { env, missing } = readEnv();
  if (!env) {
    throw new AppError(
      503,
      `Phone calls are not configured: set ${missing.join(", ")} in .env and restart \`npm run dev\`.`,
      "PHONE_NOT_CONFIGURED",
    );
  }
  return env;
}

/** Vapi's error body is { message: string | string[], error?: string, statusCode?: number }. */
function vapiErrorMessage(body: unknown): string | null {
  if (!isRecord(body)) return null;
  if (Array.isArray(body.message)) {
    const parts = body.message.map(cleanString).filter((s): s is string => s !== null);
    return parts.length > 0 ? parts.join("; ") : null;
  }
  return cleanString(body.message) ?? cleanString(body.error);
}

async function vapiRequest(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
  const { privateKey } = requireEnv();
  let res: Response;
  try {
    res = await fetch(`${VAPI_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${privateKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new AppError(502, `Couldn't reach Vapi (${reason}).`, "VAPI_UNREACHABLE");
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON body: handled below.
  }

  if (!res.ok) {
    const detail = vapiErrorMessage(json) ?? res.statusText ?? `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      throw new AppError(
        502,
        `Vapi rejected the API key (${detail}). Check VAPI_PRIVATE_KEY is the Private key, not the Public key.`,
        "VAPI_AUTH_FAILED",
      );
    }
    throw new AppError(502, `Vapi error (HTTP ${res.status}): ${detail}`, "VAPI_ERROR");
  }
  return json;
}

/** The parts of Vapi's Call object this app uses. */
export type VapiCall = {
  id: string;
  /** "scheduled" | "queued" | "ringing" | "in-progress" | "forwarding" | "ended" */
  status: string;
  endedReason: string | null;
  startedAt: string | null;
  endedAt: string | null;
  transcript: TranscriptLine[];
};

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * Maps Vapi's artifact.messages (role "bot" | "assistant" | "user" | "system" | tool roles, with `time` in epoch ms)
 * to transcript lines. Falls back to the plain-text artifact.transcript ("AI: …\nUser: …") when there are no messages.
 */
function toTranscript(call: Record<string, unknown>, startedAt: string | null): TranscriptLine[] {
  const artifact = isRecord(call.artifact) ? call.artifact : {};
  const messages = asArray(artifact.messages).length > 0 ? asArray(artifact.messages) : asArray(call.messages);
  const fallbackAt = startedAt ?? new Date().toISOString();

  const lines: TranscriptLine[] = [];
  for (const m of messages) {
    if (!isRecord(m)) continue;
    const role = m.role === "user" ? "user" : m.role === "bot" || m.role === "assistant" ? "assistant" : null;
    const text = cleanString(m.message) ?? cleanString(m.content);
    if (role === null || text === null) continue;
    let at = fallbackAt;
    if (typeof m.time === "number" && Number.isFinite(m.time)) {
      at = new Date(m.time).toISOString();
    } else if (startedAt && typeof m.secondsFromStart === "number" && Number.isFinite(m.secondsFromStart)) {
      at = new Date(Date.parse(startedAt) + m.secondsFromStart * 1000).toISOString();
    }
    lines.push({ role, text, at });
  }
  if (lines.length > 0) return lines;

  const plain = cleanString(artifact.transcript) ?? cleanString(call.transcript);
  if (plain === null) return [];
  for (const raw of plain.split(/\r?\n/)) {
    const m = /^\s*(AI|Assistant|Bot|User|Customer)\s*:\s*(.+)$/i.exec(raw);
    if (!m) continue;
    const role = /^(user|customer)$/i.test(m[1]) ? "user" : "assistant";
    lines.push({ role, text: m[2].trim(), at: fallbackAt });
  }
  return lines;
}

function parseCall(json: unknown): VapiCall {
  if (!isRecord(json) || typeof json.id !== "string") {
    throw new AppError(502, "Vapi returned an unexpected response (no call id).", "VAPI_ERROR");
  }
  const startedAt = isoOrNull(json.startedAt);
  return {
    id: json.id,
    status: cleanString(json.status) ?? "queued",
    endedReason: cleanString(json.endedReason),
    startedAt,
    endedAt: isoOrNull(json.endedAt),
    transcript: toTranscript(json, startedAt),
  };
}

/** Places an outbound phone call from the configured Vapi phone number. */
export async function createPhoneCall(input: {
  customerNumber: string;
  customerName: string | null;
  overrides: AssistantOverrides;
}): Promise<VapiCall> {
  const { assistantId, phoneNumberId } = requireEnv();
  const json = await vapiRequest("POST", "/call", {
    assistantId,
    phoneNumberId,
    assistantOverrides: input.overrides,
    customer: {
      number: input.customerNumber,
      ...(input.customerName ? { name: input.customerName.slice(0, 40) } : {}),
    },
  });
  return parseCall(json);
}

export async function getPhoneCall(vapiCallId: string): Promise<VapiCall> {
  return parseCall(await vapiRequest("GET", `/call/${encodeURIComponent(vapiCallId)}`));
}
