# PR

<!-- Title mirrors the lead commit's subject line. Don't leave the default. -->

## Summary

<!--
1-3 bullets. WHAT changed and WHY. Skip the "how" — diff is the how.
-->

-

## Phase

- [ ] This PR stays inside the **current build phase** per `CLAUDE.md`
  - Phase 1: glucose only · voice + critical bypass + medications + streaks
  - Phase 2: BP · meals · insights · dashboard summary · guardian read-only
  - Phase 3: AI chat · Silent Guardian · SOS · basic guardian alerts
  - Phase 4+: prescription OCR · cardiac/respiratory · doctor appts · regional langs
- [ ] If it crosses phases, link the discussion that approved the cross-phase work.

## Safety review

Tick the boxes that apply to this diff. Each ticked box also needs a sentence below
on what changed and why it's still safe.

- [ ] **Critical bypass chain** (`critical-bypass`, `CriticalAlert.tsx`, `critical-alert.worker.ts`)
- [ ] **Glucose validation / thresholds** (`readings.validation.ts`, hardcoded 65/315 limits)
- [ ] **Streak engine** (3 AM boundary, grace window, anti-cheat, server-time fallback)
- [ ] **Voice parser** (Hindi/Hinglish dictionary, past-tense rejection, type inference)
- [ ] **Sync conflict resolution** (`/sync/push`, version comparison)
- [ ] **Notification dispatch** (Expo push, MSG91 SMS, anti-fatigue, priority resolver)
- [ ] **Schema migration** (a new file in `apps/server/prisma/migrations/`)

If anything is ticked, **two reviewers** are required (default: at least one
from `CODEOWNERS`) and the corresponding subagent should have been run locally:

```
claude /agents safety-reviewer
claude /agents domain-logic-reviewer
claude /agents db-reviewer
claude /agents mobile-ux-reviewer
```

## Tests

- [ ] `pnpm typecheck` (workspace) passes locally
- [ ] `pnpm test:unit` (domain-logic) passes locally
- [ ] `pnpm test:integration` (server, Testcontainers) passes locally — if server changes
- [ ] New behaviour has at least one test (unit if domain logic, integration if HTTP/DB)
- [ ] **Mobile only**: device-tested on real Android (not just simulator). Note model + Android version.

## Schema migration (delete if N/A)

- [ ] Migration is idempotent (`IF NOT EXISTS`, safe defaults).
- [ ] Migration runs in seconds on the prod-sized table; or is gated behind a feature flag.
- [ ] No applied migration was edited in place.
- [ ] Backfill plan documented above if columns are NOT NULL without a default.

## Mobile screenshots / clip (delete if N/A)

<!-- Drag images or paste a Loom. Required for any screen UI change. -->

## Out-of-scope follow-ups

<!-- Anything you noticed but didn't fix. File issues if substantial. -->

-

## Deploy notes

<!--
Anything ops-relevant: env var changes, Redis/BullMQ migration, mobile EAS
build needed, OTA-safe (JS-only) yes/no.
-->

-
