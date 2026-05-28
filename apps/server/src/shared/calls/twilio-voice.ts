// Phase 4 Feature D' — Twilio outbound IVR wrapper (international
// fallback for non-+91 numbers; CLAUDE.md "Phase 4 Invariants").
//
// Same safe-by-default contract as the Exotel wrapper. Real Twilio
// Programmable Voice integration lands in Week 14 — this PR ships
// the scaffold behind `sos_test_mode=true` so the call surface is
// log-only.

import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import type { IvrCallRequest, IvrCallResult } from "./types.js";

interface TwilioCallOptions {
  readonly testMode: boolean;
}

const isConfigured = (): boolean =>
  Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER);

export const placeTwilioIvrCall = async (
  request: IvrCallRequest,
  options: TwilioCallOptions,
  // eslint-disable-next-line @typescript-eslint/require-await
): Promise<IvrCallResult> => {
  const log = logger.child({
    vendor: "twilio",
    correlationId: request.correlationId,
    to: request.to,
  });

  if (options.testMode) {
    log.info({ scriptLen: request.script.length }, "twilio call SKIPPED — test mode");
    return { status: "test_mode_skipped" };
  }

  if (!isConfigured()) {
    log.warn("twilio credentials missing — no call placed");
    return {
      status: "no_vendor_configured",
      errorMessage: "Twilio credentials missing (TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER)",
    };
  }

  log.error(
    { scriptLen: request.script.length },
    "twilio real-call path NOT IMPLEMENTED (phase4 week14) — dispatcher should fall through",
  );
  return {
    status: "vendor_error",
    errorMessage: "twilio real-call path not yet wired (phase4 week14 scope)",
  };
};

export const twilioConfigured = isConfigured;
