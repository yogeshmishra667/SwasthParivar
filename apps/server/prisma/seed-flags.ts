// Dev-bootstrap script: writes the default operational flag values to
// Redis on a fresh local stack. Idempotent — existing keys are left
// alone so re-running this never clobbers a live edit. Run with:
//
//   pnpm --filter @swasth/server db:seed:flags
//
// One-shot CLI script: console is the user-facing output channel, not
// the server's structured pino logger.
/* eslint-disable no-console */

import { setFlag } from "../src/shared/flags/index.js";
import { redis } from "../src/shared/redis.js";

const DEFAULT_FLAGS = {
  maintenance_mode: false,
  "auth.otp.provider": "log",
  ai_chat_enabled: true,
  ai_chat_tier3_enabled: false,
  silent_guardian_enabled: true,
  silent_guardian_alerts_dispatch: false,
  correlation_detector_enabled: true,
  cross_condition_detector_enabled: false,
  chat_retention_sweep_enabled: false,
  sos_enabled: true,
  // Phase 4 Feature E — multi-condition log surfaces. Default OFF per
  // phase4.md "Phase 4 kill-switch flags". Ops flips on per cohort
  // after Week 14 ramp.
  cardiac_logging_enabled: false,
  respiratory_logging_enabled: false,
  // Phase 4 Feature F — prescription OCR. Default OFF — flipped on
  // after the F.4 BullMQ job lands and ops has staffed the approver
  // queue. Auto-flipped OFF on `CLAUDE_VISION_DAILY_SPEND_CAP_USD`
  // breach (per CLAUDE.md "Spend-Cap Parity Across AI Surfaces").
  prescription_ocr_enabled: false,
  // Ship-default per phase4.md §F.2: GREEN items still require an
  // explicit `POST /approve` with verified fields — auto-approve
  // stays false. Listed here so an operator can see it.
  prescription_auto_approve_green: false,
  // Phase 4 Feature G — doctor portal (profiles + appointments +
  // pre-visit reports). Kill-switch, default OFF per phase4.md "Phase 4
  // kill-switch flags". Gates every /api/v1/{doctors,appointments,reports}
  // route → 503 DOCTOR_PORTAL_DISABLED when off.
  doctor_portal_enabled: false,
  // Phase 4 Feature G.4 — pre-visit PDF report generation. Default OFF.
  // Gates the GENERATE_PDF job's Claude executive-summary call; auto-
  // flipped OFF on `CLAUDE_REPORT_DAILY_SPEND_CAP_USD` breach (per
  // CLAUDE.md "Spend-Cap Parity"). When off, the PDF still renders —
  // just without the AI summary paragraph.
  report_generation_enabled: false,
};

async function main() {
  console.log("Seeding default operational flags...");
  for (const [key, value] of Object.entries(DEFAULT_FLAGS)) {
    // Only set if not already present so we don't overwrite user edits during dev re-seeds
    const exists = await redis.exists(`flag:${key}`);
    if (!exists) {
      await setFlag(key, value, "system_seed");
      console.log(`Set flag ${key} to ${value}`);
    } else {
      console.log(`Flag ${key} already exists, skipping...`);
    }
  }
  console.log("Done seeding flags.");
  await redis.quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
