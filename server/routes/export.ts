import { Router, type Request, type Response } from "express";
import type { CallRecord, Candidate } from "../../shared/types.js";
import { toCsv, type CsvValue } from "../csv.js";
import { candidateRepository } from "../repository.js";

const HEADERS = [
  "candidateId",
  "name",
  "email",
  "phone",
  "location",
  "currentCompany",
  "currentDesignation",
  "totalExperienceYears",
  "skills",
  "education",
  "previousCompanies",
  "resumeSummary",
  "status",
  "candidateCreatedAt",
  "callNumber",
  "callId",
  "callStartedAt",
  "callDurationSec",
  "currentCTC",
  "expectedCTC",
  "noticePeriod",
  "reasonForChange",
  "preferredLocation",
  "interested",
  "interviewAvailability",
  "resumeDetailChecks",
  "keyNotes",
  "callSummary",
  "recommendation",
  "recommendationReason",
  "analysisError",
  "transcript",
] as const;

function joinParts(parts: (string | null)[], sep: string): string {
  return parts.filter((p): p is string => p !== null && p !== "").join(sep);
}

function candidateColumns(c: Candidate): CsvValue[] {
  const r = c.resumeData;
  return [
    c.id,
    r.name,
    r.email,
    r.phone,
    r.location,
    r.currentCompany,
    r.currentDesignation,
    r.totalExperienceYears,
    r.skills.join("; "),
    r.education
      .map((e) => {
        const head = joinParts([e.degree, e.institution], " – ");
        return e.year ? `${head} (${e.year})`.trim() : head;
      })
      .join("; "),
    r.previousCompanies
      .map((p) => {
        const head = p.designation ? `${p.designation} @ ${p.company}` : p.company;
        return p.duration ? `${head} (${p.duration})` : head;
      })
      .join("; "),
    r.summary,
    c.status,
    c.createdAt,
  ];
}

function callColumns(call: CallRecord, callNumber: number): CsvValue[] {
  const a = call.analysis;
  return [
    callNumber,
    call.callId,
    call.startedAt,
    call.durationSec,
    a?.currentCTC,
    a?.expectedCTC,
    a?.noticePeriod,
    a?.reasonForChange,
    a?.preferredLocation,
    a?.interested,
    a?.interviewAvailability,
    a?.confirmedOrCorrectedResumeDetails
      .map((d) => `${d.field}: ${d.status}${d.candidateStatement ? ` → ${d.candidateStatement}` : ""}`)
      .join("; "),
    a?.keyNotes.join(" | "),
    a?.callSummary,
    a?.recommendation.decision,
    a?.recommendation.reason,
    call.analysisError,
    call.transcript.map((l) => `${l.role === "assistant" ? "Agent" : "Candidate"}: ${l.text}`).join("\n"),
  ];
}

const EMPTY_CALL_COLUMNS: CsvValue[] = new Array(HEADERS.length - 14).fill(null);

function buildExportRows(candidates: Candidate[]): CsvValue[][] {
  const rows: CsvValue[][] = [];
  for (const c of candidates) {
    const base = candidateColumns(c);
    if (c.calls.length === 0) {
      rows.push([...base, ...EMPTY_CALL_COLUMNS]);
      continue;
    }
    // Call numbers follow chronological order, matching the UI ("Call 1" is the first call).
    const ordered = [...c.calls].sort((x, y) => x.startedAt.localeCompare(y.startedAt));
    ordered.forEach((call, i) => rows.push([...base, ...callColumns(call, i + 1)]));
  }
  return rows;
}

export const exportRouter = Router();

exportRouter.get("/export.csv", async (_req: Request, res: Response) => {
  const candidates = await candidateRepository.list();
  const csv = toCsv(HEADERS, buildExportRows(candidates));
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="candidates-${date}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(csv);
});
