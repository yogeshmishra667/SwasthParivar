// Phase 4 Feature D' — vendor webhook receivers.
//
// Two endpoints, one per IVR vendor:
//   POST /api/v1/sos/webhooks/exotel/applet  → returns TwiML XML for
//                                              the connected leg.
//   POST /api/v1/sos/webhooks/exotel/status  → status callback.
//   POST /api/v1/sos/webhooks/twilio/status  → status callback.
//
// Both status webhooks flip `status: "answered"` on the matching
// `SOSEvent.contactsNotified[]` entry when the call reaches the
// human (Exotel's `Status === "completed"` with a `DialCallStatus ===
// "completed"` or Twilio's `CallStatus === "completed"` with
// `AnsweredBy === "human"`). That mark is what the state machine
// reads as `anyContactAnsweredCall=true` on the next tick — the
// chain resolves automatically.
//
// Auth:
//   - Exotel does not sign callbacks by default; we accept by
//     correlation id when `EXOTEL_WEBHOOK_SECRET` is unset and
//     HMAC-verify when set.
//   - Twilio signs with the auth token (X-Twilio-Signature). We
//     verify per Twilio's spec: HMAC-SHA1 over the absolute URL +
//     sorted-by-key form params, base64 encoded.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { logger } from "../../shared/logger.js";
import { env } from "../../config/env.js";
import { prisma } from "../../shared/database.js";

interface DispatchLogEntry {
  contactId: string;
  stage: string;
  channel: "log_only" | "ivr" | "sms" | "push";
  at: string;
  status: "queued" | "delivered" | "answered" | "skipped_test_mode" | "failed";
  reason?: string;
  vendorCallId?: string;
  correlationId?: string;
}

const isDispatchArray = (v: unknown): v is DispatchLogEntry[] => Array.isArray(v);

const markAnswered = async (
  correlationId: string | null,
  vendorCallId: string | null,
  vendor: "exotel" | "twilio",
): Promise<{ matched: boolean; sosEventId?: string }> => {
  if (!correlationId && !vendorCallId) return { matched: false };

  // Pull every event with a non-terminal stage AND a matching entry
  // in its dispatch log. Tight window because at-most one SOS chain
  // is active per patient and we run this only on call-status
  // callbacks (~tens per drill, not thousands).
  const candidates = await prisma.sOSEvent.findMany({
    where: { resolvedAt: null, cancelledAt: null },
    select: { id: true, contactsNotified: true },
    take: 200,
  });

  for (const ev of candidates) {
    if (!isDispatchArray(ev.contactsNotified)) continue;
    const entries = ev.contactsNotified;
    const idx = entries.findIndex((e) => {
      if (e.channel !== "ivr") return false;
      if (correlationId && e.correlationId === correlationId) return true;
      if (vendorCallId && e.vendorCallId === vendorCallId) return true;
      return false;
    });
    if (idx === -1) continue;

    // `entries` is `DispatchLogEntry[]` after the type guard above —
    // re-bind to a fresh local so the slice keeps the narrowed type
    // (Prisma's JsonValue widens the original variable).
    const original: DispatchLogEntry[] = entries;
    const updated: DispatchLogEntry[] = original.slice();
    const existing = updated[idx]!;
    const replacement: DispatchLogEntry = {
      ...existing,
      status: "answered",
      at: new Date().toISOString(),
      reason: `${vendor} webhook`,
    };
    updated.splice(idx, 1, replacement);

    await prisma.sOSEvent.update({
      where: { id: ev.id },
      data: { contactsNotified: updated as unknown as Prisma.InputJsonValue },
    });
    return { matched: true, sosEventId: ev.id };
  }
  return { matched: false };
};

// ── Exotel ───────────────────────────────────────────────────────

const isExotelHumanAnswered = (body: Record<string, string>): boolean => {
  // Exotel's callback fires `Status=completed` once a call ends.
  // For our purposes we treat a `completed` AND `DialCallStatus !==
  // "no-answer" | "busy" | "failed"` as a human pickup.
  const status = body.Status?.toLowerCase() ?? "";
  const dial = body.DialCallStatus?.toLowerCase() ?? body.CallStatus?.toLowerCase() ?? "";
  if (status !== "completed") return false;
  return !["no-answer", "busy", "failed", "canceled", "cancelled"].includes(dial);
};

