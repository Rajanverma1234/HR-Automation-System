import { CalendarPlus, Check, Loader2, Pencil, RotateCcw, Sparkles, Trash2, UserX, X } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { formatInterviewWhen, interviewState, officeDate, officeTime, slotToIso } from "../../shared/interview";
import type { Candidate, InterviewStatus, UpdateInterviewRequest } from "../../shared/types";
import { deleteInterview, errorMessage, updateInterview } from "../api";
import { useNow } from "../hooks/useNow";
import { formatDateTime } from "../lib/format";
import InterviewBadge from "./InterviewBadge";
import { useToast } from "./Toast";

type Props = {
  candidate: Candidate;
  onUpdated: (candidate: Candidate) => void;
};

const STATUS_DONE_MESSAGE: Record<InterviewStatus, string> = {
  scheduled: "Interview marked as scheduled",
  completed: "Interview marked as completed",
  "no-show": "Interview marked as no-show",
  cancelled: "Interview cancelled",
};

export default function InterviewSection({ candidate, onUpdated }: Props) {
  const toast = useToast();
  const now = useNow();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const interview = candidate.interview;

  async function run(key: string, action: () => Promise<Candidate>, success: string) {
    setBusy(key);
    try {
      onUpdated(await action());
      toast.success(success);
      setEditing(false);
    } catch (err) {
      toast.error(`Couldn't update the interview: ${errorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  }

  const setStatus = (status: InterviewStatus) =>
    void run(status, () => updateInterview(candidate.id, { status }), STATUS_DONE_MESSAGE[status]);

  if (editing || !interview) {
    if (!editing) {
      return (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-slate-500">
            No interview scheduled. When the candidate agrees to a day on a call, the AI schedules it here automatically.
          </p>
          <ActionButton onClick={() => setEditing(true)} icon={<CalendarPlus className="h-4 w-4" />} tone="indigo">
            Schedule manually
          </ActionButton>
        </div>
      );
    }
    return (
      <ScheduleForm
        initialDate={interview ? officeDate(new Date(interview.scheduledAt)) : officeDate(new Date(now.getTime() + 86_400_000))}
        initialTime={interview?.timeSpecified ? officeTime(new Date(interview.scheduledAt)) : ""}
        saving={busy === "save"}
        onCancel={() => setEditing(false)}
        onSave={(payload) =>
          void run(
            "save",
            () => updateInterview(candidate.id, payload),
            interview ? "Interview rescheduled" : "Interview scheduled",
          )
        }
      />
    );
  }

  const state = interviewState(interview, now);
  const scheduledByCall = interview.callRecordId ? candidate.calls.find((c) => c.id === interview.callRecordId) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-base font-semibold text-slate-900">{formatInterviewWhen(interview)}</p>
        <InterviewBadge state={state} />
      </div>

      <p className="flex items-start gap-1.5 text-xs text-slate-500">
        {interview.source === "ai" ? (
          <>
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" aria-hidden />
            <span>
              Scheduled automatically by the AI from the call
              {scheduledByCall ? ` on ${formatDateTime(scheduledByCall.startedAt)}` : ""}.
            </span>
          </>
        ) : (
          <span>Last updated by the recruiter on {formatDateTime(interview.updatedAt)}.</span>
        )}
      </p>
      {interview.candidateStatement && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm italic text-slate-700">Candidate said: “{interview.candidateStatement}”</p>
      )}

      {state === "overdue" && (
        <p role="status" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          The interview time has passed and it's still marked as scheduled. Did it happen? Mark it completed or no-show, or reschedule it.
        </p>
      )}
      {state === "today" && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This interview is today.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {interview.status !== "completed" && (
          <ActionButton onClick={() => setStatus("completed")} busy={busy === "completed"} icon={<Check className="h-4 w-4" />} tone="emerald">
            Mark completed
          </ActionButton>
        )}
        {interview.status === "scheduled" && (
          <ActionButton onClick={() => setStatus("no-show")} busy={busy === "no-show"} icon={<UserX className="h-4 w-4" />}>
            No-show
          </ActionButton>
        )}
        {interview.status !== "scheduled" && (
          <ActionButton onClick={() => setStatus("scheduled")} busy={busy === "scheduled"} icon={<RotateCcw className="h-4 w-4" />}>
            Mark as due again
          </ActionButton>
        )}
        <ActionButton onClick={() => setEditing(true)} icon={<Pencil className="h-4 w-4" />}>
          Reschedule
        </ActionButton>
        {interview.status === "scheduled" && (
          <ActionButton onClick={() => setStatus("cancelled")} busy={busy === "cancelled"} icon={<X className="h-4 w-4" />}>
            Cancel
          </ActionButton>
        )}
        <ActionButton
          onClick={() => void run("delete", () => deleteInterview(candidate.id), "Interview removed")}
          busy={busy === "delete"}
          icon={<Trash2 className="h-4 w-4" />}
          tone="red"
        >
          Remove
        </ActionButton>
      </div>
    </div>
  );
}

function ScheduleForm({
  initialDate,
  initialTime,
  saving,
  onSave,
  onCancel,
}: {
  initialDate: string;
  initialTime: string;
  saving: boolean;
  onSave: (payload: UpdateInterviewRequest) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!date) return;
    onSave({ scheduledAt: slotToIso(date, time || null), timeSpecified: time !== "", status: "scheduled" });
  }

  const input =
    "min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40";

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          Date
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          Time (IST, optional)
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={input} />
        </label>
      </div>
      <p className="text-xs text-slate-500">Leave the time empty if only the day is fixed. The interview then counts as overdue after that day ends.</p>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !date}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const TONES = {
  neutral: "border-slate-300 text-slate-700 hover:bg-slate-50",
  emerald: "border-emerald-300 text-emerald-700 hover:bg-emerald-50",
  indigo: "border-indigo-300 text-indigo-700 hover:bg-indigo-50",
  red: "border-red-200 text-red-600 hover:bg-red-50",
} as const;

function ActionButton({
  onClick,
  icon,
  children,
  busy = false,
  tone = "neutral",
}: {
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
  busy?: boolean;
  tone?: keyof typeof TONES;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border bg-white px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 ${TONES[tone]}`}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <span aria-hidden>{icon}</span>}
      {children}
    </button>
  );
}
