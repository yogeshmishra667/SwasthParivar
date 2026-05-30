// Phase 4 Feature D' — Exotel outbound IVR wrapper (India primary).
//
// Wraps Exotel's "Connect Application" API for outbound TTS calls.
// Safe-by-default: when `testMode === true` OR required env vars
// are missing, we return early without making any network call.
// Otherwise we POST to the Exotel REST API and surface the call SID
// as `vendorCallId` so the dispatcher can correlate the eventual
// status-callback back to the SOSEvent + contact attempt.
//
// API reference: https://developer.exotel.com/api/#call-flows
//
//   POST https://api.exotel.com/v1/Accounts/{SID}/Calls/connect.json
//   Basic auth: API_KEY:API_TOKEN
//   Form-encoded body:
//     From       = the contact's E.164 phone (we dial them first)
//     To         = the Exotel virtual number / app
//     CallerId   = our verified Exotel virtual number
//     Url        = absolute URL Exotel POSTs to for the TwiML-like
//                  applet response (XML with <Say>{script}</Say>)
//     StatusCallback = absolute URL Exotel POSTs status updates to
//     CustomField    = `correlationId` so the webhook can find the
//                      SOSEvent + contact attempt
//
// The `applet response` route is `POST /api/v1/sos/webhooks/exotel/applet`
// (see modules/sos/webhooks). It looks up the correlation id and
// returns the TTS XML. Decoupling the applet URL from the call
// request lets ops swap to a static recording later without touching
// this code.

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
    env.EXOTEL_ACCOUNT_SID &&
    env.EXOTEL_API_KEY &&
    env.EXOTEL_API_TOKEN &&
    env.EXOTEL_CALLER_ID &&
    env.EXOTEL_APPLET_URL &&
    env.PUBLIC_API_BASE_URL,
  );

const statusCallbackUrl = (): string =>
  `${(env.PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "")}/api/v1/sos/webhooks/exotel/status`;

/** Type guard for the Exotel response envelope. */
const isExotelOk = (body: unknown): body is { Call: { Sid: string; Status?: string } } => {
  if (typeof body !== "object" || body === null) return false;
  const call = (body as { Call?: unknown }).Call;
  if (typeof call !== "object" || call === null) return false;
  return typeof (call as { Sid?: unknown }).Sid === "string";
};

export const placeExotelIvrCall = async (
  request: IvrCallRequest,
  options: ExotelCallOptions,
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
      errorMessage:
        "Exotel credentials missing (EXOTEL_ACCOUNT_SID/API_KEY/API_TOKEN/CALLER_ID/APPLET_URL/PUBLIC_API_BASE_URL)",
    };
  }

  const url = `https://api.exotel.com/v1/Accounts/${env.EXOTEL_ACCOUNT_SID!}/Calls/connect.json`;
  const auth = Buffer.from(`${env.EXOTEL_API_KEY!}:${env.EXOTEL_API_TOKEN!}`).toString("base64");

  const body = new URLSearchParams({
    From: request.to,
    To: env.EXOTEL_CALLER_ID!,
    CallerId: env.EXOTEL_CALLER_ID!,
    Url: env.EXOTEL_APPLET_URL!,
    StatusCallback: statusCallbackUrl(),
    StatusCallbackEvents: "terminal",
    // Surfaced verbatim in every status callback so the webhook can
    // join the call back to its SOSEvent + contact attempt without
    // its own state.
    CustomField: request.correlationId,
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      // 10s timeout — SOS path can't afford to block a worker tick.
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "<unreadable>");
      log.error({ status: res.status, body: text.slice(0, 500) }, "exotel call failed");
      return {
        status: "vendor_error",
        errorMessage: `Exotel HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    const json: unknown = await res.json();
    if (!isExotelOk(json)) {
      log.error({ json }, "exotel response shape unexpected");
      return { status: "vendor_error", errorMessage: "Exotel response missing Call.Sid" };
    }

    log.info({ vendorCallId: json.Call.Sid }, "exotel call queued");
    return { status: "queued", vendorCallId: json.Call.Sid };
  } catch (err) {
    log.error({ err }, "exotel call threw");
    return {
      status: "vendor_error",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
};

/** Re-exported helper so tests can assert the configured-check rule
 * without importing the env module directly. */
export const exotelConfigured = isConfigured;
