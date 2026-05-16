---
description: Plan a SwasthParivar feature with strict build-phase enforcement before any code is written.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Agent
  - Write
  - Edit
---

You are planning a feature for SwasthParivar. Follow these steps in order — do not skip.

## Step 1 — Build Phase Gate (MANDATORY)

Read `CLAUDE.md` → "STRICT BUILD PHASES — ENFORCE THIS" section.

Determine which phase the user's request belongs to:

- Phase 1 (Weeks 1-4): GLUCOSE ONLY. User, GlucoseReading, MedicationSchedule, MedicationLog, UserStreak, FeedbackEvent, NotificationState. Voice logging, critical bypass, profile switcher.
- Phase 2 (Weeks 5-8): BP, meals, insights (spike/trend), HbA1c, health score, guardian read-only.
- Phase 3 (Weeks 9-12): AI chat, correlation/cross-condition detectors, basic guardian alerts, SOS.
- Phase 4+: Cardiac, respiratory, prescriptions/OCR, appointments, activity, sleep, regional languages.

**If the request is out-of-phase, STOP.** Tell the user:

- Which phase their request belongs to
- What Phase 1 success metric must be met first ("Papa logs 2+ readings/day for 14 consecutive days")
- Offer to plan a Phase-1-compatible alternative if one exists

Do not proceed to Step 2 until phase is confirmed.

## Step 2 — Explore

Use the `Explore` subagent (thoroughness "medium") to map:

- Existing modules under `apps/server/src/modules/` that this feature touches
- Pure functions in `packages/domain-logic/src/` that can be reused
- Tables in the Prisma schema that already exist vs. need to be added
- PostHog events already wired vs. new ones needed

If the repo is empty (no `apps/` yet), skip exploration and note that this is greenfield work.

## Step 3 — Produce Structured Plan

Write a plan with these sections:

1. **Phase justification** — why this belongs in the current phase
2. **Database changes** — tables added/modified, new indexes, TimescaleDB hypertables
3. **Endpoints** — method + path + request/response shape + error codes
4. **BullMQ jobs** — new jobs, their schedule/trigger, retry policy
5. **Pure domain logic** — functions to add in `packages/domain-logic/`, their signatures, purity constraints
6. **Mobile screens** — screens/components, tap count, 48dp target compliance, Hindi copy keys
7. **Tests** — unit (domain-logic), integration (testcontainers), safety-critical (100% branch coverage required for critical bypass, thresholds)
8. **PostHog events** — new events, their shape, any developer alerts triggered
9. **Fail-safe behavior** — what happens when backend/Redis/push/SMS is down
10. **Rollout** — feature flag, phased enable, metrics to watch

## Step 4 — Confirm Before Coding

Show the plan and ask the user to approve or amend. Do not write any code until they say go.
