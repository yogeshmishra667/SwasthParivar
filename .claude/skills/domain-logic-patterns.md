---
name: domain-logic-patterns
description: Purity constraints for packages/domain-logic — pure functions only, no DB/Redis/BullMQ/Express imports, time-as-parameter, deterministic, property-testable. Load when writing or reviewing voice-parser, streak-engine, feedback-engine, notification-resolver, or detectors.
---

# Domain Logic Patterns (Pure Functions)

`packages/domain-logic/` contains the project's pure business logic. The purity constraint is architectural — enforced in `tsconfig`, `build-validator`, and code review.

## Hard rule: no imports from these

```
@prisma/client, @prisma/*
ioredis
bullmq
express
node:fs, node:net, node:http, node:https, node:child_process
axios, fetch (implicit — don't ambient-import)
```

The package's `tsconfig.json` blocks these paths:

```json
{
  "compilerOptions": {
    "paths": {
      "@prisma/*": [],
      "ioredis": [],
      "bullmq": [],
      "express": []
    }
  }
}
```

The `/verify` command greps `packages/domain-logic/src/` for these imports. Any hit fails CI.

## Time is a parameter

Never call `Date.now()` or `new Date()` inside an exported function. Time is state — passing it in keeps the function deterministic and testable.

```ts
// ❌
export function computeStreak(reading: Reading) {
  const now = new Date(); // non-deterministic — can't test reliably
  // ...
}

// ✅
export function computeStreak(reading: Reading, now: Date, tz: string) {
  // deterministic: same inputs → same outputs
}
```

Callers (services, jobs) inject `new Date()` at the boundary.

## Deterministic — no randomness

No `Math.random()`. No non-deterministic iteration. If variant selection is needed (feedback messages, notification variants), accept a seed or the pre-selected index as a parameter.

```ts
// ❌
const variant = variants[Math.floor(Math.random() * variants.length)];

// ✅
export function computeFeedback(
  input,
  history,
  opts: { recentVariantIndices: readonly number[] },
): FeedbackResult {
  const availableVariants = allVariants.filter((_, i) => !opts.recentVariantIndices.includes(i));
  // caller picks via seeded RNG or mod-arithmetic
}
```

## Return types

### Detectors

```ts
export interface DetectorResult {
  pattern_type: string;
  conditions_involved: readonly string[];
  severity_score: number; // 0-100
  severity_level: "info" | "warn" | "critical";
  message_key: string;
  message_params: Record<string, unknown>;
  trigger_readings: readonly string[]; // reading ids
  evidence: Record<string, unknown>;
  confidence: number; // 0-1; < 0.70 → caller stores only
}

export function detectSpike(input: SpikeDetectorInput): DetectorResult | null;
```

Return `null` when insufficient data or confidence too low. Never throw for "not enough data" — that's an expected state.

### Parsers (voice parser, etc.)

Typed discriminated unions:

```ts
export type VoiceParseResult = {
  value: number;
  type: GlucoseType;
  requiresTypeConfirmation?: boolean;
  requiresStrongConfirmation?: boolean;
  requiresDoubleConfirmation?: boolean;
  uncertaintyDetected?: boolean;
  multipleValues?: readonly RankedValue[];
} | null; // null = could not extract a reading
```

## Minimum data guards (first line of any detector)

From CLAUDE.md Insight Engine:

- Spike: 7d of data
- Trend: 5 points + R² > 0.5
- Meal correlation: 5 instances per category
- Cross-condition: 30d
- Anomaly: 21d (median + IQR, not mean + σ)

```ts
export function detectSpike(input: SpikeInput): DetectorResult | null {
  if (input.readings.length === 0) return null;
  const oldestMeasured = input.readings.at(-1)!.measured_at;
  const daysOfData = daysBetween(oldestMeasured, input.now);
  if (daysOfData < 7) return null; // minimum data guard
  // ...
}
```

## Same reading type only

Spike/trend/median comparisons always filter to a single `reading_type`. Never mix `fasting` with `post_meal`. This is a medical-correctness rule, not a style choice.

```ts
const fasting = input.readings.filter((r) => r.reading_type === "fasting");
```

## Property-testable invariants

Use `fast-check` to state invariants instead of enumerating cases.

```ts
test("parsed glucose value is always within medical range (20–600) or null", () => {
  fc.assert(
    fc.property(fc.string(), fc.float({ min: 0, max: 1 }), fc.date(), (transcript, conf, time) => {
      const r = parseVoiceTranscript(transcript, conf, time);
      return r === null || (r.value >= 20 && r.value <= 600);
    }),
  );
});
```

Property tests shine for: voice parser, streak engine (day boundary, grace), anti-cheat flags, feedback tone delta bands.

## Test location

```
packages/domain-logic/tests/<module>.test.ts            ← cases
packages/domain-logic/tests/<module>.property.test.ts   ← fast-check invariants
```

Factories live in `packages/test-factories/src/` so server integration tests can reuse them.

## Coverage bar

100% lines + branches for `packages/domain-logic/**`. No exceptions. Enforced in `vitest.config.ts` thresholds.

## What the domain layer MUST NOT do

- Read from or write to a database
- Enqueue BullMQ jobs
- Send HTTP requests
- Log via Winston (return structured results; caller logs)
- Read config / env vars (accept as parameters)
- Touch the filesystem
- Call `Date.now()` / `new Date()` / `Math.random()`
- Depend on Express `Request`/`Response` types

The domain layer describes _what_ to decide, not _how_ to execute. The service layer executes.
