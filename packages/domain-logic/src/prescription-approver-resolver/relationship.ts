import type { RelationshipFamily } from "./types.js";

/**
 * Folds free-text relationship labels typed by the patient at invite
 * time onto a {@link RelationshipFamily}. Patients type Hindi,
 * Hinglish, English, and honorifics — the lookup is case-insensitive,
 * whitespace-trimmed, and honorific-stripped. The matcher prefers
 * STRONGER families (child > spouse) when a label could land in
 * multiple buckets, but in practice the alias lists do not overlap.
 *
 * Aliases are deliberately concrete strings rather than fuzzy
 * regexes. Adding a label that real users type is one PR; resolving
 * a bug in a Levenshtein matcher is many.
 */

// Pre-compiled honorific strip patterns — built at module load from a
// fixed list, never derived from user input. The inline RegExp use
// keeps `eslint-plugin-security/detect-non-literal-regexp` happy.
const HONORIFIC_PATTERNS: readonly RegExp[] = [
  /(^|\s)ji(\s|$)/g,
  /(^|\s)saab(\s|$)/g,
  /(^|\s)sahib(\s|$)/g,
  /(^|\s)saheb(\s|$)/g,
  /(^|\s)sir(\s|$)/g,
  /(^|\s)madam(\s|$)/g,
];

/** Escapes a string for inclusion in a regex. */
const escapeForRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CHILD_ALIASES: readonly string[] = [
  // English
  "child",
  "son",
  "daughter",
  "kid",
  // Hindi / Hinglish (devanagari + roman)
  "beta",
  "beti",
  "bachcha",
  "bachhi",
  "bachhe",
  "ladka",
  "ladki",
  "बेटा",
  "बेटी",
];

const SPOUSE_ALIASES: readonly string[] = [
  "spouse",
  "husband",
  "wife",
  "partner",
  "pati",
  "patni",
  "biwi",
  "gharwala",
  "gharwali",
  "पति",
  "पत्नी",
];

const CAREGIVER_ALIASES: readonly string[] = [
  "caregiver",
  "carer",
  "nurse",
  "attendant",
  "helper",
  "aaya",
  "ayah",
  "support",
];

// Labels that should be considered family but NOT in the approver
// set (siblings, parents, friends — they may have alert visibility
// but cannot approve prescriptions on behalf of the patient).
const OTHER_FAMILY_ALIASES: readonly string[] = [
  "father",
  "mother",
  "papa",
  "mummy",
  "mom",
  "dad",
  "brother",
  "sister",
  "bhai",
  "behen",
  "friend",
  "neighbour",
  "neighbor",
  "dost",
  "uncle",
  "aunty",
  "aunt",
  "chacha",
  "mama",
  "mausi",
  "tau",
];

const normalize = (raw: string): string => {
  let s = raw.trim().toLowerCase();
  for (const pattern of HONORIFIC_PATTERNS) {
    s = s.replace(pattern, " ");
  }
  return s.replace(/\s+/g, " ").trim();
};

const hasAlias = (label: string, aliases: readonly string[]): boolean => {
  // The caller short-circuits on the empty-string case, so this guard
  // is structurally unreachable from `relationshipFamily`; it remains
  // as a defensive check for any future caller that may forget the
  // pre-filter. Excluded from coverage per spec rule "never test
  // defensive guards that real callers cannot trigger".
  /* c8 ignore next */
  if (label.length === 0) return false;
  for (const alias of aliases) {
    const a = alias.toLowerCase();
    if (label === a) return true;
    // Word-boundary match — "nurse aaya" matches "nurse" and "aaya".
    // Plain `includes` would match "father" against "godfather"; the
    // boundary check keeps the matcher conservative.
    // Aliases are a curated module-level constant, not user input;
    // they're still escaped defensively before going into the regex.
    // eslint-disable-next-line security/detect-non-literal-regexp
    const re = new RegExp(`(^|\\s)${escapeForRegex(a)}(\\s|$)`);
    if (re.test(label)) return true;
  }
  return false;
};

/**
 * Maps a free-text relationship label onto the canonical
 * {@link RelationshipFamily}. `null`, empty, and unrecognised labels
 * fold to `"unknown"`.
 *
 * Precedence when a label hits multiple aliases (rare; aliases are
 * curated to not overlap): child > spouse > caregiver > other.
 */
export const relationshipFamily = (label: string | null): RelationshipFamily => {
  if (label === null) return "unknown";
  const normalized = normalize(label);
  if (normalized.length === 0) return "unknown";

  if (hasAlias(normalized, CHILD_ALIASES)) return "child";
  if (hasAlias(normalized, SPOUSE_ALIASES)) return "spouse";
  if (hasAlias(normalized, CAREGIVER_ALIASES)) return "caregiver";
  if (hasAlias(normalized, OTHER_FAMILY_ALIASES)) return "other";
  return "unknown";
};
