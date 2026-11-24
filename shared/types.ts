export type Education = {
  degree: string | null;
  institution: string | null;
  year: string | null;
};

export type PreviousCompany = {
  company: string;
  designation: string | null;
  duration: string | null;
};

export type ResumeData = {
  name: string | null;
  /** The position the resume says the candidate is applying for, e.g. "SEO Executive". null when not stated. */
  appliedRole: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  currentCompany: string | null;
  currentDesignation: string | null;
  totalExperienceYears: number | null;
  skills: string[];
  education: Education[];
  previousCompanies: PreviousCompany[];
  summary: string | null;
};

export type TranscriptLine = {
  role: "assistant" | "user";
  text: string;
  at: string;
};

export type ResumeDetailCheck = {
  field: string;
  resumeValue: string | null;
  candidateStatement: string | null;
  status: "confirmed" | "corrected" | "unclear";
};

export type Recommendation = {
  decision: "shortlist" | "hold" | "reject";
  reason: string;
};

export type CallAnalysis = {
  currentCTC: string | null;
  expectedCTC: string | null;
  noticePeriod: string | null;
  reasonForChange: string | null;
  preferredLocation: string | null;
  interested: "yes" | "no" | "maybe";
  interviewAvailability: string | null;
  confirmedOrCorrectedResumeDetails: ResumeDetailCheck[];
  keyNotes: string[];
  callSummary: string;
  recommendation: Recommendation;
};

export type CallRecord = {
  id: string;
  callId: string | null;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  transcript: TranscriptLine[];
  analysis: CallAnalysis | null;
  analysisError: string | null;
  createdAt: string;
};

export type CandidateStatus = "new" | "called";

export type Candidate = {
  id: string;
  createdAt: string;
  updatedAt: string;
  resumeFileName: string;
  resumeData: ResumeData;
  status: CandidateStatus;
  calls: CallRecord[];
};

export type SaveCallRequest = {
  callId: string | null;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  transcript: TranscriptLine[];
};

export type ApiErrorBody = {
  error: string;
  code?: string;
};

/** Lifecycle of a server-placed phone screening call. */
export type PhoneCallStatus = "dialing" | "in-progress" | "analysing" | "done" | "error";

/** A phone call the server placed through Vapi and is tracking until it is saved. Kept in server memory only. */
export type PhoneCallJob = {
  id: string;
  candidateId: string;
  /** Vapi's call id, once Vapi has accepted the call. */
  vapiCallId: string | null;
  /** The E.164 number that was dialled. */
  phoneNumber: string;
  status: PhoneCallStatus;
  /** Vapi's ended reason, e.g. "customer-ended-call" or "customer-did-not-answer". */
  endedReason: string | null;
  error: string | null;
  /** The saved call, once status is "done". */
  call: CallRecord | null;
  createdAt: string;
  updatedAt: string;
};

export type PhoneCallConfig = {
  configured: boolean;
  /** Server env vars that must be set before phone calls can be placed. */
  missingEnvVars: string[];
};
