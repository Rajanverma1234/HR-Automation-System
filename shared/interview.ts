// Interview date helpers shared by the server (scheduling, CSV), the browser (dashboard) and the agent prompt.
// All calendar dates are in the office time zone, so "tomorrow" means tomorrow in Gurgaon, whatever the server's TZ.
import { DEFAULT_INTERVIEW_TIME, OFFICE_TIME_ZONE, OFFICE_UTC_OFFSET } from "./company.js";
import type { Interview } from "./types.js";

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A scheduled interview counts as overdue this long after its start time (when a time was agreed). */
export const OVERDUE_GRACE_MS = 60 * 60 * 1000;

export function isValidYmd(value: string): boolean {
  const m = YMD_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isValidHm(value: string): boolean {
  return HM_RE.test(value);
}

/** The office-local calendar date of an instant, "YYYY-MM-DD". */
export function officeDate(at: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: OFFICE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** The office-local time of an instant, "HH:MM" (24h). */
export function officeTime(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: OFFICE_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hh}:${mm}`;
}

export function addDays(ymd: string, days: number): string {
  const m = YMD_RE.exec(ymd);
  if (!m) throw new Error(`Invalid date: ${ymd}`);
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return dt.toISOString().slice(0, 10);
}

export function weekdayOf(ymd: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
}

/** e.g. "Wednesday, 25 November 2026". */
export function spokenDate(ymd: string): string {
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${ymd}T00:00:00Z`),
  );
}

/**
 * A two-week calendar starting on the reference day, one line per day, with relative names in English and Hindi.
 * Given to the LLMs so they map "tomorrow", "parso", "next Monday" to real dates instead of computing weekdays themselves.
 */
export function calendarLines(reference: Date, days = 14): string[] {
  const today = officeDate(reference);
  const lines: string[] = [];
  for (let i = 0; i < days; i++) {
    const ymd = addDays(today, i);
    const tag = i === 0 ? " (today / aaj)" : i === 1 ? " (tomorrow / kal)" : i === 2 ? " (day after tomorrow / parso)" : "";
    lines.push(`${ymd} ${weekdayOf(ymd)}${tag}`);
  }
  return lines;
}

/** Office-local date + optional time → ISO instant (UTC). */
export function slotToIso(date: string, time: string | null): string {
  return new Date(`${date}T${time ?? DEFAULT_INTERVIEW_TIME}:00${OFFICE_UTC_OFFSET}`).toISOString();
}

/** The instant the office-local day of `iso` ends. */
function endOfOfficeDay(iso: string): number {
  const next = addDays(officeDate(new Date(iso)), 1);
  return new Date(`${next}T00:00:00${OFFICE_UTC_OFFSET}`).getTime();
}

/** What the dashboard shows: the stored status, with "scheduled" split into upcoming / today / overdue by the clock. */
export type InterviewState = "upcoming" | "today" | "overdue" | "completed" | "no-show" | "cancelled";

export function interviewState(interview: Pick<Interview, "scheduledAt" | "timeSpecified" | "status">, now: Date): InterviewState {
  if (interview.status !== "scheduled") return interview.status;
  const start = new Date(interview.scheduledAt).getTime();
  const overdueAt = interview.timeSpecified ? start + OVERDUE_GRACE_MS : endOfOfficeDay(interview.scheduledAt);
  if (now.getTime() >= overdueAt) return "overdue";
  return officeDate(new Date(interview.scheduledAt)) === officeDate(now) ? "today" : "upcoming";
}

export const INTERVIEW_STATE_LABEL: Record<InterviewState, string> = {
  upcoming: "Scheduled",
  today: "Today",
  overdue: "Overdue",
  completed: "Completed",
  "no-show": "No-show",
  cancelled: "Cancelled",
};

/** e.g. "Wed, 25 Nov 2026, 3:00 pm IST", or "Wed, 25 Nov 2026 (time not fixed)". */
export function formatInterviewWhen(interview: Pick<Interview, "scheduledAt" | "timeSpecified">): string {
  const at = new Date(interview.scheduledAt);
  const day = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: OFFICE_TIME_ZONE }).format(at);
  if (!interview.timeSpecified) return `${day} (time not fixed)`;
  const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: OFFICE_TIME_ZONE }).format(at);
  return `${day}, ${time} IST`;
}
