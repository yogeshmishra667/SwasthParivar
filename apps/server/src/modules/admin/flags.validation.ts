import { z } from "zod";

// JSON-serialisable values only. Keys are slug-ish ("otp_provider",
// "sms_msg91_enabled") — same character set as Redis-friendly keys.
const flagKey = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "lowercase alpha-numeric with underscores");

const flagValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

export const setFlagSchema = z.object({
  value: flagValue,
});

export const flagKeyParamSchema = z.object({
  key: flagKey,
});
