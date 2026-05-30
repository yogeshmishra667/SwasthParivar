// Phase 4 Feature D' — Twilio outbound IVR wrapper (international
// fallback for non-+91 numbers; CLAUDE.md "Phase 4 Invariants").
//
// Same safe-by-default contract as the Exotel wrapper. Twilio is
// nicer to integrate than Exotel because TwiML can be passed INLINE
// as a body parameter — no separate applet URL hop is needed.
//
// API reference: https://www.twilio.com/docs/voice/api/call-resource
//
//   POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Calls.json
//   Basic auth: ACCOUNT_SID:AUTH_TOKEN
//   Form-encoded body:
//     From            = TWILIO_FROM_NUMBER (verified caller id)
//     To              = the contact's E.164
//     Twiml           = literal XML: <Response><Say>{script}</Say></Response>
//     StatusCallback  = our webhook
//     StatusCallbackEvent = completed
//     StatusCallbackMethod = POST
//
// Twilio signs status callbacks with the auth token (`X-Twilio-
// Signature` header). The webhook verifies the signature; no extra
// shared secret env var needed.

import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import type { IvrCallRequest, IvrCallResult } from "./types.js";

interface TwilioCallOptions {
  readonly testMode: boolean;
}

const isConfigured = (): boolean =>
  Boolean(
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_FROM_NUMBER &&
    env.PUBLIC_API_BASE_URL,
  );

const statusCallbackUrl = (): string =>
  `${(env.PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "")}/api/v1/sos/webhooks/twilio/status`;

/** Build the inline TwiML. We escape the script using textContent
 * semantics — the only legal occurrences of `&`, `<`, `>` in a
 * `<Say>` body need entity encoding. */
const buildTwiml = (script: string): string => {
  const safe = script.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<Response><Say voice="alice">${safe}</Say></Response>`;
};

const isTwilioOk = (body: unknown): body is { sid: string; status?: string } => {
  if (typeof body !== "object" || body === null) return false;
  return typeof (body as { sid?: unknown }).sid === "string";
};

export const placeTwilioIvrCall = async (
  request: IvrCallRequest,
  options: TwilioCallOptions,
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
      errorMessage:
        "Twilio credentials missing (TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER/PUBLIC_API_BASE_URL)",
    };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID!}/Calls.json`;
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID!}:${env.TWILIO_AUTH_TOKEN!}`).toString(
    "base64",
  );

  const body = new URLSearchParams({
    From: env.TWILIO_FROM_NUMBER!,
    To: request.to,
    Twiml: buildTwiml(request.script),
    StatusCallback: statusCallbackUrl(),
    StatusCallbackEvent: "completed",
    StatusCallbackMethod: "POST",
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
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "<unreadable>");
      log.error({ status: res.status, body: text.slice(0, 500) }, "twilio call failed");
      return {
        status: "vendor_error",
        errorMessage: `Twilio HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    const json: unknown = await res.json();
    if (!isTwilioOk(json)) {
      log.error({ json }, "twilio response shape unexpected");
      return { status: "vendor_error", errorMessage: "Twilio response missing sid" };
    }

    log.info({ vendorCallId: json.sid }, "twilio call queued");
    return { status: "queued", vendorCallId: json.sid };
  } catch (err) {
    log.error({ err }, "twilio call threw");
    return {
      status: "vendor_error",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
};

export const twilioConfigured = isConfigured;
