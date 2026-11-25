import VapiModule from "@vapi-ai/web";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Candidate, SaveCallRequest, TranscriptLine } from "../../shared/types";
import { buildAssistantOverrides } from "../lib/agentPrompt";
import { isVapiConfigured, VAPI_ASSISTANT_ID, VAPI_PUBLIC_KEY } from "../lib/vapiConfig";

// @vapi-ai/web ships CommonJS (`exports.default = Vapi`). Depending on how Vite pre-bundles it, the
// default import is either the class itself or the whole module object `{ default: Vapi }`.
// Unwrap the second case, otherwise `new Vapi()` throws "Vapi is not a constructor".
type VapiClass = typeof VapiModule;
const Vapi: VapiClass = (VapiModule as unknown as { default?: VapiClass }).default ?? VapiModule;
type Vapi = InstanceType<VapiClass>;

export type CallStatus = "idle" | "requesting-mic" | "connecting" | "live" | "ending" | "ended" | "error";

type PartialLine = { role: TranscriptLine["role"]; text: string };

type Options = {
  /** Called exactly once per call, when it ends (normally, by error, or by stop()). */
  onEnded: (result: SaveCallRequest) => void;
};

type TranscriptMessage = {
  type: "transcript";
  role: string;
  transcriptType: string;
  transcript: string;
};

function isTranscriptMessage(message: unknown): message is TranscriptMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "transcript" &&
    "role" in message &&
    typeof message.role === "string" &&
    "transcript" in message &&
    typeof message.transcript === "string" &&
    "transcriptType" in message &&
    typeof message.transcriptType === "string"
  );
}

/** Joins two transcript fragments, dropping a sentence-ending period the transcriber put mid-sentence ("I'm." + "calling"). */
function joinFragments(previous: string, next: string): string {
  const startsLower = /^[a-z]/.test(next);
  const head = startsLower ? previous.replace(/\.$/, "") : previous;
  return `${head} ${next}`;
}

function hasProp<K extends string>(value: unknown, key: K): value is Record<K, unknown> {
  return typeof value === "object" && value !== null && key in value;
}

const NETWORK_ERROR_MESSAGE =
  "Couldn't connect to the voice service. Please check your internet connection (or try another network / turn off VPN or ad-blocker) and press Try again.";

/** The browser's wording for "the request never reached the server" (Chrome/Edge, Firefox, Safari). */
function isNetworkFailure(message: string): boolean {
  return /failed to fetch|networkerror|network request failed|load failed|err_internet_disconnected|err_name_not_resolved/i.test(message);
}

/** Vapi/Daily errors come in many shapes; dig out something a human can read. */
function readableVapiError(e: unknown): string {
  const message = rawVapiError(e);
  return isNetworkFailure(message) ? NETWORK_ERROR_MESSAGE : message;
}

function rawVapiError(e: unknown): string {
  if (typeof e === "string" && e.trim()) return e;
  if (hasProp(e, "error")) {
    const inner = e.error;
    if (hasProp(inner, "message")) {
      const m = inner.message;
      if (typeof m === "string" && m.trim()) return m;
      if (hasProp(m, "message") && typeof m.message === "string") return m.message;
    }
    if (hasProp(inner, "msg") && typeof inner.msg === "string") return inner.msg;
    if (hasProp(inner, "errorMsg") && typeof inner.errorMsg === "string") return inner.errorMsg;
  }
  if (hasProp(e, "errorMsg") && typeof e.errorMsg === "string" && e.errorMsg.trim()) return e.errorMsg;
  if (hasProp(e, "message") && typeof e.message === "string" && e.message.trim()) return e.message;
  try {
    const json = JSON.stringify(e);
    if (json && json !== "{}") return json;
  } catch {
    // fall through
  }
  return "The voice call failed unexpectedly.";
}

/** Daily reports a normal remote hang-up as an error; treat it as an ordinary end of call. */
function isNormalHangup(message: string): boolean {
  return /meeting has ended|meeting ended|ejected/i.test(message);
}

/** Vapi's own reason for ending a call ("status-update" message), e.g. "call.in-progress.error-vapifault-…". */
function endedReasonOf(message: unknown): string | null {
  if (!hasProp(message, "type") || message.type !== "status-update") return null;
  if (!hasProp(message, "status") || message.status !== "ended") return null;
  return hasProp(message, "endedReason") && typeof message.endedReason === "string" && message.endedReason.trim()
    ? message.endedReason.trim()
    : null;
}

