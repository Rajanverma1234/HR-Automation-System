import { AlertTriangle, CalendarCheck, CalendarClock, CalendarX, CheckCircle2, UserX } from "lucide-react";
import type { ReactNode } from "react";
import { INTERVIEW_STATE_LABEL, type InterviewState } from "../../shared/interview";

export const interviewStateStyle: Record<InterviewState, string> = {
  upcoming: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  today: "bg-amber-50 text-amber-800 ring-amber-300",
  overdue: "bg-red-50 text-red-700 ring-red-300",
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "no-show": "bg-slate-100 text-slate-700 ring-slate-300",
  cancelled: "bg-slate-100 text-slate-500 ring-slate-200",
};

const ICON: Record<InterviewState, ReactNode> = {
  upcoming: <CalendarClock className="h-3.5 w-3.5" aria-hidden />,
  today: <CalendarCheck className="h-3.5 w-3.5" aria-hidden />,
  overdue: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />,
  completed: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />,
  "no-show": <UserX className="h-3.5 w-3.5" aria-hidden />,
  cancelled: <CalendarX className="h-3.5 w-3.5" aria-hidden />,
};

export default function InterviewBadge({ state }: { state: InterviewState }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${interviewStateStyle[state]}`}>
      {ICON[state]}
      {INTERVIEW_STATE_LABEL[state]}
    </span>
  );
}
