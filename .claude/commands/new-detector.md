---
description: Scaffold a pure-function insight detector in packages/domain-logic with its test file.
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

Scaffold a new insight detector as a **pure function**. Arguments: `$ARGUMENTS` (detector name, kebab-case).

## Phase gate

Spike/trend detectors: Phase 2. Correlation/cross-condition: Phase 3. Anomaly: Phase 3+. Refuse out-of-phase.

## Files to create

### `packages/domain-logic/src/detectors/<name>.ts`

Shape:

```ts
import type { GlucoseReading, DetectorResult } from '../types';

export interface <Name>DetectorInput {
  readings: readonly GlucoseReading[];
  now: Date;  // time MUST be a parameter
  userStageDays: number;
}

export function detect<Name>(input: <Name>DetectorInput): DetectorResult | null {
  // 1. Minimum data guard (CLAUDE.md minimums):
  //    spike: 7d | trend: 5 points + R² > 0.5 | meal: 5 instances
  //    cross-condition: 30d | anomaly: 21d
  if (/* not enough data */) return null;

  // 2. Same reading type only. Filter: readings.filter(r => r.reading_type === targetType)
  //    Never compare fasting to post_meal.

  // 3. Compute. Pure math only.

  // 4. Confidence < 0.70 → return null (CLAUDE.md: "Confidence < 70% → stored only")

  // 5. Return DetectorResult with severity, messageKey, evidence, trigger_readings.
  return { /* ... */ };
}
```

### `packages/domain-logic/tests/detectors/<name>.test.ts`

- Cases: insufficient data → null; threshold edge; mixed reading types ignored; confidence floor; deterministic.
- One property test: same input → same output.

## Purity enforcement (fail if violated)

The detector file MUST NOT import any of:

- `@prisma/client`, `@prisma/*`
- `ioredis`
- `bullmq`
- `express`
- `node:fs`, `node:net`, `node:http`

The detector file MUST NOT call:

- `Date.now()`
- `new Date()` (time must come from `input.now`)
- `Math.random()` (deterministic only)

Run a grep after writing to confirm:

```
grep -nE "Date\.now|new Date\(\)|Math\.random|@prisma|ioredis|bullmq" packages/domain-logic/src/detectors/<name>.ts
```

Zero hits expected.

After scaffolding, run `pnpm --filter domain-logic test <name>` and report.