/** Turns Vapi's ended reason into something a recruiter or candidate can act on. */
function describeEndedReason(reason: string): string {
  if (/credit|wallet|balance|subscription|billing|payment/i.test(reason)) {
    return `The voice service account is out of credits, so the call couldn't start. HR has been notified; please try again later. (${reason})`;
  }
  if (/did-not-receive-customer-audio/i.test(reason)) {
    return "We couldn't hear your microphone, so the call ended. Check that the right microphone is selected and not muted, then try again. If it keeps happening, switch to another network (e.g. a mobile hotspot): some Wi-Fi networks block voice calls.";
  }
  if (/assistant-not-found|assistant-not-valid|assistant-request/i.test(reason)) {
    return `The voice assistant isn't set up correctly on Vapi, so the call couldn't start. (${reason})`;
  }
  if (/voice|11labs|eleven|azure|cartesia|playht|deepgram|transcriber|llm|openai|model|pipeline|vapifault|providerfault/i.test(reason)) {
    return `The voice service had a problem starting the call. Please try again in a minute. (${reason})`;
  }
  return `The voice service ended the call. (${reason})`;
}

function domExceptionName(err: unknown): string | null {
  return hasProp(err, "name") && typeof err.name === "string" ? err.name : null;
}

export function useVapiCall({ onEnded }: Options) {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [partial, setPartialState] = useState<PartialLine | null>(null);
  /** Mirror of `partial`, so finalize() keeps a candidate's last words if the call ends before Vapi sends them as final. */
  const partialRef = useRef<PartialLine | null>(null);
  const setPartial = useCallback((p: PartialLine | null) => {
    partialRef.current = p;
    setPartialState(p);
  }, []);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [callId, setCallId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);

  const vapiRef = useRef<Vapi | null>(null);
  const transcriptRef = useRef<TranscriptLine[]>([]);
  const startedAtRef = useRef<string | null>(null);
  const callIdRef = useRef<string | null>(null);
  const statusRef = useRef<CallStatus>("idle");
  const finalizedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(false);
  /** True from just before vapi.start() until the call is over. */
  const activeRef = useRef(false);
  /** Vapi's reason for ending the current call, if it sent one. */
  const endedReasonRef = useRef<string | null>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  const getVapi = useCallback((): Vapi => {
    if (!vapiRef.current) vapiRef.current = new Vapi(VAPI_PUBLIC_KEY);
    return vapiRef.current;
  }, []);

  const updateStatus = useCallback((next: CallStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const finalize = useCallback(() => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    activeRef.current = false;
    stopTimer();
    setIsAgentSpeaking(false);
    const unfinished = partialRef.current;
    if (unfinished?.role === "user" && unfinished.text.trim()) {
      transcriptRef.current = [...transcriptRef.current, { role: "user", text: unfinished.text.trim(), at: new Date().toISOString() }];
      setTranscript(transcriptRef.current);
    }
    setPartial(null);
    const endedAt = new Date().toISOString();
    const started = startedAtRef.current ?? endedAt;
    const durationSec = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(started)) / 1000));
    onEndedRef.current({
      callId: callIdRef.current,
      startedAt: started,
      endedAt,
      durationSec,
      transcript: [...transcriptRef.current],
    });
  }, [stopTimer, setPartial]);

  const fail = useCallback(
    (message: string) => {
      setError(message);
      updateStatus("error");
    },
    [updateStatus],
  );

  // Attach listeners per mount; detach in cleanup so StrictMode's double-mount never duplicates them.
  useEffect(() => {
    mountedRef.current = true;
    if (!isVapiConfigured) {
      return () => {
        mountedRef.current = false;
      };
    }
    const vapi = getVapi();

    const onCallStart = () => {
      const now = new Date().toISOString();
      startedAtRef.current = now;
      setStartedAt(now);
      setElapsedSec(0);
      updateStatus("live");
      stopTimer();
      timerRef.current = setInterval(() => {
        const started = startedAtRef.current;
        if (started) setElapsedSec(Math.floor((Date.now() - Date.parse(started)) / 1000));
      }, 1000);
    };
    const onSpeechStart = () => setIsAgentSpeaking(true);
    const onSpeechEnd = () => setIsAgentSpeaking(false);
    const onMessage = (message: unknown) => {
      const endedReason = endedReasonOf(message);
      if (endedReason) {
        endedReasonRef.current = endedReason;
        console.warn("[vapi] call ended by Vapi:", endedReason);
        return;
      }
      if (!isTranscriptMessage(message)) return;
      const role: TranscriptLine["role"] = message.role === "assistant" ? "assistant" : "user";
      if (message.transcriptType === "final") {
        const text = message.transcript.trim();
        if (text) {
          const now = new Date().toISOString();
          const lines = transcriptRef.current;
          const last = lines[lines.length - 1];
          // Vapi often sends one spoken turn as several "final" fragments ("I'm." / "Calling about." / "The AI.").
          // Consecutive fragments from the same speaker are one turn: append to the previous line.
          transcriptRef.current =
            last && last.role === role
              ? [...lines.slice(0, -1), { ...last, text: joinFragments(last.text, text) }]
              : [...lines, { role, text, at: now }];
          setTranscript(transcriptRef.current);
        }
        setPartial(null);
      } else {
        setPartial({ role, text: message.transcript });
      }
    };
    const onCallEnd = () => {
      if (statusRef.current !== "error") updateStatus("ended");
      finalize();
    };
    const onError = (e: unknown) => {
      let message = readableVapiError(e);
      console.error("[vapi] error:", e);
      const wasLive = statusRef.current === "live" || statusRef.current === "ending";
      if (wasLive && isNormalHangup(message)) {
        updateStatus("ended");
        finalize();
        return;
      }
      // "Meeting has ended" before the call went live: Vapi shut it down; its status-update says why.
      if (isNormalHangup(message) && endedReasonRef.current) message = describeEndedReason(endedReasonRef.current);
      fail(message);
      // Keep whatever was captured: a live call's transcript is still saved.
      if (wasLive) finalize();
      else {
        activeRef.current = false;
        stopTimer();
      }
    };

    vapi.on("call-start", onCallStart);
    vapi.on("speech-start", onSpeechStart);
    vapi.on("speech-end", onSpeechEnd);
    vapi.on("message", onMessage);
    vapi.on("call-end", onCallEnd);
    vapi.on("error", onError);

    return () => {
      mountedRef.current = false;
      vapi.removeListener("call-start", onCallStart);
      vapi.removeListener("speech-start", onSpeechStart);
      vapi.removeListener("speech-end", onSpeechEnd);
      vapi.removeListener("message", onMessage);
      vapi.removeListener("call-end", onCallEnd);
      vapi.removeListener("error", onError);
    };
  }, [getVapi, updateStatus, stopTimer, finalize, fail]);

  // On real unmount, stop any active call (listeners are already gone, so nothing is saved).
  useEffect(() => {
    return () => {
      stopTimer();
      if (activeRef.current && vapiRef.current) {
        activeRef.current = false;
        void vapiRef.current.stop().catch(() => undefined);
      }
    };
  }, [stopTimer]);

  const start = useCallback(
    async (candidate: Candidate) => {
      // Reset per-call state.
      transcriptRef.current = [];
      startedAtRef.current = null;
      callIdRef.current = null;
      endedReasonRef.current = null;
      finalizedRef.current = false;
      setTranscript([]);
      setPartial(null);
      setElapsedSec(0);
      setIsAgentSpeaking(false);
      setCallId(null);
      setStartedAt(null);
      setError(null);

      if (!isVapiConfigured) {
        finalizedRef.current = true;
        fail("Voice calling isn't configured: set VITE_VAPI_PUBLIC_KEY and VITE_VAPI_ASSISTANT_ID in .env, then restart `npm run dev`.");
        return;
      }
      if (!window.isSecureContext) {
        finalizedRef.current = true;
        fail("Microphone needs a secure context (use http://localhost:3000).");
        return;
      }

      updateStatus("requesting-mic");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch (err) {
        finalizedRef.current = true;
        const name = domExceptionName(err);
        if (name === "NotAllowedError" || name === "SecurityError") {
          fail("Microphone permission was denied. Click the lock icon in the address bar, allow the microphone, and try again.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          fail("No microphone was found.");
        } else {
          fail(`Couldn't access the microphone: ${readableVapiError(err)}`);
        }
        return;
      }
      if (!mountedRef.current) return;

      updateStatus("connecting");
      activeRef.current = true;
      try {
        const call = await getVapi().start(VAPI_ASSISTANT_ID, buildAssistantOverrides(candidate));
        if (!call) {
          activeRef.current = false;
          finalizedRef.current = true;
          // An "error" event may already have set a more specific message.
          if (statusRef.current !== "error") {
            fail("Couldn't start the call. Check that your Vapi public key and assistant ID are correct.");
          }
          return;
        }
        callIdRef.current = call.id ?? null;
        setCallId(call.id ?? null);
      } catch (err) {
        activeRef.current = false;
        finalizedRef.current = true;
        fail(`Couldn't start the call: ${readableVapiError(err)}`);
      }
    },
    [fail, getVapi, updateStatus],
  );

  const stop = useCallback(async () => {
    const before = statusRef.current;
    if (before !== "connecting" && before !== "live") return;
    updateStatus("ending");
    try {
      await vapiRef.current?.stop();
    } catch (err) {
      console.error("[vapi] stop failed:", err);
    }
    // If the call never went live, "call-end" may not fire; end it here. finalize() is idempotent.
    if (before === "connecting" || statusRef.current === "ending") {
      updateStatus("ended");
      finalize();
    }
  }, [finalize, updateStatus]);

  return { status, error, transcript, partial, elapsedSec, isAgentSpeaking, callId, startedAt, start, stop };
}
