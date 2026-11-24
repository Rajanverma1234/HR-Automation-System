import { Users } from "lucide-react";
import type { Candidate } from "../../shared/types";
import CandidateCard from "./CandidateCard";

type Props = {
  candidates: Candidate[];
  now: Date;
  loading: boolean;
  onOpen: (candidate: Candidate) => void;
  onCall: (candidate: Candidate) => void;
  onDelete: (candidate: Candidate) => void;
  callDisabled?: boolean;
  callDisabledReason?: string;
};

const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3";

export default function CandidateGrid({
  candidates,
  now,
  loading,
  onOpen,
  onCall,
  onDelete,
  callDisabled,
  callDisabledReason,
}: Props) {
  if (loading) {
    return (
      <div className={GRID} aria-busy="true" aria-label="Loading candidates">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
        <Users className="h-10 w-10 text-slate-300" aria-hidden />
        <p className="text-sm text-slate-600">No candidates yet — upload a resume to get started.</p>
      </div>
    );
  }

  return (
    <div className={GRID}>
      {candidates.map((c) => (
        <CandidateCard
          key={c.id}
          candidate={c}
          now={now}
          onOpen={onOpen}
          onCall={onCall}
          onDelete={onDelete}
          callDisabled={callDisabled}
          callDisabledReason={callDisabledReason}
        />
      ))}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="flex animate-pulse flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-hidden>
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-full bg-slate-200" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/3 rounded bg-slate-200" />
          <div className="h-3 w-1/2 rounded bg-slate-100" />
        </div>
      </div>
      <div className="h-3 w-1/2 rounded bg-slate-100" />
      <div className="flex gap-1.5">
        <div className="h-5 w-14 rounded bg-slate-100" />
        <div className="h-5 w-16 rounded bg-slate-100" />
        <div className="h-5 w-12 rounded bg-slate-100" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-2/5 rounded bg-slate-100" />
        <div className="h-3 w-3/5 rounded bg-slate-100" />
      </div>
      <div className="h-11 rounded-lg bg-slate-200" />
    </div>
  );
}
