import { z } from "zod";
import { PEAK_FLOW_VALID_MAX, PEAK_FLOW_VALID_MIN } from "@swasth/shared-types";

/**
 * Respiratory log create payload.
 *
 * Notable cross-field rules:
 *   - At least one signal must be present: a `peakFlow`, an
 *     `inhalerUsed=true`, or a `symptomSeverity !== "none"`. A row with
 *     none of these would be a no-op that wastes a slot in the timeline
 *     — reject so the patient gets a clear "press at least one signal"
 *     error before save.
 *   - `puffs > 0` requires `inhalerUsed=true`. A puff count without an
 *     inhaler-use flag is a UI bug, not a legitimate medical fact.
 *   - `baselinePeakFlow`, when supplied, must be in the same valid
 *     numeric range as `peakFlow` so a bogus baseline (e.g. 0 or
 *     1_000_000) cannot corrupt the red-zone ratio.
 */
export const respiratoryCreateSchema = z
  .object({
    clientUuid: z.string().uuid(),
    peakFlow: z.number().int().min(PEAK_FLOW_VALID_MIN).max(PEAK_FLOW_VALID_MAX).optional(),
    baselinePeakFlow: z.number().int().min(PEAK_FLOW_VALID_MIN).max(PEAK_FLOW_VALID_MAX).optional(),
    inhalerUsed: z.boolean().default(false),
    inhalerType: z.string().max(120).optional(),
    puffs: z.number().int().min(1).max(10).optional(),
    triggerNote: z.string().max(500).optional(),
    symptomSeverity: z.enum(["none", "mild", "moderate", "severe"]).default("none"),
    notes: z.string().max(500).optional(),
    source: z.enum(["manual", "voice", "device"]),
    measuredAt: z.string().datetime(),
    version: z.number().int().positive().default(1),
    /** Shared-phone profile switcher: log on behalf of a household member. */
    targetUserId: z.string().uuid().optional(),
  })
  .refine(
    (v) =>
      v.peakFlow !== undefined ||
      v.inhalerUsed === true ||
      (v.symptomSeverity !== undefined && v.symptomSeverity !== "none"),
    {
      message:
        "respiratory log must include at least one of: peakFlow, inhalerUsed=true, or symptomSeverity!=none",
      path: ["peakFlow"],
    },
  )
  .refine((v) => !(v.puffs !== undefined && !v.inhalerUsed), {
    message: "puffs requires inhalerUsed=true",
    path: ["puffs"],
  });

export const listRespiratoryQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  targetUserId: z.string().uuid().optional(),
});
