import { z } from "zod";

export const createScheduleSchema = z.object({
  medicineName: z.string().min(1).max(100),
  dosage: z.string().max(50).optional(),
  timeSlots: z.array(z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/)).min(1).max(6),
  condition: z.string().max(50).optional(),
  isCritical: z.boolean().default(false),
});

export const logMedicationSchema = z.object({
  scheduleId: z.string().uuid(),
  status: z.enum(["taken", "skipped", "missed_no_response", "delayed"]),
  scheduledFor: z.string().datetime(),
  skipReason: z.string().max(200).optional(),
});
