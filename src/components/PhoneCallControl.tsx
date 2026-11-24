import { AlertTriangle, CheckCircle2, Loader2, PhoneCall, PhoneOutgoing, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toE164 } from "../../shared/phone";
import type { Candidate, PhoneCallConfig, PhoneCallJob, PhoneCallStatus } from "../../shared/types";
import { errorMessage, getPhoneCall, startPhoneCall } from "../api";
import { formatDuration } from "../lib/format";

const POLL_MS = 3_000;
const ACTIVE: readonly PhoneCallStatus[] = ["dialing", "in-progress", "analysing"];

type Props = {
  candidate: Candidate;
  /** From /api/health. null while health is loading or unreachable. */
  config: PhoneCallConfig | null;
  /** Called once when a phone call this view was watching has been analysed and saved. */
  onSaved: (candidateId: string) => void;
};

/** "Call on phone": the server dials the candidate through Vapi; this polls the job until it is saved. */
export default function PhoneCallControl({ candidate, config, onSaved }: Props) {
  const [job, setJob] = useState<PhoneCallJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const lastStatus = useRef<PhoneCallStatus | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const active = job !== null && ACTIVE.includes(job.status);

  const applyJob = useCallback((next: PhoneCallJob | null) => {
    const prev = lastStatus.current;
    lastStatus.current = next?.status ?? null;
    setJob(next);
    // Only notify for a transition seen here, not when reopening a panel whose call finished earlier.
    if (next?.status === "done" && prev !== null && ACTIVE.includes(prev)) onSavedRef.current(next.candidateId);
  }, []);

  // Restore the latest job (e.g. the panel was closed mid-call), then poll while it is active.
  useEffect(() => {
    const controller = new AbortController();
    lastStatus.current = null;
    setJob(null);
    setStartError(null);
    getPhoneCall(candidate.id, controller.signal)
      .then((j) => {
        if (!controller.signal.aborted) applyJob(j);
      })
      .catch(() => {
        // Not fatal: the button still works.
      });
    return () => controller.abort();
  }, [candidate.id, applyJob]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      getPhoneCall(candidate.id, controller.signal)
        .then((j) => {
          if (!controller.signal.aborted) applyJob(j);
        })
        .catch(() => {
          // Transient (server restarting, network blip): keep polling.
        });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [active, candidate.id, applyJob]);

  async function handleStart() {
    setStarting(true);
    setStartError(null);
    try {
      applyJob(await startPhoneCall(candidate.id));
    } catch (err) {
      setStartError(errorMessage(err));
    } finally {
      setStarting(false);
    }
  }

  const rawPhone = candidate.resumeData.phone;
  const number = toE164(rawPhone);
  const disabledReason =
    config === null
      ? "Checking server configuration…"
      : !config.configured
        ? `Phone calls are disabled: set ${config.missingEnvVars.join(", ")} in .env and restart npm run dev`
        : rawPhone === null
          ? "No phone number on this resume"
          : number === null
            ? `"${rawPhone}" is not a valid phone number`
            : active
              ? "A phone call to this candidate is in progress"
              : null;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void handleStart()}
        disabled={disabledReason !== null || starting}
        title={disabledReason ?? `Dial ${number} from your Vapi phone number`}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-white px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-white"
      >
        {starting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PhoneOutgoing className="h-4 w-4" aria-hidden />}
        {starting ? "Placing call…" : number ? `Call on phone (${number})` : "Call on phone"}
      </button>

      {disabledReason !== null && !active && config !== null && (
        <p className="text-xs text-slate-500">{disabledReason}.</p>
      )}

      <div aria-live="polite">
        {startError && <StatusLine tone="error" icon={<AlertTriangle className="h-4 w-4" />} text={startError} />}
        {!startError && job && <JobStatus job={job} />}
      </div>
    </div>
  );
}

function JobStatus({ job }: { job: PhoneCallJob }) {
  switch (job.status) {
    case "dialing":
      return <StatusLine tone="info" icon={<Loader2 className="h-4 w-4 animate-spin" />} text={`Dialling ${job.phoneNumber}…`} />;
    case "in-progress":
      return (
        <StatusLine
          tone="info"
          icon={<PhoneCall className="h-4 w-4 animate-pulse" />}
          text={`On the phone with ${job.phoneNumber}. The result is saved automatically when the call ends.`}
        />
      );
    case "analysing":
      return <StatusLine tone="info" icon={<Sparkles className="h-4 w-4 animate-pulse" />} text="Call ended. Analysing the transcript with Gemini…" />;
    case "done":
      return (
        <StatusLine
          tone="success"
          icon={<CheckCircle2 className="h-4 w-4" />}
          text={`Phone call saved${job.call ? ` (${formatDuration(job.call.durationSec)})` : ""}${job.call?.analysisError ? `, but analysis failed: ${job.call.analysisError}` : ". See Calls below."}`}
        />
      );
    case "error":
      return (
        <StatusLine
          tone="error"
          icon={<AlertTriangle className="h-4 w-4" />}
          text={`${job.error ?? "The phone call failed."}${job.endedReason ? ` (Vapi ended reason: ${job.endedReason})` : ""}`}
        />
      );
  }
}

function StatusLine({ tone, icon, text }: { tone: "info" | "success" | "error"; icon: ReactNode; text: string }) {
  const cls =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "error"
        ? "border-red-200 bg-red-50 text-red-900"
        : "border-indigo-200 bg-indigo-50 text-indigo-900";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${cls}`}>
      <span className="mt-0.5 shrink-0" aria-hidden>
        {icon}
      </span>
      <p className="min-w-0 flex-1 break-words">{text}</p>
    </div>
  );
}
