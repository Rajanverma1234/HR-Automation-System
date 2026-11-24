import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CandidateStatus } from "../../shared/types";

/** Candidate status, plus interview views: "interview" = scheduled and still due (upcoming or today), "overdue". */
export type StatusFilter = "all" | CandidateStatus | "interview" | "overdue";

type Props = {
  onQueryChange: (query: string) => void;
  status: StatusFilter;
  onStatusChange: (status: StatusFilter) => void;
  counts: Record<StatusFilter, number>;
  shown: number;
  total: number;
};

const DEBOUNCE_MS = 200;

const SEGMENTS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "called", label: "Called" },
  { value: "interview", label: "Interview due" },
  { value: "overdue", label: "Overdue" },
];

export default function Toolbar({ onQueryChange, status, onStatusChange, counts, shown, total }: Props) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const onQueryChangeRef = useRef(onQueryChange);
  onQueryChangeRef.current = onQueryChange;

  useEffect(() => {
    const timer = setTimeout(() => onQueryChangeRef.current(input), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  function clear() {
    setInput("");
    onQueryChangeRef.current("");
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && input) {
              e.preventDefault();
              clear();
            }
          }}
          placeholder="Search name, email, phone, company, skills…"
          aria-label="Search candidates"
          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-11 text-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 [&::-webkit-search-cancel-button]:hidden"
        />
        {input && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="radiogroup" aria-label="Filter by status" className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
          {SEGMENTS.map((seg) => {
            const active = status === seg.value;
            const alert = seg.value === "overdue" && counts.overdue > 0;
            return (
              <button
                key={seg.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onStatusChange(seg.value)}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  active ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {seg.label}
                <span
                  className={`rounded-full px-1.5 text-xs ${active ? "bg-white/20 text-white" : alert ? "bg-red-600 text-white" : "bg-slate-100 text-slate-500"}`}
                >
                  {counts[seg.value]}
                </span>
              </button>
            );
          })}
        </div>
        <p className="whitespace-nowrap text-sm text-slate-500" aria-live="polite">
          Showing {shown} of {total}
        </p>
      </div>
    </div>
  );
}