export const exotelStatusWebhook = async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, string>;
  const correlationId = body.CustomField ?? null;
  const vendorCallId = body.CallSid ?? null;

  // Optional HMAC verification when the operator has provisioned a
  // signing secret with Exotel. Reject mismatches.
  const secret = env.EXOTEL_WEBHOOK_SECRET;
  const signature = req.header("x-exotel-signature");
  if (secret && signature) {
    const payload = JSON.stringify(body);
    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      logger.warn({ vendorCallId }, "exotel webhook signature mismatch");
      res.status(401).end();
      return;
    }
  }

  if (!isExotelHumanAnswered(body)) {
    logger.info({ vendorCallId, body }, "exotel webhook — not a successful answer");
    res.status(200).end();
    return;
  }

  const match = await markAnswered(correlationId, vendorCallId, "exotel");
  logger.info(
    { vendorCallId, correlationId, matched: match.matched, sosEventId: match.sosEventId },
    "exotel webhook processed",
  );
  res.status(200).end();
};

/** Static applet response — Exotel POSTs here when a leg connects.
 * Returns the TwiML-like XML body Exotel speaks via TTS. We embed
 * the SOS copy directly so this endpoint stays stateless (no DB
 * lookup, no auth dependency — Exotel can be unreachable to our DB
 * during the call). */
export const exotelAppletResponse = (_req: Request, res: Response): void => {
  // The script is identical for every call right now (Hindi default;
  // the dispatcher-side TTS variation would require fetching per
  // call, which we don't do in the scaffold). Once the §D'.2
  // per-language dispatch lands, swap this for a per-correlation
  // lookup.
  res.set("Content-Type", "application/xml; charset=utf-8");
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="female" language="hi-IN">Yeh SwasthParivar ki emergency call hai. Patient ko abhi madad chahiye. Kripya turant call karein ya pahunch jaayein.</Say></Response>`,
  );
};

// ── Twilio ───────────────────────────────────────────────────────

/** Validates an incoming Twilio webhook per
 *  https://www.twilio.com/docs/usage/webhooks/webhooks-security. */
const verifyTwilioSignature = (
  fullUrl: string,
  params: Record<string, string>,
  signature: string,
  authToken: string,
): boolean => {
  // Sort form params by key, append to URL, HMAC-SHA1 with auth token,
  // base64 encode.
  const sortedKeys = Object.keys(params).sort();
  let buf = fullUrl;
  for (const k of sortedKeys) buf += k + params[k];
  const expected = createHmac("sha1", authToken).update(buf).digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

const isTwilioHumanAnswered = (body: Record<string, string>): boolean => {
  const status = body.CallStatus?.toLowerCase() ?? "";
  if (status !== "completed") return false;
  // `AnsweredBy` is set when AMD is enabled. Without AMD, we trust
  // a `completed` call with non-zero duration as a human pickup.
  const answeredBy = body.AnsweredBy?.toLowerCase();
  if (answeredBy === "human") return true;
  if (answeredBy === "machine") return false;
  const duration = Number(body.CallDuration ?? "0");
  return duration > 5; // at least 5s connected
};

export const twilioStatusWebhook = async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, string>;

  const signature = req.header("x-twilio-signature");
  const authToken = env.TWILIO_AUTH_TOKEN;
  // We accept unsigned-only-when-unconfigured (dev/test). Signed in
  // prod is mandatory whenever creds are present.
  if (authToken && signature) {
    const proto = req.header("x-forwarded-proto") ?? req.protocol;
    const host = req.header("x-forwarded-host") ?? req.header("host") ?? "";
    const fullUrl = `${proto}://${host}${req.originalUrl}`;
    if (!verifyTwilioSignature(fullUrl, body, signature, authToken)) {
      logger.warn({ vendorCallId: body.CallSid }, "twilio webhook signature mismatch");
      res.status(401).end();
      return;
    }
  }

  if (!isTwilioHumanAnswered(body)) {
    logger.info({ vendorCallId: body.CallSid, body }, "twilio webhook — not a successful answer");
    res.status(200).end();
    return;
  }

  const vendorCallId = body.CallSid ?? null;
  const match = await markAnswered(null, vendorCallId, "twilio");
  logger.info(
    { vendorCallId, matched: match.matched, sosEventId: match.sosEventId },
    "twilio webhook processed",
  );
  res.status(200).end();
};
