import { AlertTriangle, CheckCircle2, Loader2, Phone, PhoneOff, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CallRecord, Candidate, SaveCallRequest } from "../../shared/types";
import { errorMessage, saveCall } from "../api";
import { useBrowserVoiceCall } from "../hooks/useBrowserVoiceCall";
import { useVapiCall, type CallStatus } from "../hooks/useVapiCall";
import { isVapiConfigured } from "../lib/vapiConfig";

/** Vapi when configured; otherwise the free browser-voice demo. Chosen once, so hook order never changes. */
const useCall = isVapiConfigured ? useVapiCall : useBrowserVoiceCall;
import { display, formatDuration, initials } from "../lib/format";
import { lockBodyScroll } from "../lib/scrollLock";
import ConfirmDialog from "./ConfirmDialog";

type Props = {
  candidate: Candidate;
  onClose: () => void;
  onSaved: (candidate: Candidate) => void;
  onViewDetails: (id: string) => void;
};

type SavePhase =
  | { kind: "none" }
  | { kind: "nothing-captured" }
  | { kind: "saving" }
  | { kind: "saved"; call: CallRecord }
  | { kind: "save-error"; message: string };

const recommendationStyle = {
  shortlist: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  hold: "bg-amber-50 text-amber-800 ring-amber-200",
  reject: "bg-red-50 text-red-700 ring-red-200",
} as const;

export default function CallModal({ candidate, onClose, onSaved, onViewDetails }: Props) {
  const [save, setSave] = useState<SavePhase>({ kind: "none" });
  const [payload, setPayload] = useState<SaveCallRequest | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const doSave = useCallback(
    async (body: SaveCallRequest) => {
      setSave({ kind: "saving" });
      try {
        const res = await saveCall(candidate.id, body);
        setSave({ kind: "saved", call: res.call });
        onSavedRef.current(res.candidate);
      } catch (err) {
        setSave({ kind: "save-error", message: errorMessage(err) });
      }
    },
    [candidate.id],
  );

  const onEnded = useCallback(
    (result: SaveCallRequest) => {
      if (result.transcript.length === 0) {
        setSave({ kind: "nothing-captured" });
        return;
      }
      setPayload(result);
      void doSave(result);
    },
    [doSave],
  );

  const call = useCall({ onEnded });
  const { start, stop, status } = call;
  const active = status === "requesting-mic" || status === "connecting" || status === "live";

  // Start automatically on mount; the ref guard keeps StrictMode's double-mount from starting twice.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    void start(candidate);
  }, [start, candidate]);

  const busy = active || status === "ending" || save.kind === "saving";

  const requestClose = useCallback(() => {
    if (active) setConfirmEnd(true);
    else if (!busy) onClose();
  }, [active, busy, onClose]);

  // Esc: never closes while a call is running or saving. Capture phase so the panel underneath doesn't react.
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  const confirmOpenRef = useRef(confirmEnd);
  confirmOpenRef.current = confirmEnd;
  useEffect(() => {
    const unlock = lockBodyScroll();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || confirmOpenRef.current) return;
      e.stopPropagation();
      requestCloseRef.current();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unlock();
    };
  }, []);

  const r = candidate.resumeData;
  const name = r.name ?? "Unnamed candidate";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/60" aria-hidden onClick={requestClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="call-modal-title"
        className="relative flex h-full w-full flex-col bg-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-2xl"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700" aria-hidden>
            {initials(r.name)}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="call-modal-title" className="truncate font-semibold text-slate-900">
              {name}
            </h2>
            <p className="truncate text-sm text-slate-500">
              {display(r.phone)}
              {!isVapiConfigured && <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700">Demo voice</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={busy && !active}
            aria-label={active ? "End call and close" : "Close"}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-40"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* Status row */}
        <div className="flex items-center gap-3 px-4 py-3">
          <StatusPill status={status} />
          {(status === "live" || status === "ending" || status === "ended") && (
            <span className="font-mono text-sm tabular-nums text-slate-600" aria-label="Call duration">
              {formatDuration(call.elapsedSec)}
            </span>
          )}
          {status === "live" && call.isAgentSpeaking && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-indigo-700" aria-live="polite">
              <span className="flex h-3 items-end gap-0.5" aria-hidden>
                <span className="h-1.5 w-0.5 animate-pulse rounded bg-indigo-500" />
                <span className="h-3 w-0.5 animate-pulse rounded bg-indigo-500 [animation-delay:150ms]" />
                <span className="h-2 w-0.5 animate-pulse rounded bg-indigo-500 [animation-delay:300ms]" />
              </span>
              Agent speaking…
            </span>
          )}
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
          {status === "error" && save.kind === "none" ? (
            <ErrorView
              message={call.error ?? "The call failed."}
              onRetry={() => void start(candidate)}
              onClose={onClose}
            />
          ) : (
            <>
              {status === "error" && call.error && (
                <Notice tone="amber">The call ended with an error: {call.error}</Notice>
              )}
              <LiveTranscript lines={call.transcript} partial={call.partial} status={status} />
              <ResultArea
                save={save}
                onRetrySave={() => payload && void doSave(payload)}
                onViewDetails={() => onViewDetails(candidate.id)}
                onClose={onClose}
              />
            </>
          )}

          {(status === "requesting-mic" || status === "connecting" || status === "live" || status === "ending") && (
            <button
              type="button"
              onClick={() => void stop()}
              disabled={status === "ending" || status === "requesting-mic"}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {status === "ending" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PhoneOff className="h-4 w-4" aria-hidden />}
              {status === "ending" ? "Ending…" : "End call"}
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmEnd}
        title="End the call?"
        message="The call will be ended now. Anything said so far will still be saved and analysed."
        confirmLabel="End call"
        destructive
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => {
          setConfirmEnd(false);
          void stop();
        }}
      />
    </div>,
    document.body,
  );
}

