#!/usr/bin/env node
/**
 * Mobile i18n parity gate.
 *
 * The app is Hindi-first and every string ships in every supported
 * locale. For each namespace under `apps/mobile/src/i18n/` (`en.json` /
 * `hi.json` at the root, `<ns>.en.json` / `<ns>.hi.json` in sub-folders)
 * every locale MUST:
 *   1. Have exactly the same keys as English — a missing key renders the
 *      raw key (or the English fallback) to a Hindi-speaking patient.
 *   2. Use the same `{{placeholders}}` per key — a Hindi string that drops
 *      `{{value}}` shows the sentence without the patient's reading.
 *   3. Not be blank where English has text (an untranslated string).
 *      English may be blank on purpose (e.g. `profile.suffix`: Hindi
 *      appends "ji", English appends nothing).
 *
 * Exit code: 0 on success, 1 on violation.
 */
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const I18N_DIR = join(REPO_ROOT, "apps/mobile/src/i18n");
const BASE_LOCALE = "en";

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(p)));
    else if (e.name.endsWith(".json")) files.push(p);
  }
  return files;
};

// Nested JSON → Map("a.b.c" → leaf value).
const flatten = (obj, prefix = "", out = new Map()) => {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, `${prefix}${k}.`, out);
    else out.set(`${prefix}${k}`, v);
  }
  return out;
};

const placeholders = (value) =>
  typeof value === "string"
    ? [...value.matchAll(/\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g)]
        .map((m) => m[1])
        .sort()
        .join(", ")
    : "";

// namespace dir+name → locale → Map
const groups = new Map();
for (const file of await walk(I18N_DIR)) {
  const m = basename(file).match(/^(?:(.+)\.)?([a-z]{2})\.json$/);
  if (!m) continue;
  const ns = relative(REPO_ROOT, join(dirname(file), m[1] ?? "(root)"));
  const locale = m[2];
  const parsed = JSON.parse(await readFile(file, "utf8"));
  if (!groups.has(ns)) groups.set(ns, new Map());
  groups.get(ns).set(locale, flatten(parsed));
}

const violations = [];
let keyCount = 0;
for (const [ns, locales] of groups) {
  const base = locales.get(BASE_LOCALE);
  if (!base) {
    violations.push(`${ns}: no ${BASE_LOCALE} file`);
    continue;
  }
  keyCount += base.size;
  for (const [locale, entries] of locales) {
    if (locale === BASE_LOCALE) continue;
    for (const [key, baseValue] of base) {
      if (!entries.has(key)) {
        violations.push(`${ns} [${locale}] missing key: ${key}`);
        continue;
      }
      const value = entries.get(key);
      if (placeholders(value) !== placeholders(baseValue)) {
        violations.push(
          `${ns} [${locale}] ${key}: placeholders {${placeholders(value)}} ≠ ${BASE_LOCALE} {${placeholders(baseValue)}}`,
        );
      }
      const baseBlank = typeof baseValue !== "string" || baseValue.trim() === "";
      const blank = typeof value !== "string" || value.trim() === "";
      if (blank && !baseBlank) violations.push(`${ns} [${locale}] ${key}: blank (untranslated)`);
    }
    for (const key of entries.keys()) {
      if (!base.has(key))
        violations.push(`${ns} [${locale}] extra key not in ${BASE_LOCALE}: ${key}`);
    }
  }
}

if (violations.length > 0) {
  console.error(`❌ i18n parity violation(s):\n`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log(`✅ i18n parity check passed (${groups.size} namespaces, ${keyCount} keys per locale)`);
