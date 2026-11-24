import { randomUUID } from "node:crypto";
import { buildAssistantOverrides } from "../shared/agentPrompt.js";
import { toE164 } from "../shared/phone.js";
import type { Candidate, PhoneCallJob, PhoneCallStatus } from "../shared/types.js";
import { recordCall } from "./callRecorder.js";
import { AppError } from "./errors.js";
import { createPhoneCall, getPhoneCall, requireEnv, type VapiCall } from "./vapiPhone.js";

const POLL_INTERVAL_MS = 4_000;
/** Give up tracking after this long. The assistant's Max Duration is 5 minutes, plus ringing time. */
const TRACK_TIMEOUT_MS = 20 * 60_000;
/** Consecutive failed polls (network/Vapi errors) before the job is marked as failed. */
const MAX_POLL_FAILURES = 6;
/** After "ended", Vapi can take a moment to attach the transcript artifact. */
const ARTIFACT_RETRIES = 3;

/**
 * Latest phone-call job per candidate. In memory only: a server restart forgets in-flight jobs
 * (the call itself keeps running on Vapi and can be found in the Vapi dashboard).
 */
const jobs = new Map<string, PhoneCallJob>();

const ACTIVE: readonly PhoneCallStatus[] = ["dialing", "in-progress", "analysing"];

function isActive(job: PhoneCallJob): boolean {
  return ACTIVE.includes(job.status);
}

export function getPhoneCallJob(candidateId: string): PhoneCallJob | null {
  return jobs.get(candidateId) ?? null;
}

/** Applies a patch to the job if it is still the candidate's current job. */
function patchJob(job: PhoneCallJob, patch: Partial<Omit<PhoneCallJob, "id" | "candidateId">>): PhoneCallJob {
  const next: PhoneCallJob = { ...job, ...patch, updatedAt: new Date().toISOString() };
  if (jobs.get(job.candidateId)?.id === job.id) jobs.set(job.candidateId, next);
  return next;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusFor(vapiStatus: string): PhoneCallStatus {
  return vapiStatus === "in-progress" || vapiStatus === "forwarding" ? "in-progress" : "dialing";
}

/** Readable version of Vapi's ended reason, e.g. "customer-did-not-answer" → "customer did not answer". */
function describeEndedReason(reason: string | null): string {
  return reason ? reason.replace(/[-.]/g, " ") : "unknown reason";
}

/** Validates, dials through Vapi and starts tracking the call in the background. */
export async function startPhoneCall(candidate: Candidate): Promise<PhoneCallJob> {
  requireEnv();
  const existing = jobs.get(candidate.id);
  if (existing && isActive(existing)) {
    throw new AppError(409, "A phone call to this candidate is already in progress.", "PHONE_CALL_IN_PROGRESS");
  }

  const rawPhone = candidate.resumeData.phone;
  if (rawPhone === null) {
    throw new AppError(400, "This candidate has no phone number on their resume.", "NO_PHONE");
  }
  const phoneNumber = toE164(rawPhone);
  if (phoneNumber === null) {
    throw new AppError(
      400,
      `"${rawPhone}" is not a valid phone number. Use an Indian mobile number or an international number starting with +.`,
      "INVALID_PHONE",
    );
  }

  const now = new Date().toISOString();
  let job: PhoneCallJob = {
    id: randomUUID(),
    candidateId: candidate.id,
    vapiCallId: null,
    phoneNumber,
    status: "dialing",
    endedReason: null,
    error: null,
    call: null,
    createdAt: now,
    updatedAt: now,
  };
  // Reserve the slot before awaiting Vapi so a double click can't dial twice.
  jobs.set(candidate.id, job);

  let vapiCall: VapiCall;
  try {
    vapiCall = await createPhoneCall({
      customerNumber: phoneNumber,
      customerName: candidate.resumeData.name,
      overrides: buildAssistantOverrides(candidate),
    });
  } catch (err) {
    if (jobs.get(candidate.id)?.id === job.id) jobs.delete(candidate.id);
    throw err;
  }

  job = patchJob(job, { vapiCallId: vapiCall.id, status: statusFor(vapiCall.status) });
  console.log(`[phone] dialling ${phoneNumber} for candidate ${candidate.id} (Vapi call ${vapiCall.id})`);
  void trackCall(job, vapiCall.id);
  return job;
}

async function trackCall(initial: PhoneCallJob, vapiCallId: string): Promise<void> {
  let job = initial;
  const deadline = Date.parse(job.createdAt) + TRACK_TIMEOUT_MS;
  let failures = 0;

  try {
    let call: VapiCall | null = null;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      try {
        call = await getPhoneCall(vapiCallId);
        failures = 0;
      } catch (err) {
        failures += 1;
        console.warn(`[phone] poll ${vapiCallId} failed (${failures}/${MAX_POLL_FAILURES}):`, err instanceof Error ? err.message : err);
        if (failures >= MAX_POLL_FAILURES) throw err;
        continue;
      }
      if (call.status === "ended") break;
      const status = statusFor(call.status);
      if (status !== job.status) job = patchJob(job, { status });
    }

    if (!call || call.status !== "ended") {
      job = patchJob(job, {
        status: "error",
        error: "Stopped waiting for the call to finish. Check the call in the Vapi dashboard → Logs.",
      });
      return;
    }

    for (let i = 0; i < ARTIFACT_RETRIES && call.transcript.length === 0; i++) {
      await sleep(POLL_INTERVAL_MS);
      call = await getPhoneCall(vapiCallId);
    }

    console.log(`[phone] call ${vapiCallId} ended: ${call.endedReason ?? "unknown"}, ${call.transcript.length} lines`);
    job = patchJob(job, { endedReason: call.endedReason });

    if (call.transcript.length === 0) {
      job = patchJob(job, {
        status: "error",
        error: `The call ended (${describeEndedReason(call.endedReason)}) before any conversation was captured.`,
      });
      return;
    }

    job = patchJob(job, { status: "analysing" });
    const startedAt = call.startedAt ?? call.transcript[0]?.at ?? job.createdAt;
    const endedAt = call.endedAt ?? new Date().toISOString();
    const durationSec = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));
    const { call: saved } = await recordCall(job.candidateId, {
      callId: vapiCallId,
      startedAt,
      endedAt,
      durationSec,
      transcript: call.transcript,
    });
    job = patchJob(job, { status: "done", call: saved });
  } catch (err) {
    if (!(err instanceof AppError)) console.error("[phone] tracking failed:", err instanceof Error ? err.stack : err);
    const message = err instanceof AppError ? err.message : "Tracking the phone call failed unexpectedly.";
    patchJob(job, { status: "error", error: message });
  }
}
