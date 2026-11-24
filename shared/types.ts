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

/** A concrete interview slot the candidate agreed to on the call, resolved against the call's date (office time zone). */
export type InterviewSlot = {
  /** Office-local calendar date, "YYYY-MM-DD". */
  date: string;
  /** Office-local time, "HH:MM" (24h). null when the candidate named only a day. */
  time: string | null;
  /** What the candidate said, e.g. "kal 3 baje" or "Thursday after 2 pm". */
  candidateStatement: string | null;
};

export type CallAnalysis = {
  currentCTC: string | null;
  expectedCTC: string | null;
  noticePeriod: string | null;
  reasonForChange: string | null;
  preferredLocation: string | null;
  interested: "yes" | "no" | "maybe";
  interviewAvailability: string | null;
  /** Set only when the candidate agreed to a specific interview day; the server then schedules it automatically. */
  interviewSlot: InterviewSlot | null;
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

/** Stored interview outcome. "Overdue" is not stored: it is derived from a "scheduled" interview whose time has passed. */
export type InterviewStatus = "scheduled" | "completed" | "no-show" | "cancelled";

export type Interview = {
  id: string;
  /** ISO instant of the interview. */
  scheduledAt: string;
  /** false when only a day was agreed; scheduledAt then uses the default time and the interview counts for the whole day. */
  timeSpecified: boolean;
  status: InterviewStatus;
  /** "ai": scheduled automatically from a call; "recruiter": set or changed by hand. */
  source: "ai" | "recruiter";
  /** CallRecord.id of the call that scheduled it (null when the recruiter set it). */
  callRecordId: string | null;
  candidateStatement: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Candidate = {
  id: string;
  createdAt: string;
  updatedAt: string;
  resumeFileName: string;
  resumeData: ResumeData;
  status: CandidateStatus;
  calls: CallRecord[];
  /** The current interview, or null if none is scheduled. */
  interview: Interview | null;
};

/** PATCH /api/candidates/:id/interview. Creating an interview requires scheduledAt. */
export type UpdateInterviewRequest = {
  scheduledAt?: string;
  timeSpecified?: boolean;
  status?: InterviewStatus;
  notes?: string | null;
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
