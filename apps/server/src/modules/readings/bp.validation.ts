import { z } from "zod";
import {
  BP_DIASTOLIC_MAX,
  BP_DIASTOLIC_MIN,
  BP_PULSE_MAX,
  BP_PULSE_MIN,
  BP_SYSTOLIC_MAX,
  BP_SYSTOLIC_MIN,
} from "@swasth/shared-types";

// systolic > diastolic is a medical correctness rule — equal or inverted
// pairs are always a typo / device error, never a real measurement. Reject
// before save so a bad row never reaches detectors.
export const bpCreateSchema = z
  .object({
    clientUuid: z.string().uuid(),
    systolic: z.number().int().min(BP_SYSTOLIC_MIN).max(BP_SYSTOLIC_MAX),
    diastolic: z.number().int().min(BP_DIASTOLIC_MIN).max(BP_DIASTOLIC_MAX),
    pulse: z.number().int().min(BP_PULSE_MIN).max(BP_PULSE_MAX).optional(),
    context: z.enum(["normal", "festive"]).default("normal"),
    notes: z.string().max(500).optional(),
    source: z.enum(["manual", "voice", "device"]),
    measuredAt: z.string().datetime(),
    /**
     * When the device sent this request (device clock). Optional: older app
     * builds don't send it. Used to tell a reading synced late from an
     * offline queue apart from a current one (audit P33).
     */
    sentAt: z.string().datetime().optional(),
    version: z.number().int().positive().default(1),
    /** Shared-phone profile switcher: log on behalf of a household member. */
    targetUserId: z.string().uuid().optional(),
  })
  .refine((v) => v.systolic > v.diastolic, {
    message: "systolic must be greater than diastolic",
    path: ["systolic"],
  });

export const listBPQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  targetUserId: z.string().uuid().optional(),
});
