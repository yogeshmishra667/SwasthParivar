import { describe, expect, it } from "vitest";

import { buildSOSMessage } from "./message-builder.js";
import type { SOSMessageInput } from "./types.js";

const base = (overrides: Partial<SOSMessageInput> = {}): SOSMessageInput => ({
  patientName: "Ramesh ji",
  language: "hi",
  ...overrides,
});

describe("buildSOSMessage — language switch", () => {
  it("Hindi default produces Hindi copy", () => {
    const msg = buildSOSMessage(base({ language: "hi" }));
    expect(msg.sms).toContain("Turant call karein");
    expect(msg.ivrScript).toContain("Yeh SwasthParivar ki emergency call hai.");
  });

  it("English produces English copy", () => {
    const msg = buildSOSMessage(base({ language: "en" }));
    expect(msg.sms).toContain("Please call now");
    expect(msg.ivrScript).toContain("This is a SwasthParivar emergency call.");
  });
});

describe("buildSOSMessage — patient name", () => {
  it("includes the patient name in both surfaces", () => {
    const msg = buildSOSMessage(base({ patientName: "Sunita Devi" }));
    expect(msg.sms).toContain("Sunita Devi");
    expect(msg.ivrScript).toContain("Sunita Devi");
  });

  it("falls back to 'Patient' when name is blank", () => {
    const msg = buildSOSMessage(base({ patientName: "   " }));
    expect(msg.sms).toContain("Patient");
    expect(msg.ivrScript).toContain("Patient");
  });

  it("trims whitespace around the patient name", () => {
    const msg = buildSOSMessage(base({ patientName: "  Asha  " }));
    expect(msg.sms).toMatch(/Asha\b/);
  });
});

describe("buildSOSMessage — optional fields", () => {
  it("omits location line when no URL", () => {
    const msg = buildSOSMessage(base());
    expect(msg.sms).not.toContain("Location:");
    expect(msg.ivrScript).not.toContain("location app par bheji");
  });

  it("includes location line + URL when provided", () => {
    const msg = buildSOSMessage(base({ locationUrl: "https://maps.google.com/?q=12.97,77.59" }));
    expect(msg.sms).toContain("Location: https://maps.google.com/?q=12.97,77.59");
    expect(msg.ivrScript).toContain("location app par bheji gayi hai");
  });

  it("omits context line when no summary", () => {
    const msg = buildSOSMessage(base());
    expect(msg.sms).not.toContain("Last reading");
    expect(msg.ivrScript).not.toContain("Aakhri reading");
  });

  it("includes context line when summary provided", () => {
    const msg = buildSOSMessage(base({ contextSummary: "Sugar 38 mg/dL (10 min ago)" }));
    expect(msg.sms).toContain("Last reading: Sugar 38 mg/dL");
    expect(msg.ivrScript).toContain("Aakhri reading hai: Sugar 38 mg/dL");
  });
});

describe("buildSOSMessage — SMS cap", () => {
  it("never exceeds the 3-segment cap of 458 chars", () => {
    const longContext = "x".repeat(2000);
    const msg = buildSOSMessage(
      base({
        patientName: "Patient with a fairly long name appended " + "y".repeat(50),
        locationUrl: "https://maps.google.com/?q=12.97,77.59&z=18",
        contextSummary: longContext,
      }),
    );
    expect(msg.sms.length).toBeLessThanOrEqual(458);
  });

  it("truncates the context, preserving header + action + location", () => {
    const msg = buildSOSMessage(
      base({
        locationUrl: "https://example.com/loc",
        contextSummary: "x ".repeat(1000),
      }),
    );
    expect(msg.sms).toContain("EMERGENCY");
    expect(msg.sms).toContain("Turant call karein");
    expect(msg.sms).toContain("Location: https://example.com/loc");
    expect(msg.sms.length).toBeLessThanOrEqual(458);
  });

  it("drops the context entirely when no room remains", () => {
    // Header + action + a giant location URL fills the cap → no room
    // for context. The action line must still survive.
    const giantUrl = "https://example.com/" + "a".repeat(450);
    const msg = buildSOSMessage(base({ locationUrl: giantUrl, contextSummary: "Sugar 38" }));
    expect(msg.sms.length).toBeLessThanOrEqual(458);
    expect(msg.sms).toContain("Turant call karein");
  });
});

describe("buildSOSMessage — IVR shape", () => {
  it("uses double space between sentences (TTS pause cue)", () => {
    const msg = buildSOSMessage(base());
    expect(msg.ivrScript).toContain("  ");
  });

  it("contains no emoji in the IVR script (TTS-unfriendly)", () => {
    const msg = buildSOSMessage(base({ contextSummary: "Sugar 38", locationUrl: "https://x" }));
    // The SMS allowed emoji (🚨); the IVR must not.
    expect(msg.ivrScript).not.toMatch(/🚨/);
  });
});
