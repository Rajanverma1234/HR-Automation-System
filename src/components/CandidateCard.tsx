import { Briefcase, Mail, MapPin, Phone, Target, Trash2 } from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { formatInterviewWhen, interviewState } from "../../shared/interview";
import type { Candidate } from "../../shared/types";
import { display, formatExperience, initials } from "../lib/format";
import InterviewBadge, { interviewStateStyle } from "./InterviewBadge";

type Props = {
  candidate: Candidate;
  /** Current time, for the interview's Today / Overdue state. */
  now: Date;
  onOpen: (candidate: Candidate) => void;
  onCall: (candidate: Candidate) => void;
  /** Omitted for recruiters: only a super admin can delete candidates. */
  onDelete?: (candidate: Candidate) => void;
  callDisabled?: boolean;
  callDisabledReason?: string;
};

const MAX_SKILLS = 5;

function roleLine(designation: string | null, company: string | null): string | null {
  if (designation && company) return `${designation} @ ${company}`;
  if (designation) return designation;
  if (company) return `@ ${company}`;
  return null;
}

const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

export default function CandidateCard({
  candidate,
  now,
  onOpen,
  onCall,
  onDelete,
  callDisabled = false,
  callDisabledReason,
}: Props) {
  const r = candidate.resumeData;
  const name = r.name ?? "Unnamed candidate";
  const role = roleLine(r.currentDesignation, r.currentCompany);
  const shownSkills = r.skills.slice(0, MAX_SKILLS);
  const extraSkills = r.skills.length - shownSkills.length;
  const callCount = candidate.calls.length;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(candidate);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${name}`}
      onClick={() => onOpen(candidate)}
      onKeyDown={onKeyDown}
      className="group flex cursor-pointer flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700"
          aria-hidden
        >
          {initials(r.name)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className={`truncate font-semibold ${r.name ? "text-slate-900" : "italic text-slate-500"}`}>{name}</h3>
          <p className="truncate text-sm text-slate-600">{role ?? display(null)}</p>
        </div>
        {candidate.status === "called" ? (
          <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
            Called{callCount > 1 ? ` ×${callCount}` : ""}
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
            New
          </span>
        )}
      </div>

      <p className="-mt-1 flex min-w-0 items-center gap-1.5 text-sm">
        <Target className="h-4 w-4 shrink-0 text-indigo-500" aria-hidden />
        <span className="text-slate-500">Applied for:</span>
        <span className={`truncate font-medium ${r.appliedRole ? "text-indigo-700" : "text-slate-400"}`}>
          {display(r.appliedRole)}
        </span>
      </p>

      {candidate.interview && (
        <div
          className={`-mt-1 flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ring-1 ${interviewStateStyle[interviewState(candidate.interview, now)]}`}
        >
          <span className="font-medium">Interview</span>
          <span className="min-w-0 flex-1 truncate">{formatInterviewWhen(candidate.interview)}</span>
          <InterviewBadge state={interviewState(candidate.interview, now)} />
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <Briefcase className="h-4 w-4 text-slate-400" aria-hidden />
          <span className="sr-only">Experience:</span>
          {formatExperience(r.totalExperienceYears)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="h-4 w-4 text-slate-400" aria-hidden />
          <span className="sr-only">Location:</span>
          {display(r.location)}
        </span>
      </div>

      {r.skills.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Top skills">
          {shownSkills.map((skill) => (
            <li key={skill} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              {skill}
            </li>
          ))}
          {extraSkills > 0 && (
            <li
              className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
              title={r.skills.slice(MAX_SKILLS).join(", ")}
            >
              +{extraSkills}
            </li>
          )}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">No skills listed</p>
      )}

      <div className="-my-2 flex flex-col text-sm">
        <ContactRow icon={<Phone className="h-4 w-4 text-slate-400" aria-hidden />} label="Phone">
          {r.phone ? (
            <a
              href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}
              onClick={stop}
              onKeyDown={stop}
              className="inline-flex min-h-11 min-w-0 items-center truncate rounded text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {r.phone}
            </a>
          ) : (
            <span className="text-slate-400">{display(null)}</span>
          )}
        </ContactRow>
        <ContactRow icon={<Mail className="h-4 w-4 text-slate-400" aria-hidden />} label="Email">
          {r.email ? (
            <a
              href={`mailto:${r.email}`}
              onClick={stop}
              onKeyDown={stop}
              className="inline-flex min-h-11 min-w-0 items-center rounded text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <span className="truncate">{r.email}</span>
            </a>
          ) : (
            <span className="text-slate-400">{display(null)}</span>
          )}
        </ContactRow>
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCall(candidate);
          }}
          onKeyDown={stop}
          disabled={callDisabled}
          title={callDisabled ? callDisabledReason : undefined}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Phone className="h-4 w-4" aria-hidden />
          Call
        </button>
        {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(candidate);
          }}
          onKeyDown={stop}
          aria-label="Delete candidate"
          title="Delete candidate"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
        )}
      </div>
    </div>
  );
}

function ContactRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {icon}
      <span className="sr-only">{label}:</span>
      {children}
    </div>
  );
}
