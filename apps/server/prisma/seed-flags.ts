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
