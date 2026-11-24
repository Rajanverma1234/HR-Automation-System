import { AlertTriangle, RefreshCw, UserSearch } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Candidate } from "../shared/types";
import { errorMessage, getHealth, listCandidates, type HealthResponse } from "./api";
import CandidateGrid from "./components/CandidateGrid";
import { ToastProvider, useToast } from "./components/Toast";
import UploadDropzone from "./components/UploadDropzone";

export default function App() {
  return (
    <ToastProvider>
      <Dashboard />
    </ToastProvider>
  );
}

function Dashboard() {
  const toast = useToast();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [healthResult, listResult] = await Promise.allSettled([getHealth(), listCandidates()]);
    if (healthResult.status === "fulfilled") {
      setHealth(healthResult.value);
      setHealthError(null);
    } else {
      setHealthError(errorMessage(healthResult.reason));
    }
    if (listResult.status === "fulfilled") {
      setCandidates(listResult.value);
    } else {
      setLoadError(errorMessage(listResult.reason));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const geminiMissing = health !== null && !health.geminiConfigured;

  function handleUploaded(candidate: Candidate) {
    setCandidates((list) => [candidate, ...list.filter((c) => c.id !== candidate.id)]);
    toast.success(`Added ${candidate.resumeData.name ?? "candidate"} from ${candidate.resumeFileName}`);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <UserSearch className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">HR Screening Agent</h1>
            <p className="text-xs text-slate-500">Upload a resume, review the candidate, start a screening call.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        {healthError && (
          <Banner tone="red" onRetry={() => void load()}>
            {healthError}
          </Banner>
        )}
        {geminiMissing && (
          <Banner tone="amber">
            Resume parsing is disabled: GEMINI_API_KEY is missing in .env. Add it and restart the server.
          </Banner>
        )}

        <section aria-labelledby="upload-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 id="upload-heading" className="mb-3 text-sm font-semibold text-slate-700">
            Add a candidate
          </h2>
          <UploadDropzone
            onUploaded={handleUploaded}
            disabled={geminiMissing || healthError !== null}
            disabledReason={
              geminiMissing
                ? "Uploads are disabled until GEMINI_API_KEY is configured."
                : healthError !== null
                  ? "Uploads are disabled until the server is reachable."
                  : undefined
            }
          />
        </section>

        <section aria-labelledby="candidates-heading" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 id="candidates-heading" className="text-sm font-semibold text-slate-700">
              Candidates{!loading && candidates.length > 0 ? ` (${candidates.length})` : ""}
            </h2>
          </div>
          {loadError && !loading ? (
            <Banner tone="red" onRetry={() => void load()}>
              Couldn't load candidates: {loadError}
            </Banner>
          ) : (
            <CandidateGrid
              candidates={candidates}
              loading={loading}
              onOpen={() => {}}
              onCall={() => toast.info("Calling is added in a later step")}
              onDelete={() => {}}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function Banner({
  tone,
  children,
  onRetry,
}: {
  tone: "amber" | "red";
  children: ReactNode;
  onRetry?: () => void;
}) {
  const cls =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-red-200 bg-red-50 text-red-900";
  return (
    <div role="alert" className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${cls}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p className="flex-1">{children}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="-my-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 font-medium hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Retry
        </button>
      )}
    </div>
  );
}
