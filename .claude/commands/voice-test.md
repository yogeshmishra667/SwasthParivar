---
description: Run voice parser tests and cross-check Hindi/Hinglish fixture coverage against CLAUDE.md.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

Validate the voice parser is tested against every rule in `CLAUDE.md` → "Voice Logging (Phase 1)".

## Step 1 — Run tests

```
pnpm --filter domain-logic test voice-parser
pnpm --filter domain-logic test voice-parser.property
```

Both must pass. Report failing cases verbatim.

## Step 2 — Fixture audit

Read `packages/test-factories/src/voice-transcript.fixtures.ts`. Confirm coverage of:

### Colloquial dictionary (every entry from CLAUDE.md, must be present)

- sava sau → 125
- dedh sau → 150
- paune do sau → 175
- do sau → 200
- dhai sau → 250
- sava do sau → 225
- paune teen sau → 275
- teen sau → 300
- derh sau → 150
- savaa sau → 125
- ek sau das → 110, ek sau bees → 120, ek sau tees → 130
- ek sau chaalees → 140, ek sau pachaas → 150, ek sau saath → 160

### Devanagari variants

- At least one case per colloquial number in Devanagari script (सवा सौ, डेढ़ सौ, etc.)

### Context inference (time windows from Edge Case #8)

- 6-9 AM → fasting (confident)
- 10-11 AM → uncertain (requiresTypeConfirmation)
- 12-2 PM → post_meal
- 3-5 PM → uncertain
- 7-9 PM → post_meal
- 10 PM-5 AM → uncertain
- `subah` keyword overrides clock

### Past-tense rejection (Edge Case #5)

- "kal sugar 140 thi" → null
- "aaj sugar 140 aayi" → 140
- "sugar 140 hai" → 140
- "kal 140 thi aaj check nahi ki" → null (negated present intent)

### Uncertainty keywords

- shayad, lagbhag, hoga, lagta hai, around, kareeban, approx → uncertaintyDetected = true

### Confidence handling

- < 0.6 → requiresStrongConfirmation = true
- ≥ 0.6 → normal flow

### Multiple numbers (Edge Case #6)

- Two numbers + intent keyword → ranked list with recommended

### Range

- value < 20 → null
- value > 600 → requiresDoubleConfirmation

### Noise

- Transcript with number + intent keyword → extract
- Transcript with number but no intent keyword (TV/radio bleed) → null

## Step 3 — Report

For each category, list: `✅ covered (N cases)` or `❌ MISSING: <specific case>`.

Do not auto-add missing fixtures — surface the gap so the user can capture real device transcripts for them.
