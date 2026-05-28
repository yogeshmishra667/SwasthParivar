// Phase 4 Feature D' — SOS message copy.
//
// Hindi-first (CLAUDE.md "Project"). Same content rendered for SMS
// (one-shot, capped at 459 chars / 3 segments) and IVR (TTS-friendly,
// no emoji, full sentences). The dispatcher passes the result to
// MSG91 (SMS) and Exotel/Twilio (IVR) verbatim — keep both shapes
// in this single source so they cannot drift.
//
// The 459-char SMS cap is enforced by trimming the optional context
// summary, never the action line. The action line is what the
// guardian needs to read; everything else is nice-to-have.

import type { SOSMessage, SOSMessageInput } from "./types.js";

/** Multi-segment SMS hard cap. 3 segments × 153 chars (concatenated
 * GSM-7) = 459. We deliberately stay one char under (458) so the
 * carrier never inadvertently splits into a fourth segment for an
 * extra UDH byte. */
const SMS_HARD_CAP = 458;

// ── Per-language string banks ────────────────────────────────────

const COPY_HI = {
  smsHeader: "🚨 EMERGENCY:",
  ivrHeader: "Yeh SwasthParivar ki emergency call hai.",
  smsAction: "Turant call karein ya pahunchein.",
  ivrAction: "Patient ko abhi madad chahiye. Kripya turant call karein ya pahunch jaayein.",
  smsLocation: "Location:",
  ivrLocation: "Patient ki location app par bheji gayi hai.",
  smsContext: "Last reading:",
  ivrContext: "Aakhri reading hai:",
} as const;

const COPY_EN = {
  smsHeader: "🚨 EMERGENCY:",
  ivrHeader: "This is a SwasthParivar emergency call.",
  smsAction: "Please call now or reach the patient.",
  ivrAction: "The patient needs help. Please call them now or reach them in person.",
  smsLocation: "Location:",
  ivrLocation: "The patient's location has been shared in the app.",
  smsContext: "Last reading:",
  ivrContext: "Last recorded reading is:",
} as const;

// Both banks share an identical key shape but TS would otherwise
// narrow the return type to the first bank's literal strings.
interface CopyBank {
  readonly smsHeader: string;
  readonly ivrHeader: string;
  readonly smsAction: string;
  readonly ivrAction: string;
  readonly smsLocation: string;
  readonly ivrLocation: string;
  readonly smsContext: string;
  readonly ivrContext: string;
}

const copyFor = (lang: SOSMessageInput["language"]): CopyBank =>
  lang === "en" ? COPY_EN : COPY_HI;

/** Trim a string at a word boundary so the cap-enforcement step
 * doesn't leave a half-word dangling in the SMS. */
const trimAtWord = (s: string, maxLen: number): string => {
  if (s.length <= maxLen) return s;
  const sliced = s.slice(0, maxLen);
  const lastSpace = sliced.lastIndexOf(" ");
  return lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced;
};

/**
 * Build the SOS message in both surfaces. Result is deterministic
 * for the same input — the test suite asserts every branch.
 */
export const buildSOSMessage = (input: SOSMessageInput): SOSMessage => {
  const copy = copyFor(input.language);
  const name = input.patientName.trim().length > 0 ? input.patientName.trim() : "Patient";

  // ── SMS ─────────────────────────────────────────────────────
  // Action line is mandatory. Build optional lines, then truncate
  // the context to whatever remains under the cap. Order: header +
  // action (mandatory) → location (optional) → context (optional,
  // truncated last).
  const smsHeader = `${copy.smsHeader} ${name}`;
  const smsLines: string[] = [smsHeader, copy.smsAction];

  if (input.locationUrl) {
    smsLines.push(`${copy.smsLocation} ${input.locationUrl}`);
  }

  let smsCore = smsLines.join(" ");
  if (input.contextSummary) {
    const proposedContext = ` ${copy.smsContext} ${input.contextSummary}`;
    const room = SMS_HARD_CAP - smsCore.length - 1;
    if (room > 10) {
      smsCore += trimAtWord(proposedContext, room);
    }
  }

  const sms = smsCore.length > SMS_HARD_CAP ? trimAtWord(smsCore, SMS_HARD_CAP) : smsCore;

  // ── IVR ─────────────────────────────────────────────────────
  // No length cap — TTS reads it all. Add a brief pause cue
  // between sentences so the listener has time to process.
  const ivrParts: string[] = [copy.ivrHeader, `Patient: ${name}.`, copy.ivrAction];
  if (input.locationUrl) ivrParts.push(copy.ivrLocation);
  if (input.contextSummary) ivrParts.push(`${copy.ivrContext} ${input.contextSummary}.`);

  // Two spaces between sentences gives most TTS engines a beat.
  const ivrScript = ivrParts.join("  ");

  return { sms, ivrScript };
};
