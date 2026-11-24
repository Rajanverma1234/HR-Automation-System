/** Placeholder values a model sometimes emits instead of null. Compared case-insensitively. */
const EMPTY_MARKERS = new Set(["", "n/a", "na", "null", "none", "not mentioned", "not discussed"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Trims a string; returns null for non-strings and placeholder values. Finite numbers are stringified. */
export function cleanString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return EMPTY_MARKERS.has(trimmed.toLowerCase()) ? null : trimmed;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Cleans every item, drops nulls. */
export function cleanStringArray(value: unknown): string[] {
  return asArray(value)
    .map(cleanString)
    .filter((s): s is string => s !== null);
}

export function cleanEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value !== "string") return fallback;
  const v = value.trim().toLowerCase();
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
