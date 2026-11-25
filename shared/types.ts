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

/**
 * "superadmin": the owner accounts from the HR_USERS env var. They can also manage the team
 * (add / remove recruiters, reset their passwords) and delete candidates.
 * "recruiter": accounts a super admin adds on the Team page (stored with the candidates).
 */
export type HrRole = "superadmin" | "recruiter";

/** The signed-in HR user, as the browser sees it. */
export type HrSessionUser = { username: string; name: string | null; role: HrRole };

/** GET /api/auth/session and POST /api/auth/login. */
export type AuthSession = {
  /** false only in local development with HR_USERS unset. */
  authRequired: boolean;
  /** false when the server is deployed without a valid HR_USERS / AUTH_SECRET. */
  configured: boolean;
  user: HrSessionUser | null;
};

/** A stored recruiter account (never sent to the browser: it holds the password hash). */
export type StoredHrUser = {
  id: string;
  username: string;
  name: string | null;
  role: "recruiter";
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
  /** Username of the super admin who added the account. */
  createdBy: string | null;
};

/** GET /api/hr-users: everyone who can sign in. Owner accounts come from HR_USERS and can't be edited here. */
export type HrUserSummary = {
  id: string;
  username: string;
  name: string | null;
  role: HrRole;
  source: "env" | "stored";
  createdAt: string | null;
  createdBy: string | null;
};

export type CreateHrUserRequest = { username: string; name: string | null; password: string };
export type UpdateHrUserRequest = { name?: string | null; password?: string };
