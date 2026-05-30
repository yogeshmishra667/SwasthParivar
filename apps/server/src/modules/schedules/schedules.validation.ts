import { z } from "zod";

// One slot. Weekly schedules require `dayOfWeek`; daily schedules
// reject it. Cross-field check lives at the schema level so the
// service can trust its input.
const slotSchema = z.object({
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
});

const checkTypeEnum = z.enum(["glucose", "bp", "cardiac", "respiratory"]);
const frequencyEnum = z.enum(["daily", "weekly"]);

export const createScheduleSchema = z
  .object({
    checkType: checkTypeEnum,
    frequency: frequencyEnum,
    scheduledTimes: z.array(slotSchema).min(1).max(8),
    reminderEnabled: z.boolean().default(true),
    active: z.boolean().default(true),
    targetUserId: z.string().uuid().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.frequency === "weekly") {
      val.scheduledTimes.forEach((s, idx) => {
        if (s.dayOfWeek === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["scheduledTimes", idx, "dayOfWeek"],
            message: "weekly schedules require dayOfWeek (0=Sun..6=Sat)",
          });
        }
      });
    }
  });

export const updateScheduleSchema = z
  .object({
    scheduledTimes: z.array(slotSchema).min(1).max(8).optional(),
    reminderEnabled: z.boolean().optional(),
    active: z.boolean().optional(),
    targetUserId: z.string().uuid().optional(),
  })
  .refine(
    (val) =>
      val.scheduledTimes !== undefined ||
      val.reminderEnabled !== undefined ||
      val.active !== undefined,
    { message: "no updatable fields supplied" },
  );

export const listSchedulesQuerySchema = z.object({
  targetUserId: z.string().uuid().optional(),
});

export const scheduleParamsSchema = z.object({ id: z.string().uuid() });

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
