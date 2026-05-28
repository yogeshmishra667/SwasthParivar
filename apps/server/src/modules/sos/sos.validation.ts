import { z } from "zod";

// Mobile sends a uuid-v4 it minted locally so retries collapse to the
// same SOSEvent row server-side (CLAUDE.md "Sync Conflict Resolution").
const clientUuidSchema = z.uuid();

export const sosTriggerSchema = z.object({
  clientUuid: clientUuidSchema,
  // Phase 4 Week 13 ships `patient_manual` only. The other two
  // sources are reserved enum values — accepted by validation so the
  // mobile side can roll them out independently, but blocked in the
  // service layer until §D'.2 lands.
  source: z.enum(["patient_manual", "critical_bypass_escalation", "guardian_initiated"]),
  // Lat / lng / accuracy are independent — a degraded GPS fix that
  // gives lat but not accuracy is still useful information.
  locationLat: z.number().min(-90).max(90).optional(),
  locationLng: z.number().min(-180).max(180).optional(),
  locationAccuracyM: z.number().int().nonnegative().max(50_000).optional(),
  // Free-form JSON snapshot — capped at ~2KB so a misbehaving client
  // can't blow up the SOSEvent row. The dispatcher only uses a few
  // common keys; the rest is audit data.
  lastReadings: z.record(z.string().max(64), z.unknown()).optional(),
});

export const sosCancelSchema = z.object({
  // The patient cancels via the in-app fullscreen "I'm OK" button,
  // and a guardian can cancel via the (future) guardian app. We
  // accept the actor label here so the audit trail is honest.
  by: z.enum(["patient", "guardian"]),
});

export const sosResolveSchema = z.object({
  by: z.enum(["patient", "guardian", "admin"]),
  // After-action card flag (phase3.md §M.4 SOSAfterActionCard).
  falseAlarm: z.boolean().optional(),
});

export const sosIdParamSchema = z.object({ id: z.uuid() });
