import { canonicaliseMedicineName } from "../medicine-aliases/index.js";

/**
 * Levenshtein distance between two strings — the standard edit-distance
 * algorithm. Used as the fallback when neither name resolves to a
 * canonical alias. O(n×m) time, O(min(n, m)) space.
 *
 * Pure, deterministic. The caller is responsible for normalising case
 * + whitespace before invoking.
 */
export const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Keep `a` as the shorter string so the buffer is min(n, m).
  if (a.length > b.length) {
    const tmp = a;
    a = b;
    b = tmp;
  }

  const prev = new Array<number>(a.length + 1);
  const curr = new Array<number>(a.length + 1);
  for (let i = 0; i <= a.length; i += 1) prev[i] = i;

  for (let j = 1; j <= b.length; j += 1) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        curr[i - 1]! + 1, // insertion
        prev[i]! + 1, // deletion
        prev[i - 1]! + cost, // substitution
      );
    }
    for (let i = 0; i <= a.length; i += 1) prev[i] = curr[i]!;
  }
  return prev[a.length]!;
};

const normalize = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Score the similarity between two free-text medicine names on a
 * `[0, 1]` scale where 1.0 is "definitely the same drug" and 0.0 is
 * "definitely different". Lookup precedence:
 *
 *   1. Both names resolve to the SAME canonical alias-group key → 1.0.
 *      The alias table is curated, so an exact key hit on both sides
 *      is the strongest possible signal.
 *
 *   2. Both names resolve to DIFFERENT canonical alias-group keys →
 *      0.05. The alias table says these are different drugs (e.g.
 *      "Glycomet" vs "Telma") — a near-zero score short-circuits the
 *      fuzzy fallback so a coincidental letter-overlap can't sneak
 *      back to "match" band.
 *
 *   3. Exactly one name resolves to a canonical key → fall through to
 *      Levenshtein. Common for OCR garbage on the bottle side.
 *
 *   4. Neither resolves → fall through to Levenshtein on the
 *      normalised strings. `1 - distance / max(len_a, len_b)`,
 *      clamped to `[0, 1]`.
 *
 * Pure and deterministic.
 */
export const nameSimilarity = (a: string, b: string): number => {
  const na = normalize(a);
  const nb = normalize(b);
  if (na.length === 0 || nb.length === 0) return 0;
  if (na === nb) return 1;

  const keyA = canonicaliseMedicineName(na);
  const keyB = canonicaliseMedicineName(nb);

  if (keyA !== null && keyB !== null) {
    return keyA === keyB ? 1 : 0.05;
  }

  // Levenshtein fallback — one or both names are unknown to the
  // alias table. Common for OCR noise like "Glycornet 500" missing
  // an alias entry but still ~85% similar to "glycomet" via edit
  // distance.
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return Math.max(0, 1 - dist / maxLen);
};
