/**
 * Normalises a phone number from a resume to E.164 (e.g. "+918299269534"), defaulting to India.
 *
 * Accepts "+91-8299269534", "+91 82992 69534", "08299269534", "918299269534", "8299269534",
 * "0091 8299269534" and other international numbers written with "+" or "00". When the resume lists
 * several numbers ("98xxxxxxxx / 99xxxxxxxx"), the first one is used. Returns null when no valid
 * number can be read.
 */
export function toE164(raw: string | null): string | null {
  if (raw === null) return null;
  const first = raw.split(/[/,;|]|\bor\b/i)[0]?.trim() ?? "";
  if (first === "") return null;

  const hasPlus = first.startsWith("+");
  let digits = first.replace(/\D/g, "");
  let international = hasPlus;
  if (!hasPlus && digits.startsWith("00")) {
    digits = digits.slice(2);
    international = true;
  }

  if (international) {
    if (digits.startsWith("91")) return indianMobile(digits.slice(2));
    // E.164: country code + subscriber number, 8 to 15 digits, no leading zero.
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  }

  if (digits.length === 10) return indianMobile(digits);
  if (digits.length === 11 && digits.startsWith("0")) return indianMobile(digits.slice(1));
  if (digits.length === 12 && digits.startsWith("91")) return indianMobile(digits.slice(2));
  return null;
}

/** Indian mobile numbers are 10 digits starting with 6, 7, 8 or 9. */
function indianMobile(national: string): string | null {
  return /^[6-9]\d{9}$/.test(national) ? `+91${national}` : null;
}
