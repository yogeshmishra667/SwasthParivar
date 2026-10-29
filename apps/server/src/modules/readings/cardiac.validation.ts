import { z } from "zod";
import {
  HR_VALID_MAX,
  HR_VALID_MIN,
  PAIN_SEVERITY_MAX,
  PAIN_SEVERITY_MIN,
} from "@swasth/shared-types";

/**
 * Cardiac log create payload.
 *
 * Notable cross-field rules:
 *   - `painSeverity > 0` is only meaningful when `chestPain === true`.
 *     The validator rejects a severity number without an active chest-
 *     pain flag — otherwise the classifier would never read it and the
 *     row would carry a misleading 9/10 score that ops auditors must
 *     reconcile later.
 *   - `chestPain === true` is allowed without a severity (the classifier
 *     conservatively treats `painSeverity ?? 0` as 0, which routes to
 *     the warn band, not bypass). This matches the mobile UX where the
 *     patient can flag "haan, dard hai" and submit before picking a
 *     slider value.
 */
export const cardiacCreateSchema = z
  .object({
    clientUuid: z.string().uuid(),
    heartRate: z.number().int().min(HR_VALID_MIN).max(HR_VALID_MAX),
    rhythmStatus: z.enum(["regular", "irregular", "unknown"]).default("unknown"),
    chestPain: z.boolean().default(false),
    painSeverity: z.number().int().min(PAIN_SEVERITY_MIN).max(PAIN_SEVERITY_MAX).optional(),
    exerciseTolerance: z.enum(["normal", "reduced", "severe"]).default("normal"),
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
  .refine((v) => !(v.painSeverity !== undefined && v.painSeverity > 0 && !v.chestPain), {
    message: "painSeverity > 0 requires chestPain=true",
    path: ["painSeverity"],
  });

export const listCardiacQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  targetUserId: z.string().uuid().optional(),
});
