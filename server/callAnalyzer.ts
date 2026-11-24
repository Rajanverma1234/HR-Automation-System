import { Type, type Schema } from "@google/genai";
import type { CallAnalysis, Candidate, ResumeDetailCheck, TranscriptLine } from "../shared/types.js";
import { generateJson } from "./gemini.js";
import { cleanEnum, cleanString, cleanStringArray, isRecord, asArray } from "./normalize.js";

const nullableString: Schema = { type: Type.STRING, nullable: true };

const INTERESTED = ["yes", "no", "maybe"] as const;
const DECISIONS = ["shortlist", "hold", "reject"] as const;
const CHECK_STATUSES = ["confirmed", "corrected", "unclear"] as const;

const ANALYSIS_KEYS = [
  "currentCTC",
  "expectedCTC",
  "noticePeriod",
  "reasonForChange",
  "preferredLocation",
  "interested",
  "interviewAvailability",
  "confirmedOrCorrectedResumeDetails",
  "keyNotes",
  "callSummary",
  "recommendation",
];

export const callAnalysisSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    currentCTC: nullableString,
    expectedCTC: nullableString,
    noticePeriod: nullableString,
    reasonForChange: nullableString,
    preferredLocation: nullableString,
    interested: { type: Type.STRING, format: "enum", enum: [...INTERESTED] },
    interviewAvailability: nullableString,
    confirmedOrCorrectedResumeDetails: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          field: { type: Type.STRING },
          resumeValue: nullableString,
          candidateStatement: nullableString,
          status: { type: Type.STRING, format: "enum", enum: [...CHECK_STATUSES] },
        },
        required: ["field", "resumeValue", "candidateStatement", "status"],
        propertyOrdering: ["field", "resumeValue", "candidateStatement", "status"],
      },
    },
    keyNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
    callSummary: { type: Type.STRING },
    recommendation: {
      type: Type.OBJECT,
      properties: {
        decision: { type: Type.STRING, format: "enum", enum: [...DECISIONS] },
        reason: { type: Type.STRING },
      },
      required: ["decision", "reason"],
      propertyOrdering: ["decision", "reason"],
    },
  },
  required: ANALYSIS_KEYS,
  propertyOrdering: ANALYSIS_KEYS,
};

const systemInstruction = `You analyse an HR screening call transcript. Extract ONLY what the candidate actually said. If something was not discussed, return null. Never invent or assume values.

You are given the candidate's resume details (JSON extracted from their CV) and the call transcript. Lines starting "Agent:" are the AI screening agent; lines starting "Candidate:" are the candidate.

Language:
- The transcript may be in English, Hindi (Devanagari or romanised) or Hinglish. Write all output values in English.
- Keep amounts and units exactly as stated, for example "18 LPA" or "₹22 lakh per annum". Do not convert currencies or units, and do not turn a range into a single number.

Field rules:
- currentCTC, expectedCTC: the candidate's current and expected annual compensation as they stated it. null if not stated.
- noticePeriod: as stated, including any negotiability (e.g. "60 days, negotiable to 30"). null if not stated.
- reasonForChange: the candidate's stated reason for looking for a new role, briefly. null if not stated.
- preferredLocation: the work location(s) the candidate said they prefer, including remote/hybrid preferences. null if not stated.
- interested: "yes" or "no" only if the candidate clearly expressed it; "maybe" if unclear or not asked.
- interviewAvailability: when the candidate said they are available for an interview. null if not stated.
- confirmedOrCorrectedResumeDetails: one entry per resume detail the agent asked the candidate to confirm. "field" is a short human-readable label (e.g. "Current designation", "Total experience"). "resumeValue" is the value from the resume JSON as a string (null if the resume has no value). "candidateStatement" is what the candidate said, briefly (null if they did not answer). "status" is "confirmed" if the candidate agreed, "corrected" if they gave a different value, "unclear" if the answer was ambiguous or missing. Return [] if no resume details were checked.
- keyNotes: 3-6 short points a recruiter should know, based only on the call. Fewer is fine if the call was very short.
- callSummary: 3-5 neutral sentences summarising the call.
- recommendation.decision and recommendation.reason: base the decision on the candidate's interest, notice period, how well their expectations fit, and clarity of communication. Give a one- or two-sentence reason. If the call was too short to judge, use decision "hold" with reason "Insufficient information from the call".`;

function formatTranscript(transcript: TranscriptLine[]): string {
  return transcript.map((line) => `${line.role === "assistant" ? "Agent" : "Candidate"}: ${line.text}`).join("\n");
}

export async function analyseCall(candidate: Candidate, transcript: TranscriptLine[]): Promise<CallAnalysis> {
  const prompt = [
    "Analyse this screening call according to your rules.",
    "",
    "RESUME DETAILS (JSON):",
    JSON.stringify(candidate.resumeData, null, 2),
    "",
    "CALL TRANSCRIPT:",
    formatTranscript(transcript),
  ].join("\n");

  const raw = await generateJson<unknown>({
    parts: [{ text: prompt }],
    schema: callAnalysisSchema,
    systemInstruction,
  });
  return normalizeCallAnalysis(raw);
}

export function normalizeCallAnalysis(raw: unknown): CallAnalysis {
  const r = isRecord(raw) ? raw : {};
  const rec = isRecord(r.recommendation) ? r.recommendation : {};

  const details: ResumeDetailCheck[] = [];
  for (const d of asArray(r.confirmedOrCorrectedResumeDetails).filter(isRecord)) {
    const field = cleanString(d.field);
    if (field === null) continue;
    details.push({
      field,
      resumeValue: cleanString(d.resumeValue),
      candidateStatement: cleanString(d.candidateStatement),
      status: cleanEnum(d.status, CHECK_STATUSES, "unclear"),
    });
  }

  const decision = cleanEnum(rec.decision, DECISIONS, "hold");

  return {
    currentCTC: cleanString(r.currentCTC),
    expectedCTC: cleanString(r.expectedCTC),
    noticePeriod: cleanString(r.noticePeriod),
    reasonForChange: cleanString(r.reasonForChange),
    preferredLocation: cleanString(r.preferredLocation),
    interested: cleanEnum(r.interested, INTERESTED, "maybe"),
    interviewAvailability: cleanString(r.interviewAvailability),
    confirmedOrCorrectedResumeDetails: details,
    keyNotes: cleanStringArray(r.keyNotes),
    // Required strings in the type: fall back to explicit "no data" wording rather than inventing content.
    callSummary: cleanString(r.callSummary) ?? "No summary was produced for this call.",
    recommendation: {
      decision,
      reason: cleanString(rec.reason) ?? "Insufficient information from the call",
    },
  };
}
