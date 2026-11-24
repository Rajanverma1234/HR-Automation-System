export const EMPTY = "—";

export function display(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : EMPTY;
  const trimmed = value.trim();
  return trimmed === "" ? EMPTY : trimmed;
}

export function formatExperience(years: number | null | undefined): string {
  if (years === null || years === undefined || !Number.isFinite(years)) return EMPTY;
  const rounded = Math.round(years * 10) / 10;
  return `${rounded} ${rounded === 1 ? "yr" : "yrs"}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) return "00:00";
  const total = Math.round(sec);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}
