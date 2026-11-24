// Free demo calling: the browser's own speech synthesis (agent voice) + speech recognition (candidate),
// driven by a scripted question flow. Used when Vapi keys are not configured. Same API as useVapiCall.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Candidate, SaveCallRequest, TranscriptLine } from "../../shared/types";
import { buildDemoScript, isNotAGoodTime } from "../lib/demoScript";
import type { CallStatus } from "./useVapiCall";

// ---- Minimal Web Speech API typings (not in TypeScript's DOM lib) ----
type RecognitionResult = { readonly isFinal: boolean; readonly [index: number]: { readonly transcript: string } };
type RecognitionEvent = { readonly resultIndex: number; readonly results: { readonly length: number; readonly [index: number]: RecognitionResult } };
type RecognitionErrorEvent = { readonly error: string };
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Chrome and Edge (desktop) support both halves of the Web Speech API. */
export const isBrowserVoiceSupported: boolean =
  typeof window !== "undefined" && getRecognitionCtor() !== null && "speechSynthesis" in window;

const RECOGNITION_LANG = "en-IN"; // Indian English; also copes with romanised Hinglish.
const SILENCE_END_MS = 1600; // the answer is over after this much silence
const NO_SPEECH_MS = 9000; // give up waiting for an answer to start

type Options = { onEnded: (result: SaveCallRequest) => void };

class Cancelled extends Error {}

async function pickVoice(): Promise<SpeechSynthesisVoice | null> {
  const synth = window.speechSynthesis;
  let voices = synth.getVoices();
  if (voices.length === 0) {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 1000);
      synth.addEventListener("voiceschanged", () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    });
    voices = synth.getVoices();
  }
  const female = /female|neerja|swara|heera|zira|aria|jenny|samantha|google uk english female/i;
  return (
    voices.find((v) => v.lang === "en-IN" && female.test(v.name)) ??
    voices.find((v) => v.lang === "en-IN") ??
    voices.find((v) => v.lang.startsWith("en") && female.test(v.name)) ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null
  );
}

