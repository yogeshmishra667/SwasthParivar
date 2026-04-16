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
`packages/domain-logic/` must NEVER import the following. Run:
```
grep -rE "from ['\"]@prisma/|from ['\"]ioredis|from ['\"]bullmq|from ['\"]express|from ['\"]node:fs" packages/domain-logic/src/
```
Any hit → FAIL. Pure functions only.

Also verify no `Date.now()` or `new Date()` calls inside exported domain functions:
```
grep -rnE "Date\.now\(\)|new Date\(\)" packages/domain-logic/src/
```
Time must be passed as a parameter. Any hit → FAIL.

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
