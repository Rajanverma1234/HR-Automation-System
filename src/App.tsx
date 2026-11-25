import { AlertTriangle, Check, Copy, Download, ExternalLink, Loader2, LogOut, RefreshCw, UserSearch, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatInterviewWhen, interviewState } from "../shared/interview";
import type { AuthSession, Candidate, HrSessionUser } from "../shared/types";
import {
  downloadExportCsv,
  errorMessage,
  getHealth,
  getSession,
  listCandidates,
  logout,
  setUnauthenticatedHandler,
  type HealthResponse,
} from "./api";
import CallModal from "./components/CallModal";
import CandidateDetailPanel from "./components/CandidateDetailPanel";
import CandidateGrid from "./components/CandidateGrid";
import DeleteCandidateDialog from "./components/DeleteCandidateDialog";
import LoginPage from "./components/LoginPage";
import TeamPanel from "./components/TeamPanel";
import { ToastProvider, useToast } from "./components/Toast";
import Toolbar, { type StatusFilter } from "./components/Toolbar";
import VoicePicker from "./components/VoicePicker";
import { isBrowserVoiceSupported } from "./hooks/useBrowserVoiceCall";
import { useNow } from "./hooks/useNow";
import { isVapiConfigured, vapiMissingEnvVars } from "./lib/vapiConfig";

/** How often the dashboard quietly refetches candidates while the tab is visible. */
const REFRESH_MS = 20_000;

/** Vapi if configured, otherwise the free browser-voice demo (Chrome/Edge). */
const canCall = isVapiConfigured || isBrowserVoiceSupported;

function matchesQuery(candidate: Candidate, query: string): boolean {
  if (!query) return true;
  const r = candidate.resumeData;
  const haystack = [r.name, r.appliedRole, r.email, r.phone, r.location, r.currentCompany, r.currentDesignation, ...r.skills]
    .filter((v): v is string => typeof v === "string")
    .join("\n")
    .toLowerCase();
  return haystack.includes(query);
}

function matchesFilter(candidate: Candidate, filter: StatusFilter, now: Date): boolean {
  if (filter === "all") return true;
  if (filter === "new" || filter === "called") return candidate.status === filter;
  if (!candidate.interview) return false;
  const state = interviewState(candidate.interview, now);
  return filter === "overdue" ? state === "overdue" : state === "upcoming" || state === "today";
}

export default function App() {
  return (
    <ToastProvider>
      <AuthGate />
    </ToastProvider>
  );
}

/** Shows the sign-in screen until the server confirms an HR session (or that login is off in local dev). */
function AuthGate() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(() => {
    setError(null);
    getSession()
      .then(setSession)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    check();
    // Any API call that comes back "not signed in" (expired session, signed out in another tab) returns here.
    setUnauthenticatedHandler(() => setSession((s) => (s && s.authRequired ? { ...s, user: null } : s)));
    return () => setUnauthenticatedHandler(null);
  }, [check]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Banner tone="red" onRetry={check}>
          {error}
        </Banner>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50" aria-busy="true">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-label="Loading" />
      </div>
    );
  }
  if (session.authRequired && !session.user) {
    return <LoginPage configured={session.configured} onSignedIn={setSession} />;
  }
  return (
    <Dashboard
      user={session.user}
      onSignOut={async () => {
        try {
          await logout();
        } finally {
          setSession({ ...session, user: null });
        }
      }}
    />
  );
}

