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
/**
 * Coerces user-typed phone strings to the E.164 format the server
 * expects (`+91XXXXXXXXXX`). Returns `null` when nothing usable
 * remains — caller renders a friendly "phone number check karein"
 * error rather than crashing.
 *
 * Accepts (all → `+919876543210`):
 *   - `9876543210`
 *   - `09876543210`
 *   - `91 98765 43210`
 *   - `+91-9876543210`
 */
export const normalizeIndianPhone = (raw: string): string | null => {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  // Strip leading 0 / 91 prefix; final number must be 10 digits.
  const cleaned =
    digits.startsWith("91") && digits.length === 12
      ? digits.slice(2)
      : digits.startsWith("0") && digits.length === 11
        ? digits.slice(1)
        : digits;
  if (cleaned.length !== 10) return null;
  if (!/^[6-9]/.test(cleaned)) return null; // valid Indian mobile prefix
  return `+91${cleaned}`;
};

export const sanitizePhoneForTelUri = (raw: string | null | undefined): string => {
  if (!raw) return "";
  // Allow a single leading `+` then digits / *, # only.
  const trimmed = raw.trim();
  const hasPlusPrefix = trimmed.startsWith("+");
  const rest = trimmed.replace(/[^\d*#]/g, "");
  return hasPlusPrefix ? `+${rest}` : rest;
};
