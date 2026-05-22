import { z } from "zod";

// Flag keys are slug-ish. Dots ARE allowed — operational flags like
// `auth.otp.provider` and `notification.best_time_fasting` use them.
export const flagKeyParamSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_.]*$/, "lowercase, digits, underscore and dot only"),
});

const percent = z.number().int().min(0).max(100);
const userId = z.string().min(1);

// The four CC.12 rollout shapes (mirrors RolloutConfig in domain-logic).
const rolloutSchema = z.discriminatedUnion("rollout", [
  z.object({ rollout: z.literal("cohort"), userIds: z.array(userId) }),
  z.object({ rollout: z.literal("percentage"), percent }),
  z.object({
    rollout: z.literal("cohort_or_percentage"),
    userIds: z.array(userId),
    percent,
  }),
]);

// A flag value: a primitive, an array, or any JSON object. An object
// that carries a `rollout` key MUST be a valid rollout config — that is
// the typed-rollout validation. Non-rollout config objects pass freely.
const objectValue = z
  .record(z.string(), z.unknown())
  .refine((obj) => !("rollout" in obj) || rolloutSchema.safeParse(obj).success, {
    message: "object has a 'rollout' key but is not a valid rollout config",
  });

const flagValue = z.union([z.boolean(), z.string(), z.number(), z.array(z.unknown()), objectValue]);

export const setFlagSchema = z.object({ value: flagValue });

// Atomic cohort edit — add/remove user ids without a read-modify-write
// race in the client.
export const cohortPatchSchema = z.object({
  add: z.array(userId).default([]),
  remove: z.array(userId).default([]),
});

export const evaluateQuerySchema = z.object({
  userId: z.uuid(),
});
