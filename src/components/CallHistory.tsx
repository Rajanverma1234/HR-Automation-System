import { AlertTriangle, ChevronDown, MessageSquareText } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { CallAnalysis, CallRecord, Recommendation, ResumeDetailCheck } from "../../shared/types";
import { display, formatDateTime, formatDuration } from "../lib/format";

type Props = { calls: CallRecord[] };

const recommendationStyle: Record<Recommendation["decision"], string> = {
  shortlist: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  hold: "bg-amber-50 text-amber-800 ring-amber-200",
  reject: "bg-red-50 text-red-700 ring-red-200",
};

const interestedStyle: Record<CallAnalysis["interested"], string> = {
  yes: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  maybe: "bg-amber-50 text-amber-800 ring-amber-200",
  no: "bg-red-50 text-red-700 ring-red-200",
};

const checkStyle: Record<ResumeDetailCheck["status"], string> = {
  confirmed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  corrected: "bg-amber-50 text-amber-800 ring-amber-200",
  unclear: "bg-slate-100 text-slate-600 ring-slate-200",
};

function Badge({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ${className}`}>
      {children}
    </span>
  );
}

export default function CallHistory({ calls }: Props) {
  const ordered = calls
    .map((call, i) => ({ call, number: i + 1 }))
    .sort((a, b) => b.call.startedAt.localeCompare(a.call.startedAt));
  const newestId = ordered[0]?.call.id;

  return (
    <ol className="flex flex-col gap-3">
      {ordered.map(({ call, number }) => (
        <li key={call.id}>
          <CallCard call={call} number={number} defaultOpen={call.id === newestId} />
        </li>
      ))}
    </ol>
  );
}

function CallCard({ call, number, defaultOpen }: { call: CallRecord; number: number; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = `call-body-${call.id}`;
  const decision = call.analysis?.recommendation.decision;

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Call {number}</p>
          <p className="text-xs text-slate-500">
            {formatDateTime(call.startedAt)} · {formatDuration(call.durationSec)}
          </p>
        </div>
        {decision ? (
          <Badge className={recommendationStyle[decision]}>{decision}</Badge>
        ) : (
          <Badge className="bg-slate-100 text-slate-600 ring-slate-200">No analysis</Badge>
        )}
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div id={bodyId} className="flex flex-col gap-5 border-t border-slate-100 px-4 py-4">
          {call.analysis ? (
            <AnalysisView analysis={call.analysis} />
          ) : (
            <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                This call hasn't been analysed.
                {call.analysisError ? ` ${call.analysisError}` : ""}
              </p>
            </div>
          )}
          <Transcript call={call} />
        </div>
      )}
    </div>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</h4>;
}

function AnalysisView({ analysis: a }: { analysis: CallAnalysis }) {
  const rows: { label: string; value: ReactNode }[] = [
    { label: "Current CTC", value: display(a.currentCTC) },
    { label: "Expected CTC", value: display(a.expectedCTC) },
    { label: "Notice period", value: display(a.noticePeriod) },
    { label: "Reason for change", value: display(a.reasonForChange) },
    { label: "Preferred location", value: display(a.preferredLocation) },
    { label: "Interested", value: <Badge className={interestedStyle[a.interested]}>{a.interested}</Badge> },
    { label: "Interview availability", value: display(a.interviewAvailability) },
  ];

  return (
    <>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(0,10rem)_1fr]">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-slate-500">{row.label}</dt>
            <dd className="mb-1 text-slate-900 sm:mb-0">{row.value}</dd>
          </div>
        ))}
      </dl>

      <section>
        <SubHeading>Resume details check</SubHeading>
        {a.confirmedOrCorrectedResumeDetails.length === 0 ? (
          <p className="text-sm text-slate-500">No resume details were discussed.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Field</th>
                  <th scope="col" className="px-3 py-2 font-medium">Resume value</th>
                  <th scope="col" className="px-3 py-2 font-medium">Candidate said</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {a.confirmedOrCorrectedResumeDetails.map((d, i) => (
                  <tr key={`${d.field}-${i}`}>
                    <td className="px-3 py-2 font-medium text-slate-800">{d.field}</td>
                    <td className="px-3 py-2 text-slate-600">{display(d.resumeValue)}</td>
                    <td className="px-3 py-2 text-slate-600">{display(d.candidateStatement)}</td>
                    <td className="px-3 py-2">
                      <Badge className={checkStyle[d.status]}>{d.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <SubHeading>Key notes</SubHeading>
        {a.keyNotes.length === 0 ? (
          <p className="text-sm text-slate-500">{display(null)}</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {a.keyNotes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SubHeading>Call summary</SubHeading>
        <p className="text-sm text-slate-700">{display(a.callSummary)}</p>
      </section>

      <section>
        <SubHeading>Recommendation</SubHeading>
        <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-start">
          <Badge className={recommendationStyle[a.recommendation.decision]}>{a.recommendation.decision}</Badge>
          <p className="text-slate-700">{display(a.recommendation.reason)}</p>
        </div>
      </section>
    </>
  );
}

function Transcript({ call }: { call: CallRecord }) {
  const [show, setShow] = useState(false);
  const id = `transcript-${call.id}`;

  return (
    <section>
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-expanded={show}
        aria-controls={id}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <MessageSquareText className="h-4 w-4" aria-hidden />
        {show ? "Hide transcript" : "Show transcript"} ({call.transcript.length} lines)
      </button>
      {show && (
        <div id={id} className="mt-2 flex flex-col gap-2 rounded-lg bg-slate-50 p-3">
          {call.transcript.length === 0 ? (
            <p className="text-sm text-slate-500">No transcript was captured.</p>
          ) : (
            call.transcript.map((line, i) => {
              const agent = line.role === "assistant";
              return (
                <div key={i} className={`flex flex-col ${agent ? "items-start" : "items-end"}`}>
                  <span className="mb-0.5 px-1 text-[11px] font-medium text-slate-500">{agent ? "Agent" : "Candidate"}</span>
                  <p
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                      agent ? "rounded-tl-sm bg-white text-slate-800 ring-1 ring-slate-200" : "rounded-tr-sm bg-indigo-600 text-white"
                    }`}
                  >
                    {line.text}
                  </p>
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