function StatusPill({ status }: { status: CallStatus }) {
  const map: Record<CallStatus, { label: string; cls: string; dot: string }> = {
    idle: { label: "Starting…", cls: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500 animate-pulse" },
    "requesting-mic": { label: "Requesting microphone…", cls: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500 animate-pulse" },
    connecting: { label: "Connecting", cls: "bg-amber-50 text-amber-800 ring-amber-200 animate-pulse", dot: "bg-amber-500" },
    live: { label: "Live", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
    ending: { label: "Ending", cls: "bg-slate-100 text-slate-600 ring-slate-200", dot: "bg-slate-400" },
    ended: { label: "Ended", cls: "bg-slate-100 text-slate-600 ring-slate-200", dot: "bg-slate-400" },
    error: { label: "Error", cls: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500" },
  };
  const s = map[status];
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ring-1 ${s.cls}`} role="status">
      <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}

function LiveTranscript({
  lines,
  partial,
  status,
}: {
  lines: { role: "assistant" | "user"; text: string }[];
  partial: { role: "assistant" | "user"; text: string } | null;
  status: CallStatus;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length, partial?.text]);

  const empty = lines.length === 0 && !partial;
  return (
    <div
      className="flex min-h-48 flex-1 flex-col gap-2 overflow-y-auto rounded-xl bg-slate-50 p-3 sm:max-h-80"
      aria-live="polite"
      aria-label="Live transcript"
    >
      {empty && (
        <p className="m-auto flex items-center gap-2 text-sm text-slate-400">
          <Phone className="h-4 w-4" aria-hidden />
          {status === "live" ? "Listening…" : status === "ended" || status === "error" ? "No conversation captured." : "The transcript will appear here."}
        </p>
      )}
      {lines.map((line, i) => (
        <Bubble key={i} role={line.role} text={line.text} />
      ))}
      {partial && <Bubble role={partial.role} text={partial.text} partial />}
      <div ref={endRef} />
    </div>
  );
}

function Bubble({ role, text, partial = false }: { role: "assistant" | "user"; text: string; partial?: boolean }) {
  const agent = role === "assistant";
  return (
    <div className={`flex flex-col ${agent ? "items-start" : "items-end"}`}>
      <span className="mb-0.5 px-1 text-[11px] font-medium text-slate-500">{agent ? "Agent" : "Candidate"}</span>
      <p
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
          agent ? "rounded-tl-sm bg-white text-slate-800 ring-1 ring-slate-200" : "rounded-tr-sm bg-indigo-600 text-white"
        } ${partial ? "italic opacity-60" : ""}`}
      >
        {text}
      </p>
    </div>
  );
}

function ResultArea({
  save,
  onRetrySave,
  onViewDetails,
  onClose,
}: {
  save: SavePhase;
  onRetrySave: () => void;
  onViewDetails: () => void;
  onClose: () => void;
}) {
  if (save.kind === "none") return null;

  if (save.kind === "nothing-captured") {
    return (
      <>
        <Notice tone="slate">The call ended before any conversation was captured. Nothing was saved.</Notice>
        <Actions>
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </Actions>
      </>
    );
  }

  if (save.kind === "saving") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Saving &amp; analysing call…
      </div>
    );
  }

  if (save.kind === "save-error") {
    return (
      <>
        <Notice tone="red">Couldn't save the call: {save.message}</Notice>
        <Actions>
          <SecondaryButton onClick={onClose}>Close without saving</SecondaryButton>
          <PrimaryButton onClick={onRetrySave}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Retry save
          </PrimaryButton>
        </Actions>
      </>
    );
  }

  const a = save.call.analysis;
  return (
    <>
      {a ? (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
            <p className="text-sm font-semibold text-slate-900">Call saved</p>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ${recommendationStyle[a.recommendation.decision]}`}>
              {a.recommendation.decision}
            </span>
          </div>
          <p className="text-sm text-slate-700">{a.callSummary}</p>
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <Stat label="Interested" value={a.interested} capitalize />
            <Stat label="Notice period" value={display(a.noticePeriod)} />
            <Stat label="Expected CTC" value={display(a.expectedCTC)} />
          </dl>
        </div>
      ) : (
        <Notice tone="amber">
          The call was saved, but it couldn't be analysed{save.call.analysisError ? `: ${save.call.analysisError}` : "."}
        </Notice>
      )}
      <Actions>
        <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        <PrimaryButton onClick={onViewDetails}>View details</PrimaryButton>
      </Actions>
    </>
  );
}

function ErrorView({ message, onRetry, onClose }: { message: string; onRetry: () => void; onClose: () => void }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 py-6">
      <Notice tone="red">{message}</Notice>
      <Actions>
        <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        <PrimaryButton onClick={onRetry}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Try again
        </PrimaryButton>
      </Actions>
    </div>
  );
}

function Stat({ label, value, capitalize = false }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`font-medium text-slate-900 ${capitalize ? "capitalize" : ""}`}>{value}</dd>
    </div>
  );
}

function Notice({ tone, children }: { tone: "amber" | "red" | "slate"; children: ReactNode }) {
  const cls = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-900",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  }[tone];
  return (
    <div role={tone === "red" ? "alert" : "status"} className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${cls}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p>{children}</p>
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>;
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
    >
      {children}
    </button>
  );
}

function SecondaryButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
    >
      {children}
    </button>
  );
}