/** `user` is null only with login off (local dev), where everyone acts as a super admin. */
function Dashboard({ user, onSignOut }: { user: HrSessionUser | null; onSignOut: () => Promise<void> }) {
  const toast = useToast();
  const isSuperAdmin = user === null || user.role === "superadmin";
  const [teamOpen, setTeamOpen] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [panelRefreshKey, setPanelRefreshKey] = useState(0);
  const [callingCandidate, setCallingCandidate] = useState<Candidate | null>(null);
  const [exporting, setExporting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Candidate | null>(null);
  const now = useNow();

  const normalizedQuery = query.trim().toLowerCase();
  const searchMatches = useMemo(
    () => candidates.filter((c) => matchesQuery(c, normalizedQuery)),
    [candidates, normalizedQuery],
  );
  const counts = useMemo<Record<StatusFilter, number>>(
    () => ({
      all: searchMatches.length,
      new: searchMatches.filter((c) => matchesFilter(c, "new", now)).length,
      called: searchMatches.filter((c) => matchesFilter(c, "called", now)).length,
      interview: searchMatches.filter((c) => matchesFilter(c, "interview", now)).length,
      overdue: searchMatches.filter((c) => matchesFilter(c, "overdue", now)).length,
    }),
    [searchMatches, now],
  );
  const visible = useMemo(() => {
    const list = searchMatches.filter((c) => matchesFilter(c, statusFilter, now));
    // Interview views are sorted by interview time, soonest (or longest overdue) first.
    if (statusFilter === "interview" || statusFilter === "overdue") {
      list.sort((a, b) => (a.interview?.scheduledAt ?? "").localeCompare(b.interview?.scheduledAt ?? ""));
    }
    return list;
  }, [searchMatches, statusFilter, now]);
  const overdueTotal = useMemo(() => candidates.filter((c) => matchesFilter(c, "overdue", now)).length, [candidates, now]);
  const todayTotal = useMemo(
    () => candidates.filter((c) => c.interview && interviewState(c.interview, now) === "today").length,
    [candidates, now],
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

  // Keep the dashboard current when calls, uploads or edits happen in another browser (e.g. a shared link):
  // refetch quietly every 20 s while the tab is visible, and whenever the tab regains focus.
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;
  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  useEffect(() => {
    let inFlight = false;
    async function refresh() {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const list = await listCandidates();
        const openNow = openIdRef.current;
        const before = candidatesRef.current.find((c) => c.id === openNow);
        const after = list.find((c) => c.id === openNow);
        setCandidates(list);
        setLoadError(null);
        // The open detail panel fetches its own copy; reload it if that candidate changed.
        if (before && after && before.updatedAt !== after.updatedAt) setPanelRefreshKey((k) => k + 1);
      } catch {
        // Keep showing the current list; the next tick retries.
      } finally {
        inFlight = false;
      }
    }
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    const onVisible = () => void refresh();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const geminiMissing = health !== null && !health.geminiConfigured;

  async function handleExport() {
    setExporting(true);
    try {
      const { blob, fileName } = await downloadExportCsv();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast.error(`Export failed: ${errorMessage(err)}`);
    } finally {
      setExporting(false);
    }
  }

  function handleDeleted(id: string, name: string | null) {
    setCandidates((list) => list.filter((c) => c.id !== id));
    setPendingDelete(null);
    setOpenId((current) => (current === id ? null : current));
    toast.success(`Deleted ${name ?? "candidate"}`);
  }

  function handleCall(candidate: Candidate) {
    if (!canCall || callingCandidate) return;
    setCallingCandidate(candidate);
  }

  function handleCallSaved(updated: Candidate) {
    const before = candidates.find((c) => c.id === updated.id);
    setCandidates((list) => list.map((c) => (c.id === updated.id ? updated : c)));
    setPanelRefreshKey((k) => k + 1);
    const iv = updated.interview;
    if (iv && iv.source === "ai" && iv.id !== before?.interview?.id) {
      toast.success(`Interview scheduled automatically: ${updated.resumeData.name ?? "candidate"}, ${formatInterviewWhen(iv)}`);
    }
  }

  function handleCandidateUpdated(updated: Candidate) {
    setCandidates((list) => list.map((c) => (c.id === updated.id ? updated : c)));
  }

  const callDisabled = !canCall || callingCandidate !== null;
  const callDisabledReason = !canCall
    ? `Voice calling is disabled: set ${vapiMissingEnvVars.join(" and ")} in .env, or use Chrome/Edge for the free demo voice`
    : callingCandidate
      ? "A call is already in progress"
      : undefined;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <UserSearch className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-tight">HR Screening Agent</h1>
            <p className="text-xs text-slate-500">Share the candidate link, then review each candidate's AI screening call.</p>
          </div>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={candidates.length === 0 || exporting}
            title={candidates.length === 0 ? "Add a candidate to enable export" : "Download all candidates and calls as CSV"}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            Export CSV
          </button>
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => setTeamOpen(true)}
              title="Manage who can sign in"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              <Users className="h-4 w-4" aria-hidden />
              Team
            </button>
          )}
          {user && (
            <div className="flex items-center gap-2">
              <span className="hidden max-w-48 truncate text-xs text-slate-500 sm:inline" title={user.username}>
                {user.name ?? user.username}
                {user.role === "superadmin" ? " · Super admin" : ""}
              </span>
              <button
                type="button"
                onClick={() => void onSignOut()}
                title="Sign out"
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                <span className="sr-only sm:not-sr-only">Sign out</span>
              </button>
            </div>
          )}
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
        {!isVapiConfigured && isBrowserVoiceSupported && (
          <Banner tone="indigo">
            Demo mode: Vapi keys aren't set, so calls use your browser's free built-in voice and speech recognition (needs
            internet). The agent asks a fixed set of screening questions; the call is still saved and analysed by Gemini. Add{" "}
            {vapiMissingEnvVars.join(" and ")} to .env for the full conversational AI agent.
            <span className="mt-3 block">
              <VoicePicker />
            </span>
          </Banner>
        )}
        {!canCall && (
          <Banner tone="amber">
            Voice calling is disabled: {vapiMissingEnvVars.join(" and ")} {vapiMissingEnvVars.length > 1 ? "are" : "is"}{" "}
            missing in .env. Add {vapiMissingEnvVars.length > 1 ? "them" : "it"} and restart <code>npm run dev</code>.
          </Banner>
        )}

        {overdueTotal > 0 && (
          <Banner tone="red">
            {overdueTotal} {overdueTotal === 1 ? "interview is" : "interviews are"} overdue: the time has passed but{" "}
            {overdueTotal === 1 ? "it is" : "they are"} still marked as scheduled. Open the candidate to mark it completed, no-show, or
            reschedule.{" "}
            <button
              type="button"
              onClick={() => setStatusFilter("overdue")}
              className="font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              Show overdue
            </button>
          </Banner>
        )}
        {todayTotal > 0 && (
          <Banner tone="indigo">
            {todayTotal} {todayTotal === 1 ? "interview is" : "interviews are"} scheduled for today.{" "}
            <button
              type="button"
              onClick={() => setStatusFilter("interview")}
              className="font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Show interviews
            </button>
          </Banner>
        )}

        <CandidateLinkCard onCopied={() => toast.success("Candidate link copied. Send it on WhatsApp or email.")} />

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
              now={now}
              loading={loading}
              onOpen={(c) => setOpenId(c.id)}
              onCall={handleCall}
              onDelete={isSuperAdmin ? (c) => setPendingDelete(c) : undefined}
              callDisabled={callDisabled}
              callDisabledReason={callDisabledReason}
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
          canDelete={isSuperAdmin}
          onUpdated={handleCandidateUpdated}
          callDisabled={callDisabled}
          callDisabledReason={callDisabledReason}
        />
      )}

      {callingCandidate && (
        <CallModal
          candidate={callingCandidate}
          onClose={() => setCallingCandidate(null)}
          onSaved={handleCallSaved}
          onViewDetails={(id) => {
            setCallingCandidate(null);
            setOpenId(id);
          }}
        />
      )}

      <DeleteCandidateDialog
        candidate={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onDeleted={(c) => handleDeleted(c.id, c.resumeData.name)}
      />

      {teamOpen && <TeamPanel currentUsername={user?.username ?? null} onClose={() => setTeamOpen(false)} />}

    </div>
  );
}

/** The link HR sends to candidates: /apply, where they upload a resume and take the AI screening call themselves. */
function CandidateLinkCard({ onCopied }: { onCopied: () => void }) {
  const link = `${window.location.origin}/apply`;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Clipboard blocked (e.g. insecure context): select the text so it can be copied by hand.
      const input = document.getElementById("candidate-link") as HTMLInputElement | null;
      input?.select();
      return;
    }
    setCopied(true);
    onCopied();
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section aria-labelledby="candidate-link-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id="candidate-link-heading" className="text-sm font-semibold text-slate-700">
        Candidate link
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Send this link to candidates. They upload their resume and talk to the AI HR assistant; their card, transcript and analysis appear
        here automatically.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          id="candidate-link"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Candidate link"
          className="min-h-11 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
        />
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
          Preview
        </a>
      </div>
    </section>
  );
}

function Banner({
  tone,
  children,
  onRetry,
}: {
  tone: "amber" | "red" | "indigo";
  children: ReactNode;
  onRetry?: () => void;
}) {
  const cls =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : tone === "indigo"
        ? "border-indigo-200 bg-indigo-50 text-indigo-900"
        : "border-red-200 bg-red-50 text-red-900";
  return (
    <div role="alert" className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${cls}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
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
