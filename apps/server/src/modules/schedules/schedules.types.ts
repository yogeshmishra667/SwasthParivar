// Phase 2 carry-over (Week 17) — schedules surface DTOs.
//
// The wire shape mirrors `ScheduleInput` from the pure module but
// keeps the `userId` server-resolved (not sent by the client) and
// flattens the persisted timezone offset for the JSON response.

import type {
  ScheduleCheckType,
  ScheduleFrequency,
  ScheduledSlot,
  ComplianceStatus,
} from "@swasth/domain-logic";

export type { ScheduleCheckType, ScheduleFrequency, ScheduledSlot, ComplianceStatus };

export interface ScheduleDto {
  id: string;
  checkType: ScheduleCheckType;
  frequency: ScheduleFrequency;
  scheduledTimes: ScheduledSlot[];
  reminderEnabled: boolean;
  active: boolean;
  createdAtIso: string;
  updatedAtIso: string;
}

/** Compact compliance snapshot returned alongside each schedule on
 * GET so the mobile UI doesn't need a second round-trip. */
export interface ScheduleComplianceSummary {
  scheduleId: string;
  nextDueAtIso: string | null;
  recentSlots: {
    expectedAtIso: string;
    status: ComplianceStatus;
    matchedReadingId?: string;
  }[];
  onTimeCount: number;
  lateCount: number;
  missedCount: number;
  pendingCount: number;
}

export interface ScheduleListItem extends ScheduleDto {
  compliance: ScheduleComplianceSummary;
}
