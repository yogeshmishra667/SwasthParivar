---
description: Full quality gate — typecheck, lint, domain-logic purity, tests, build. Zero tolerance for failures.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Agent
---

Run the full SwasthParivar verification pipeline. Delegate to the `build-validator` agent for execution, or run inline if the agent is unavailable.

## Pipeline — run in order, stop on first failure

### 1. TypeScript strict

```
pnpm -r typecheck
```

No `any`, no `@ts-ignore`, no `@ts-expect-error` without a linked issue comment.

### 2. ESLint

```
pnpm -r lint
```

Zero warnings. Treat warnings as errors.

### 3. Domain-logic purity check

Defense in depth — tsconfig `paths` redirects every forbidden module to `src/_blocked.d.ts` (a stub with no exports), so any forbidden import fails at typecheck (TS2305). The script below is the secondary gate; both must be clean.

```
node scripts/check-domain-purity.mjs
```

The script (a) rejects imports of `@prisma/*`, `ioredis`, `bullmq`, `express`, `axios`, `node:fs|net|http|https|child_process`, and (b) rejects zero-argument `Date.now()`, `new Date()`, and `Math.random()` calls — these must be passed in as parameters. Comments are stripped before searching so docstring references are not false-flagged.

Any hit → FAIL. Pure functions only.

### 4. Tests

```
pnpm -r test -- --run
pnpm -r test -- --coverage
```

Enforce coverage thresholds from `vitest.config.ts`:

- `packages/domain-logic/**`: 100% lines + branches
- `critical-bypass*`: 100% branches
- Global: 80% lines

### 5. Build

```
pnpm -r build
```

All workspace packages must build.

## Reporting

On success: print a single green line `✅ /verify passed (typecheck, lint, purity, tests, build)`.

On failure: print the failed step, the first 40 lines of output, and stop. Do not attempt to auto-fix.

## Session flag

Remember in this conversation that `/verify` passed. `/ship` will check this flag.
