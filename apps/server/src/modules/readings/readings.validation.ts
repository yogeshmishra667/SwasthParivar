import { z } from "zod";
import { GLUCOSE_VALID_MAX, GLUCOSE_VALID_MIN } from "@swasth/shared-types";

export const glucoseCreateSchema = z.object({
  clientUuid: z.string().uuid(),
  valueMgDl: z.number().int().min(GLUCOSE_VALID_MIN).max(GLUCOSE_VALID_MAX),
  readingType: z.enum(["fasting", "pre_meal", "post_meal", "random", "bedtime"]),
  context: z.enum(["normal", "festive"]).default("normal"),
  // `null` too: the app's offline queue (WatermelonDB) stores an unset
  // optional column as null, and app builds before audit P9 send it as
  // `"notes": null`. Rejecting that 400'd every queued reading, and those
  // builds delete a row on any 4xx — critical readings included.
  notes: z
    .string()
    .max(500)
    .nullish()
    .transform((v) => v ?? undefined),
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
});

export const glucoseVoiceSchema = z.object({
  clientUuid: z.string().uuid(),
  transcript: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
  capturedAtIso: z.string().datetime(),
  capturedAtHourLocal: z.number().int().min(0).max(23),
  confirmedValue: z.number().int().min(GLUCOSE_VALID_MIN).max(GLUCOSE_VALID_MAX),
  confirmedType: z.enum(["fasting", "pre_meal", "post_meal", "random", "bedtime"]),
  context: z.enum(["normal", "festive"]).default("normal"),
  targetUserId: z.string().uuid().optional(),
});

export const listReadingsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  targetUserId: z.string().uuid().optional(),
});
