// Phase 4 Feature D' — SOS client. Wraps the /api/v1/sos endpoints.
//
// API surface mirrors the server `SOSEventDto` (apps/server/src/modules/
// sos/sos.types.ts). DTOs are duplicated here rather than imported
// from `@swasth/shared-types` because the server module didn't promote
// them yet (deliberate — keep the surface tight until mobile + admin
// both consume).
//
// Failure mode for SOS is asymmetric vs other clients:
//  - listGuardianAlerts: failure → empty page (read fallback OK).
//  - SOS trigger: failure MUST surface to the caller. A silent
//    fallback would leave the patient thinking help is coming when
//    it isn't. The caller renders an "unavailable, dial directly"
//    error path on throw.

import { api } from "@/services/api";
import { logError } from "@/services/analytics";

export type SOSStage =
  | "stage_0_fullscreen"
  | "stage_1_auto_dial"
  | "stage_2_ivr_call"
  | "stage_3_all_contacts"
  | "resolved"
  | "cancelled";

export type SOSTriggerSource =
  | "patient_manual"
  | "critical_bypass_escalation"
  | "guardian_initiated";

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

export interface SOSTriggerInput {
  clientUuid: string;
  source: "patient_manual";
  locationLat?: number;
  locationLng?: number;
  locationAccuracyM?: number;
  lastReadings?: Record<string, unknown>;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

/**
 * Fire the SOS chain. Throws on network / 5xx / kill switch — the
 * caller MUST surface the failure so the patient knows to dial
 * directly. Idempotent server-side on `clientUuid`.
 */
export const triggerSOS = async (input: SOSTriggerInput): Promise<SOSEventDto> => {
  const res = await api.post<ApiEnvelope<SOSEventDto>>("/sos/trigger", input);
  return res.data;
};

export const cancelSOS = async (
  sosEventId: string,
  by: "patient" | "guardian" = "patient",
): Promise<SOSEventDto | null> => {
  try {
    const res = await api.post<ApiEnvelope<SOSEventDto>>(`/sos/${sosEventId}/cancel`, { by });
    return res.data;
  } catch (err) {
    logError("cancelSOS", err);
    return null;
  }
};

export const resolveSOS = async (
  sosEventId: string,
  by: "patient" | "guardian" = "patient",
  falseAlarm?: boolean,
): Promise<SOSEventDto | null> => {
  try {
    const res = await api.post<ApiEnvelope<SOSEventDto>>(`/sos/${sosEventId}/resolve`, {
      by,
      ...(falseAlarm !== undefined ? { falseAlarm } : {}),
    });
    return res.data;
  } catch (err) {
    logError("resolveSOS", err);
    return null;
  }
};

/**
 * Returns the most-recent non-terminal SOS for the authenticated user.
 * Used on app foreground to re-render the fullscreen alert if the app
 * was backgrounded mid-escalation.
 */
export const getActiveSOS = async (): Promise<SOSEventDto | null> => {
  try {
    const res = await api.get<ApiEnvelope<{ active: SOSEventDto | null }>>("/sos/active");
    return res.data.active;
  } catch (err) {
    logError("getActiveSOS", err);
    return null;
  }
};

export interface EmergencyContactDto {
  id: string;
  name: string;
  phone: string;
  relationship: string;
  priority: number;
  isGuardian: boolean;
}

/**
 * Patient's emergency contacts, sorted by priority. Read fallback:
 * a fetch failure returns an empty list rather than throwing — the
 * SOS screen falls back to the generic dialer button when the
 * primary contact is unknown.
 */
export const listEmergencyContacts = async (): Promise<EmergencyContactDto[]> => {
  try {
    const res = await api.get<ApiEnvelope<{ contacts: EmergencyContactDto[] }>>("/sos/contacts");
    return res.data.contacts;
  } catch (err) {
    logError("listEmergencyContacts", err);
    return [];
  }
};
