// Phase 4 Feature D' — SOS module DTOs.
//
// Kept local for now; promote into @swasth/shared-types when the
// mobile screens (phase3.md §M.4) start consuming them.

import type { SOSStage, SOSTriggerSource } from "@swasth/domain-logic";

/** Body for POST /api/v1/sos/trigger. */
export interface SOSTriggerInput {
  /** Mobile-side dedup. Same press fired twice collapses to one row. */
  clientUuid: string;
  /** Why the SOS fired. Phase 4 ships `patient_manual` only; the
   * other two routes are flag-gated until §D'.2 lands. */
  source: SOSTriggerSource;
  /** Optional location snapshot. Degraded GPS must NOT block the
   * trigger. */
  locationLat?: number;
  locationLng?: number;
  locationAccuracyM?: number;
  /** Free-form per-condition last reading snapshot. The dispatcher
   * uses this to build the SMS "context" line. */
  lastReadings?: Record<string, unknown>;
}

export interface EmergencyContactDto {
  id: string;
  name: string;
  phone: string;
  relationship: string;
  priority: number;
  isGuardian: boolean;
}

/** Response from /trigger + /resolve + /cancel + GET /active. */
export interface SOSEventDto {
  id: string;
  userId: string;
  triggeredAt: string;
  triggerSource: SOSTriggerSource;
  escalationStage: SOSStage;
  testMode: boolean;
  cancelledAt: string | null;
  cancelledBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  falseAlarm: boolean;
}
