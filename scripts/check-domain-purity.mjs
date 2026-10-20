#!/usr/bin/env node
/**
 * Domain-logic purity gate.
 *
 * Pure functions in `packages/domain-logic/` MUST NOT:
 *   1. Import server modules (Prisma, Redis, BullMQ, Express, axios) or
 *      Node side-effect APIs (fs, net, http, https, child_process).
 *   2. Call time-of-day at call site (`Date.now()`, `new Date()`) — time
 *      must be passed as a parameter to keep functions deterministic.
 *   3. Call `Math.random()` — randomness must be passed in for
 *      reproducible tests.
 *   4. Reach ANY `node:` builtin from the root barrel (`src/index.ts`).
 *      The mobile app bundles that barrel, and React Native has no Node
 *      standard library. Server-only modules that need e.g. node:crypto
 *      live behind a package.json subpath export instead.
 *
 * The tsconfig `paths` block already redirects forbidden modules to
 * `src/_blocked.d.ts` (an empty stub), so any forbidden import fails
 * at typecheck with TS2305. This script is defense-in-depth: it
 * catches cases where someone deletes the path block or the stub, and
 * it catches `new Date()` / `Math.random()` which TypeScript cannot
 * forbid via paths.
 *
 * Comments are stripped before searching so doc-string mentions of
 * `Date.now()` do not trigger false positives.
 *
 * Exit code: 0 on success, 1 on violation.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TARGET = join(REPO_ROOT, "packages/domain-logic/src");

const FORBIDDEN_IMPORT_RE =
  /from\s+['"](@prisma\/|ioredis|bullmq|express|axios|node:(fs|net|http|https|child_process))/;

// Match only the zero-argument variants: those read system time / randomness.
// `new Date(isoString)` and `new Date(epochMs)` are pure parsing and allowed.
const FORBIDDEN_CALL_RE =
  /(\bDate\.now\s*\(\s*\))|(\bnew\s+Date\s*\(\s*\))|(\bMath\.random\s*\(\s*\))/;

const stripComments = (src) =>
  src
    // Replace block comments with whitespace (keep line numbers stable).
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    // Replace single-line comments to end-of-line.
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

const walk = async (dir) => {
  const entries = await readdir(dir);
  const files = [];
  for (const name of entries) {
    const p = join(dir, name);
    const s = await stat(p);
    if (s.isDirectory()) {
      files.push(...(await walk(p)));
    } else if (
      name.endsWith(".ts") &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".d.ts")
    ) {
      files.push(p);
    }
  }
  return files;
};

const violations = [];

const files = await walk(TARGET);
for (const file of files) {
  const raw = await readFile(file, "utf8");
  const stripped = stripComments(raw);
  const lines = stripped.split("\n");
  lines.forEach((line, i) => {
    if (FORBIDDEN_IMPORT_RE.test(line)) {
      violations.push({
        kind: "import",
        file: relative(REPO_ROOT, file),
        line: i + 1,
        snippet: line.trim(),
      });
    }
    if (FORBIDDEN_CALL_RE.test(line)) {
      violations.push({
        kind: "call",
        file: relative(REPO_ROOT, file),
        line: i + 1,
        snippet: line.trim(),
      });
    }
  });
}

// Rule 4: walk relative imports from the root barrel; anything reachable
// ships in the React Native bundle and must not touch a `node:` builtin.
const IMPORT_SPEC_RE = /(?:from|import)\s+['"]([^'"]+)['"]/g;
const resolveSource = async (fromFile, spec) => {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [base.replace(/\.js$/, ".ts"), `${base}.ts`, join(base, "index.ts")];
  for (const c of candidates) {
    const s = await stat(c).catch(() => null);
    if (s?.isFile()) return c;
  }
  return null;
};
const reachable = new Set();
const queue = [join(TARGET, "index.ts")];
while (queue.length > 0) {
  const file = queue.pop();
  if (reachable.has(file)) continue;
  reachable.add(file);
  const lines = stripComments(await readFile(file, "utf8")).split("\n");
  for (const [i, line] of lines.entries()) {
    for (const [, spec] of line.matchAll(IMPORT_SPEC_RE)) {
      if (spec.startsWith("node:")) {
        violations.push({
          kind: "barrel-node",
          file: relative(REPO_ROOT, file),
          line: i + 1,
          snippet: line.trim(),
        });
      } else if (spec.startsWith(".")) {
        const next = await resolveSource(file, spec);
        if (next) queue.push(next);
      }
    }
  }
}

if (violations.length > 0) {
  console.error("❌ Domain-logic purity violation(s):\n");
  const LABELS = {
    import: "forbidden import",
    call: "time/randomness at call site (pass as parameter instead)",
    "barrel-node":
      "node: builtin reachable from src/index.ts (breaks the mobile bundle — move behind a subpath export)",
  };
  for (const v of violations) {
    const label = LABELS[v.kind];
    console.error(`  ${v.file}:${v.line} — ${label}`);
    console.error(`    ${v.snippet}\n`);
  }
  process.exit(1);
}

console.log(`✅ domain-logic purity check passed (${files.length} files scanned)`);
