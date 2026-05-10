/**
 * Strips everything other than digits, leading `+`, `*`, and `#` from a
 * phone number before it's used in a `tel:` URI.
 *
 * Why: tel-URI handlers treat `,`, `;`, `p`, `w`, and other characters as
 * pause / 2nd-stage commands. A contact string sourced from sync, deep
 * link, or contact storage could embed those and redirect or extend the
 * dialled string. We only allow keypad characters.
 *
 * Returns an empty string when nothing usable remains, so callers can
 * cheaply guard with a length check before opening the URI.
 */
export const sanitizePhoneForTelUri = (raw: string | null | undefined): string => {
  if (!raw) return "";
  // Allow a single leading `+` then digits / *, # only.
  const trimmed = raw.trim();
  const hasPlusPrefix = trimmed.startsWith("+");
  const rest = trimmed.replace(/[^\d*#]/g, "");
  return hasPlusPrefix ? `+${rest}` : rest;
};
