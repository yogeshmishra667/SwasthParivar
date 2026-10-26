// Audit P22 — `logger.warn({ phone })` printed the number: the redact list
// had `*.phone` (one level down) but not top-level `phone`.
import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { LOG_REDACT_CENSOR, LOG_REDACT_PATHS } from "./log-redact.js";

const capture = (obj: object): string => {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, done): void {
      lines.push(chunk.toString());
      done();
    },
  });
  pino({ redact: { paths: [...LOG_REDACT_PATHS], censor: LOG_REDACT_CENSOR } }, sink).warn(
    obj,
    "test",
  );
  return lines.join("");
};

const PHONE = "+919812345678";

describe("logger redaction (audit P22)", () => {
  it.each([
    ["top level", { phone: PHONE }],
    ["one level down", { contact: { phone: PHONE } }],
    ["two levels down", { job: { contact: { phone: PHONE } } }],
    ["mobile", { mobile: "919812345678" }],
    ["guardianPhone", { guardianPhone: PHONE }],
    ["contactPhone", { contactPhone: PHONE }],
  ])("redacts a phone number %s", (_where, obj) => {
    const out = capture(obj);
    expect(out).not.toContain("9812345678");
    expect(out).toContain(LOG_REDACT_CENSOR);
  });

  it("redacts email, aadhaar and date of birth at the top level", () => {
    const out = capture({ email: "a@b.in", aadhaar: "123412341234", dob: "1960-01-01" });
    expect(out).not.toMatch(/a@b\.in|123412341234|1960-01-01/);
  });

  it("keeps non-PII fields, e.g. the delivery result", () => {
    const out = capture({ phone: PHONE, status: 500, errorCode: "HTTP_500" });
    expect(out).toContain('"status":500');
    expect(out).toContain("HTTP_500");
  });
});
