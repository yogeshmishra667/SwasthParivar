// Phase 4 Feature D' — Exotel outbound IVR wrapper (India primary).
//
// Wraps Exotel's "Connect Application" API for outbound TTS calls.
// Safe-by-default: when ANY of the required env vars are missing OR
// when `testMode === true`, the wrapper returns without making a
// network call and logs what it WOULD have done. This lets us ship
// the whole SOS surface dark and promote it via a single flag flip
// later (CLAUDE.md "SOS Test-Mode Default").
//
// The full Exotel API exchange (auth, body shape, status callbacks)
// is intentionally NOT implemented in this PR — the SOS scaffold
// lands behind `sos_enabled=false` + `sos_test_mode=true` so no
// production call path runs through this code. Week 14 ramp wires
// the real HTTP request + status webhook.

import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import type { IvrCallRequest, IvrCallResult } from "./types.js";

interface ExotelCallOptions {
  /** When true the wrapper short-circuits to `test_mode_skipped`
   * regardless of credentials. */
  readonly testMode: boolean;
}

const isConfigured = (): boolean =>
  Boolean(
    env.EXOTEL_ACCOUNT_SID && env.EXOTEL_API_KEY && env.EXOTEL_API_TOKEN && env.EXOTEL_CALLER_ID,
  );

export const placeExotelIvrCall = async (
  request: IvrCallRequest,
  options: ExotelCallOptions,
  // eslint-disable-next-line @typescript-eslint/require-await
): Promise<IvrCallResult> => {
  const log = logger.child({
    vendor: "exotel",
    correlationId: request.correlationId,
    to: request.to,
  });

  if (options.testMode) {
    log.info({ scriptLen: request.script.length }, "exotel call SKIPPED — test mode");
    return { status: "test_mode_skipped" };
  }

  if (!isConfigured()) {
    log.warn("exotel credentials missing — no call placed");
    return {
      status: "no_vendor_configured",
      errorMessage: "Exotel credentials missing (EXOTEL_ACCOUNT_SID/API_KEY/API_TOKEN/CALLER_ID)",
    };
  }

  // Week 14 will replace this branch with the real Exotel POST. For
  // now ship the scaffold dark: a non-test, configured call is a
  // no-op + a loud "not implemented" log so anyone who promotes the
  // flag prematurely sees it. Returning `vendor_error` keeps the
  // dispatcher honest — it will fall through to the SMS-all-contacts
  // path rather than treat this as a successful dial.
  log.error(
    { scriptLen: request.script.length },
    "exotel real-call path NOT IMPLEMENTED (phase4 week14) — dispatcher should fall through",
  );
  return {
    status: "vendor_error",
    errorMessage: "exotel real-call path not yet wired (phase4 week14 scope)",
  };
};

/** Re-exported helper so tests can assert the configured-check rule
 * without importing the env module directly. */
export const exotelConfigured = isConfigured;
