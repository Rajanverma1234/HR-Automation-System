export type CsvValue = string | number | boolean | null | undefined;

const BOM = "﻿";
const CRLF = "\r\n";
/** Phone-number-like values (e.g. "+91 98765 43210", "-5") are allowed to start with + or -. */
const SAFE_SIGNED = /^[+-][\d\s()-]+$/;

/** Neutralises spreadsheet formula injection (CSV injection) by prefixing a single quote. */
function guardFormula(value: string): string {
  if (value === "") return value;
  const first = value[0];
  if (first === "=" || first === "@" || first === "\t" || first === "\r") return `'${value}`;
  if ((first === "+" || first === "-") && !SAFE_SIGNED.test(value)) return `'${value}`;
  return value;
}

/** RFC 4180: quote fields containing a comma, quote or newline; double inner quotes. */
function escapeField(raw: CsvValue): string {
  if (raw === null || raw === undefined) return "";
  const value = guardFormula(String(raw));
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Builds a CSV document with a UTF-8 BOM (so Excel reads Hindi text and ₹ correctly) and CRLF line endings. */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeField).join(","));
  return BOM + lines.join(CRLF) + CRLF;
}
