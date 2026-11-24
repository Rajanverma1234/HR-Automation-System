import { AlertTriangle, Briefcase, Building2, GraduationCap, Loader2, Mail, MapPin, Phone, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Candidate } from "../../shared/types";
import { errorMessage, getCandidate } from "../api";
import { display, formatExperience, initials } from "../lib/format";
import { lockBodyScroll } from "../lib/scrollLock";
import CallHistory from "./CallHistory";
import DeleteCandidateDialog from "./DeleteCandidateDialog";
import InterviewSection from "./InterviewSection";

type Props = {
  candidateId: string;
  onClose: () => void;
  onCall: (candidate: Candidate) => void;
  onDeleted: (id: string) => void;
  /** The candidate changed in the panel (e.g. the interview was edited). */
  onUpdated: (candidate: Candidate) => void;
  /** Change this number to force a refetch (e.g. after a call is saved). */
  refreshKey: number;
  callDisabled?: boolean;
  callDisabledReason?: string;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; candidate: Candidate };

export default function CandidateDetailPanel({
  candidateId,
  onClose,
  onCall,
  onDeleted,
  onUpdated,
  refreshKey,
  callDisabled = false,
  callDisabledReason,
}: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadTick, setReloadTick] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<Candidate | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Fetch fresh data on open, when the id changes, and whenever refreshKey changes.
  useEffect(() => {
    const controller = new AbortController();
    setState((s) => (s.kind === "ready" && s.candidate.id === candidateId ? s : { kind: "loading" }));
    getCandidate(candidateId)
      .then((candidate) => {
        if (!controller.signal.aborted) setState({ kind: "ready", candidate });
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setState({ kind: "error", message: errorMessage(err) });
      });
    return () => controller.abort();
  }, [candidateId, refreshKey, reloadTick]);

  // Esc to close, body scroll lock, initial focus, focus restore.
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlockScroll = lockBodyScroll();
    closeRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unlockScroll();
      previouslyFocused?.focus();
    };
  }, []);

  const retry = useCallback(() => setReloadTick((t) => t + 1), []);

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-slate-900/40 animate-fade-in" aria-hidden onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="candidate-panel-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col bg-slate-50 shadow-2xl animate-slide-in sm:max-w-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
          <p id="candidate-panel-title" className="text-sm font-medium text-slate-500">
            Candidate details
          </p>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close candidate details"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {state.kind === "loading" && (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-600" aria-hidden />
              Loading candidate…
            </div>
          )}
          {state.kind === "error" && (
            <div className="m-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p className="flex-1">Couldn't load this candidate: {state.message}</p>
              <button
                type="button"
                onClick={retry}
                className="-my-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 font-medium hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
                Retry
              </button>
            </div>
          )}
          {state.kind === "ready" && (
            <PanelBody
              candidate={state.candidate}
              onCall={onCall}
              onDelete={() => setConfirmDelete(state.candidate)}
              callDisabled={callDisabled}
              callDisabledReason={callDisabledReason}
              onUpdated={(candidate) => {
                setState({ kind: "ready", candidate });
                onUpdated(candidate);
              }}
            />
          )}
        </div>
      </aside>

      <DeleteCandidateDialog
        candidate={confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        onDeleted={(c) => {
          setConfirmDelete(null);
          onDeleted(c.id);
        }}
      />
    </div>
  );
}