export function useBrowserVoiceCall({ onEnded }: Options) {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [partial, setPartial] = useState<{ role: TranscriptLine["role"]; text: string } | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [callId, setCallId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);

  const statusRef = useRef<CallStatus>("idle");
  const transcriptRef = useRef<TranscriptLine[]>([]);
  const startedAtRef = useRef<string | null>(null);
  const callIdRef = useRef<string | null>(null);
  const finalizedRef = useRef(true);
  const cancelledRef = useRef(false);
  const recognitionRef = useRef<Recognition | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  const updateStatus = useCallback((next: CallStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const push = useCallback((role: TranscriptLine["role"], text: string) => {
    transcriptRef.current = [...transcriptRef.current, { role, text, at: new Date().toISOString() }];
    setTranscript(transcriptRef.current);
  }, []);

  const teardownAudio = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        // already stopped
      }
    }
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setIsAgentSpeaking(false);
    setPartial(null);
  }, []);

  const finalize = useCallback(() => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    teardownAudio();
    const endedAt = new Date().toISOString();
    const started = startedAtRef.current ?? endedAt;
    onEndedRef.current({
      callId: callIdRef.current,
      startedAt: started,
      endedAt,
      durationSec: Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(started)) / 1000)),
      transcript: [...transcriptRef.current],
    });
  }, [teardownAudio]);

  const speak = useCallback(
    (text: string) =>
      new Promise<void>((resolve, reject) => {
        if (cancelledRef.current) return reject(new Cancelled());
        push("assistant", text);
        const u = new SpeechSynthesisUtterance(text);
        if (voiceRef.current) u.voice = voiceRef.current;
        u.lang = voiceRef.current?.lang ?? "en-IN";
        u.rate = 1;
        u.onstart = () => setIsAgentSpeaking(true);
        const done = () => {
          setIsAgentSpeaking(false);
          if (cancelledRef.current) reject(new Cancelled());
          else resolve();
        };
        u.onend = done;
        u.onerror = done;
        window.speechSynthesis.speak(u);
      }),
    [push],
  );

  /** Listens for one answer. Resolves with the text, or null if the candidate said nothing. */
  const listen = useCallback(
    () =>
      new Promise<string | null>((resolve, reject) => {
        const Ctor = getRecognitionCtor();
        if (!Ctor) return reject(new Error("Speech recognition isn't available in this browser. Use Chrome or Edge."));
        if (cancelledRef.current) return reject(new Cancelled());

        const rec = new Ctor();
        recognitionRef.current = rec;
        rec.lang = RECOGNITION_LANG;
        rec.continuous = true;
        rec.interimResults = true;

        let finalText = "";
        let interimText = "";
        let settled = false;
        let silenceTimer: ReturnType<typeof setTimeout> | null = null;
        const noSpeechTimer = setTimeout(() => finish(), NO_SPEECH_MS);

        function finish(err?: Error) {
          if (settled) return;
          settled = true;
          clearTimeout(noSpeechTimer);
          if (silenceTimer) clearTimeout(silenceTimer);
          rec.onresult = null;
          rec.onerror = null;
          rec.onend = null;
          try {
            rec.stop();
          } catch {
            // already stopped
          }
          if (recognitionRef.current === rec) recognitionRef.current = null;
          setPartial(null);
          if (err) return reject(err);
          if (cancelledRef.current) return reject(new Cancelled());
          const answer = `${finalText} ${interimText}`.replace(/\s+/g, " ").trim();
          resolve(answer || null);
        }

        rec.onresult = (e) => {
          clearTimeout(noSpeechTimer);
          interimText = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const result = e.results[i];
            const text = result?.[0]?.transcript ?? "";
            if (result?.isFinal) finalText += ` ${text}`;
            else interimText += ` ${text}`;
          }
          setPartial({ role: "user", text: `${finalText} ${interimText}`.trim() });
          if (silenceTimer) clearTimeout(silenceTimer);
          silenceTimer = setTimeout(() => finish(), SILENCE_END_MS);
        };
        rec.onerror = (e) => {
          if (e.error === "no-speech" || e.error === "aborted") return; // onend follows
          if (e.error === "not-allowed" || e.error === "service-not-allowed") {
            finish(new Error("Microphone permission was denied. Click the lock icon in the address bar, allow the microphone, and try again."));
          } else if (e.error === "network") {
            finish(new Error("Speech recognition needs an internet connection (the browser sends audio to its speech service)."));
          } else if (e.error === "audio-capture") {
            finish(new Error("No microphone was found."));
          } else {
            finish(new Error(`Speech recognition error: ${e.error}`));
          }
        };
        rec.onend = () => finish(); // browser ended the session (e.g. long silence)
        rec.start();
      }),
    [],
  );

  /** Asks a question, re-asking once if there is no answer. */
  const ask = useCallback(
    async (question: string): Promise<string | null> => {
      await speak(question);
      let answer = await listen();
      if (answer === null) {
        await speak("Sorry, I didn't catch that. " + question);
        answer = await listen();
      }
      if (answer !== null) push("user", answer);
      return answer;
    },
    [listen, push, speak],
  );

  useEffect(() => {
    // StrictMode mounts → unmounts → remounts once. If a call started during the first mount,
    // the simulated unmount below cancelled it; resume it here (status is untouched by cleanup).
    const s = statusRef.current;
    if (s === "requesting-mic" || s === "connecting" || s === "live") {
      cancelledRef.current = false;
      finalizedRef.current = false;
    }
    return () => {
      // Unmount: stop audio without saving.
      cancelledRef.current = true;
      finalizedRef.current = true;
      teardownAudio();
    };
  }, [teardownAudio]);

  const start = useCallback(
    async (candidate: Candidate) => {
      cancelledRef.current = false;
      finalizedRef.current = false;
      transcriptRef.current = [];
      startedAtRef.current = null;
      setTranscript([]);
      setPartial(null);
      setElapsedSec(0);
      setError(null);
      setStartedAt(null);

      const fail = (message: string) => {
        finalizedRef.current = true;
        teardownAudio();
        setError(message);
        updateStatus("error");
      };

      if (!isBrowserVoiceSupported) return fail("This browser can't run the demo voice call. Use Chrome or Edge on a desktop.");
      if (!window.isSecureContext) return fail("Microphone needs a secure context (use http://localhost:3000).");

      updateStatus("requesting-mic");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        return fail(
          name === "NotAllowedError" || name === "SecurityError"
            ? "Microphone permission was denied. Click the lock icon in the address bar, allow the microphone, and try again."
            : name === "NotFoundError"
              ? "No microphone was found."
              : "Couldn't access the microphone.",
        );
      }

      updateStatus("connecting");
      voiceRef.current = await pickVoice();
      const id = `demo-${crypto.randomUUID()}`;
      callIdRef.current = id;
      setCallId(id);
      const now = new Date().toISOString();
      startedAtRef.current = now;
      setStartedAt(now);
      updateStatus("live");
      timerRef.current = setInterval(() => {
        const s = startedAtRef.current;
        if (s) setElapsedSec(Math.floor((Date.now() - Date.parse(s)) / 1000));
      }, 1000);

      const script = buildDemoScript(candidate);
      try {
        const first = await ask(script.greeting);
        if (first !== null && isNotAGoodTime(first)) {
          await speak(script.callBack);
        } else {
          for (const q of script.questions) await ask(q);
          await speak(script.closing);
        }
        updateStatus("ended");
        finalize();
      } catch (err) {
        if (err instanceof Cancelled) return; // stop() already handled it
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        updateStatus("error");
        finalize(); // keep whatever was said
      }
    },
    [ask, finalize, speak, teardownAudio, updateStatus],
  );

  const stop = useCallback(async () => {
    const s = statusRef.current;
    if (s !== "connecting" && s !== "live" && s !== "requesting-mic") return;
    updateStatus("ending");
    cancelledRef.current = true;
    updateStatus("ended");
    finalize();
  }, [finalize, updateStatus]);

  return { status, error, transcript, partial, elapsedSec, isAgentSpeaking, callId, startedAt, start, stop };
}
