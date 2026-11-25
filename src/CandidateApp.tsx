// The page HR sends to candidates (/apply). The candidate uploads a resume and talks to the AI HR agent.
// No dashboard and no other candidates: the card, transcript and analysis appear only on the HR dashboard.
import { AlertTriangle, CheckCircle2, FileText, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import type { Candidate } from "../shared/types";
import { COMPANY_NAME } from "../shared/company";
import { candidateToken, getCandidate, getHealth, rememberCandidateToken } from "./api";
import CallModal from "./components/CallModal";
import { ToastProvider, useToast } from "./components/Toast";
import UploadDropzone from "./components/UploadDropzone";
import { isBrowserVoiceSupported } from "./hooks/useBrowserVoiceCall";
import { isVapiConfigured } from "./lib/vapiConfig";

const canCall = isVapiConfigured || isBrowserVoiceSupported;
/** Remembers this tab's upload, so a refresh doesn't create a second card. */
const SESSION_KEY = "applyCandidateId";

type SavedSession = { id: string; token: string };

function readSession(): SavedSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "id" in parsed &&
      typeof parsed.id === "string" &&
      "token" in parsed &&
      typeof parsed.token === "string"
    ) {
      return { id: parsed.id, token: parsed.token };
    }
    return null;
  } catch {
    return null;
  }
}

function writeSession(id: string): void {
  // The token arrived with the upload; it lets this page read its own record after a refresh.
  const token = candidateToken(id);
  if (!token) return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, token } satisfies SavedSession));
  } catch {
    // storage blocked: a refresh just starts over
  }
}

export default function CandidateApp() {
  return (
    <ToastProvider>
      <ApplyPage />
    </ToastProvider>
  );
}

function ApplyPage() {
  const toast = useToast();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [calling, setCalling] = useState(false);
  const [done, setDone] = useState(false);
  const [uploadsDisabled, setUploadsDisabled] = useState<string | null>(null);

  useEffect(() => {
    document.title = `Apply · ${COMPANY_NAME}`;
    getHealth()
      .then((h) => setUploadsDisabled(h.geminiConfigured ? null : "Applications are temporarily unavailable. Please try again later."))
      .catch(() => setUploadsDisabled("We can't reach our server right now. Please try again in a few minutes."));
    const saved = readSession();
    if (saved) {
      rememberCandidateToken(saved.id, saved.token);
      getCandidate(saved.id)
        .then((c) => {
          setCandidate(c);
          setDone(c.calls.length > 0);
        })
        .catch(() => undefined);
    }
  }, []);

  const firstName = candidate?.resumeData.name?.trim().split(/\s+/)[0] ?? null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <FileText className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight">{COMPANY_NAME} · Careers</h1>
            <p className="text-xs text-slate-500">Upload your resume, then have a short screening call with our HR assistant.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6">
        <Steps step={done ? 3 : candidate ? 2 : 1} />

        {!candidate && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Step 1: Upload your resume</h2>
            <UploadDropzone
              onUploaded={(c) => {
                setCandidate(c);
                writeSession(c.id);
              }}
              onError={(message) => toast.error(message)}
              disabled={uploadsDisabled !== null}
              disabledReason={uploadsDisabled ?? undefined}
            />
          </section>
        )}

        {candidate && !done && (
          <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-2 text-sm text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                Thanks{firstName ? `, ${firstName}` : ""}! We received your resume
                {candidate.resumeData.appliedRole ? ` for ${candidate.resumeData.appliedRole}` : ""}.
              </p>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-700">Step 2: Talk to our HR assistant</h2>
              <p className="mt-1 text-sm text-slate-600">
                A 5-minute voice call in your browser, in English, Hindi or Hinglish. Allow microphone access when asked, and use a quiet place.
              </p>
            </div>
            {canCall ? (
              <button
                type="button"
                onClick={() => setCalling(true)}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-base font-semibold text-white shadow-sm hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
              >
                <Phone className="h-5 w-5" aria-hidden />
                Start call
              </button>
            ) : (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Voice calls aren't supported in this browser. Please open this link in Chrome or Edge.
              </p>
            )}
          </section>
        )}

        {done && (
          <section className="flex flex-col items-center gap-3 rounded-xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" aria-hidden />
            <h2 className="text-lg font-semibold">All done{firstName ? `, ${firstName}` : ""}!</h2>
            <p className="max-w-md text-sm text-slate-600">
              Your screening call has been shared with the {COMPANY_NAME} HR team. They will contact you about the next steps.
            </p>
          </section>
        )}
      </main>

      {calling && candidate && (
        <CallModal
          candidate={candidate}
          audience="candidate"
          onClose={() => setCalling(false)}
          onSaved={(c) => {
            setCandidate(c);
            setDone(true);
          }}
        />
      )}
    </div>
  );
}

function Steps({ step }: { step: 1 | 2 | 3 }) {
  const items = ["Upload resume", "Screening call", "Done"];
  return (
    <ol className="flex items-center gap-2 text-xs font-medium sm:text-sm" aria-label="Progress">
      {items.map((label, i) => {
        const n = i + 1;
        const state = n < step ? "done" : n === step ? "current" : "todo";
        return (
          <li key={label} className="flex flex-1 items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                state === "done" ? "bg-emerald-600 text-white" : state === "current" ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-600"
              }`}
            >
              {state === "done" ? "✓" : n}
            </span>
            <span className={state === "todo" ? "text-slate-400" : "text-slate-800"}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
