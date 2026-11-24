import { AlertTriangle, RefreshCw, UserSearch } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Candidate } from "../shared/types";
import { errorMessage, getHealth, listCandidates, type HealthResponse } from "./api";
import CandidateDetailPanel from "./components/CandidateDetailPanel";
import CandidateGrid from "./components/CandidateGrid";
import DeleteCandidateDialog from "./components/DeleteCandidateDialog";
import { ToastProvider, useToast } from "./components/Toast";
import Toolbar, { type StatusFilter } from "./components/Toolbar";
import UploadDropzone from "./components/UploadDropzone";

function matchesQuery(candidate: Candidate, query: string): boolean {
  if (!query) return true;
  const r = candidate.resumeData;
  const haystack = [r.name, r.email, r.phone, r.location, r.currentCompany, r.currentDesignation, ...r.skills]
    .filter((v): v is string => typeof v === "string")
    .join("\n")
    .toLowerCase();
  return haystack.includes(query);
}

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
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [panelRefreshKey] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<Candidate | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const searchMatches = useMemo(
    () => candidates.filter((c) => matchesQuery(c, normalizedQuery)),
    [candidates, normalizedQuery],
  );
  const counts = useMemo<Record<StatusFilter, number>>(
    () => ({
      all: searchMatches.length,
      new: searchMatches.filter((c) => c.status === "new").length,
      called: searchMatches.filter((c) => c.status === "called").length,
    }),
    [searchMatches],
  );
  const visible = useMemo(
    () => (statusFilter === "all" ? searchMatches : searchMatches.filter((c) => c.status === statusFilter)),
    [searchMatches, statusFilter],
  );

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

  function handleDeleted(id: string, name: string | null) {
    setCandidates((list) => list.filter((c) => c.id !== id));
    setPendingDelete(null);
    setOpenId((current) => (current === id ? null : current));
    toast.success(`Deleted ${name ?? "candidate"}`);
  }

  function handleCall() {
    toast.info("Calling is added in a later step");
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
          <h2 id="candidates-heading" className="text-sm font-semibold text-slate-700">
            Candidates
          </h2>
          {!loading && !loadError && candidates.length > 0 && (
            <Toolbar
              onQueryChange={setQuery}
              status={statusFilter}
              onStatusChange={setStatusFilter}
              counts={counts}
              shown={visible.length}
              total={candidates.length}
            />
          )}
          {loadError && !loading ? (
            <Banner tone="red" onRetry={() => void load()}>
              Couldn't load candidates: {loadError}
            </Banner>
          ) : !loading && candidates.length > 0 && visible.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-600">
              No candidates match your search or filter.
            </div>
          ) : (
            <CandidateGrid
              candidates={visible}
              loading={loading}
              onOpen={(c) => setOpenId(c.id)}
              onCall={handleCall}
              onDelete={(c) => setPendingDelete(c)}
            />
          )}
        </section>
      </main>

      {openId && (
        <CandidateDetailPanel
          candidateId={openId}
          refreshKey={panelRefreshKey}
          onClose={() => setOpenId(null)}
          onCall={handleCall}
          onDeleted={(id) => handleDeleted(id, candidates.find((c) => c.id === id)?.resumeData.name ?? null)}
        />
      )}

      <DeleteCandidateDialog
        candidate={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onDeleted={(c) => handleDeleted(c.id, c.resumeData.name)}
      />

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