function PanelBody({
  candidate,
  onCall,
  onDelete,
  callDisabled,
  callDisabledReason,
  onUpdated,
}: {
  candidate: Candidate;
  onCall: (candidate: Candidate) => void;
  onDelete: () => void;
  onUpdated: (candidate: Candidate) => void;
  callDisabled: boolean;
  callDisabledReason: string | undefined;
}) {
  const r = candidate.resumeData;
  const role =
    r.currentDesignation && r.currentCompany
      ? `${r.currentDesignation} @ ${r.currentCompany}`
      : (r.currentDesignation ?? (r.currentCompany ? `@ ${r.currentCompany}` : null));
  const callCount = candidate.calls.length;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo-100 font-semibold text-indigo-700" aria-hidden>
            {initials(r.name)}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className={`text-lg font-semibold ${r.name ? "text-slate-900" : "italic text-slate-500"}`}>
              {r.name ?? "Unnamed candidate"}
            </h2>
            <p className="text-sm text-slate-600">{display(role)}</p>
            <p className="mt-1 text-sm">
              <span className="text-slate-500">Applied for: </span>
              <span className={r.appliedRole ? "font-medium text-indigo-700" : "text-slate-400"}>{display(r.appliedRole)}</span>
            </p>
            <p className="mt-0.5 text-xs text-slate-400">From {candidate.resumeFileName}</p>
          </div>
          {candidate.status === "called" ? (
            <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
              Called{callCount > 1 ? ` ×${callCount}` : ""}
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200">New</span>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => onCall(candidate)}
            disabled={callDisabled}
            title={callDisabled ? callDisabledReason : undefined}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Phone className="h-4 w-4" aria-hidden />
            Call
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 text-sm font-medium text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Delete
          </button>
        </div>
      </section>

      <Section title="Interview">
        <InterviewSection candidate={candidate} onUpdated={onUpdated} />
      </Section>

      <Section title="Contact">
        <dl className="flex flex-col gap-2 text-sm">
          <IconRow icon={<Phone className="h-4 w-4" />} label="Phone">
            {r.phone ? (
              <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} className="-my-3 inline-flex min-h-11 items-center rounded text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                {r.phone}
              </a>
            ) : (
              display(null)
            )}
          </IconRow>
          <IconRow icon={<Mail className="h-4 w-4" />} label="Email">
            {r.email ? (
              <a href={`mailto:${r.email}`} className="-my-3 inline-flex min-h-11 items-center break-all rounded text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                {r.email}
              </a>
            ) : (
              display(null)
            )}
          </IconRow>
        </dl>
      </Section>

      <Section title="Overview">
        <dl className="flex flex-col gap-2 text-sm">
          <IconRow icon={<Briefcase className="h-4 w-4" />} label="Experience">
            {formatExperience(r.totalExperienceYears)}
          </IconRow>
          <IconRow icon={<MapPin className="h-4 w-4" />} label="Location">
            {display(r.location)}
          </IconRow>
          <IconRow icon={<Building2 className="h-4 w-4" />} label="Current company">
            {display(r.currentCompany)}
          </IconRow>
        </dl>
      </Section>

      <Section title="Summary">
        <p className="text-sm text-slate-700">{display(r.summary)}</p>
      </Section>

      <Section title={`Skills${r.skills.length ? ` (${r.skills.length})` : ""}`}>
        {r.skills.length === 0 ? (
          <p className="text-sm text-slate-500">{display(null)}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {r.skills.map((skill) => (
              <li key={skill} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                {skill}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Work history">
        {r.previousCompanies.length === 0 ? (
          <p className="text-sm text-slate-500">{display(null)}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {r.previousCompanies.map((c, i) => (
              <li key={`${c.company}-${i}`} className="flex gap-3 text-sm">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <div>
                  <p className="font-medium text-slate-900">{c.company}</p>
                  <p className="text-slate-600">{display(c.designation)}</p>
                  <p className="text-xs text-slate-500">{display(c.duration)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Education">
        {r.education.length === 0 ? (
          <p className="text-sm text-slate-500">{display(null)}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {r.education.map((e, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <div>
                  <p className="font-medium text-slate-900">{display(e.degree)}</p>
                  <p className="text-slate-600">{display(e.institution)}</p>
                  <p className="text-xs text-slate-500">{display(e.year)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Calls${callCount ? ` (${callCount})` : ""}`}>
        {callCount === 0 ? <p className="text-sm text-slate-500">No calls yet</p> : <CallHistory calls={candidate.calls} />}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>
      {children}
    </section>
  );
}

function IconRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-slate-400" aria-hidden>
        {icon}
      </span>
      <dt className="w-24 shrink-0 text-slate-500 sm:w-32">{label}</dt>
      <dd className="min-w-0 flex-1 text-slate-900">{children}</dd>
    </div>
  );
}
