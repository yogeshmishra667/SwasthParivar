/**
 * Indian medicine brand alias table — checked-in JSON, accessed as
 * structured data by the paired-reconciliation matcher. Centralised
 * here so the alias list is updatable via a single PR without touching
 * matcher code.
 *
 * The matcher is conservative: an alias hit is a strong "these two
 * names refer to the same drug" signal; a miss falls through to
 * Levenshtein distance. New aliases NEVER make a wrong match RIGHT,
 * they only let more right matches through.
 */
import brandsData from "./indian-brands.json" with { type: "json" };

interface AliasGroup {
  /** Canonical lowercase key — what the matcher returns as the unified identity. */
  readonly key: string;
  /** Aliases (case-insensitive, whitespace-normalised). The key itself is implicitly included. */
  readonly aliases: readonly string[];
}

const normalize = (raw: string): string => raw.trim().toLowerCase().replace(/\s+/g, " ");

const ALIAS_GROUPS: readonly AliasGroup[] = (() => {
  const groups: AliasGroup[] = [];
  for (const [key, aliases] of Object.entries(brandsData)) {
    if (key.startsWith("_")) continue; // skip _meta and friends
    if (!Array.isArray(aliases)) continue;
    groups.push({
      key,
      aliases: aliases.map((a) => normalize(String(a))),
    });
  }
  return groups;
})();

/**
 * Resolves a free-text medicine name to its canonical alias-group key,
 * or `null` if the name does not match any known alias. The match is
 * conservative — must be an exact (case-insensitive, whitespace-
 * normalised) hit on the key or one of its aliases. Fuzzy matching is
 * out of scope here; callers fall through to Levenshtein on `null`.
 */
export const canonicaliseMedicineName = (raw: string): string | null => {
  const n = normalize(raw);
  if (n.length === 0) return null;
  for (const group of ALIAS_GROUPS) {
    if (group.key === n) return group.key;
    if (group.aliases.includes(n)) return group.key;
  }
  return null;
};

/**
 * Internal helper exported for tests — DO NOT use in production code,
 * use `canonicaliseMedicineName` instead.
 */
export const __ALIAS_GROUPS_FOR_TESTS = ALIAS_GROUPS;
