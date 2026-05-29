// Phase 2 carry-over (Week 17) — health-check schedules surface.
//
// CRUD over `HealthCheckSchedule`, plus a `list` helper that joins
// each row with a compact compliance snapshot (last 7 slots + next
// due) so the mobile screen renders without a second round-trip.
//
// All writes go through `resolveHouseholdMember`, mirroring the
// readings/meds modules — the household primary edits a sub-profile's
// schedule via `targetUserId`.

import { DomainError } from "@swasth/shared-types";
import {
  evaluateCompliance,
  type ScheduleInput,
  type ReadingForCompliance,
  type ScheduledSlot,
  type ScheduleCheckType,
} from "@swasth/domain-logic";
import type { HealthCheckSchedule, HealthCheckComplianceStatus } from "@prisma/client";

import { prisma } from "../../shared/database.js";
import { capture } from "../../shared/analytics/posthog.js";
import type { CreateScheduleInput, UpdateScheduleInput } from "./schedules.validation.js";
import type {
  ScheduleDto,
  ScheduleListItem,
  ScheduleComplianceSummary,
} from "./schedules.types.js";

const dayMs = 86_400_000;

// IANA → offset minutes at a given instant. Used by the pure
// evaluator so it can stay free of Intl-dependent date math.
//
// Falls back to IST (330) on parse failure — every onboarded user
// has a timezone, and the format is fixed by Intl, so the fallback
// is defence-in-depth.
export const tzOffsetMinutes = (ianaTz: string, atUtcMs: number = Date.now()): number => {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: ianaTz,
      timeZoneName: "longOffset",
    });
    const parts = fmt.formatToParts(new Date(atUtcMs));
    const off = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+05:30";
    if (off === "GMT") return 0;
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(off);
    if (!m) return 330;
    const sign = m[1] === "+" ? 1 : -1;
    return sign * (Number(m[2]) * 60 + Number(m[3]));
  } catch {
    return 330;
  }
};

const isScheduledSlot = (v: unknown): v is ScheduledSlot => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.hour === "number" && typeof o.minute === "number";
};

/** Validate + narrow a JSON `scheduledTimes` blob from Prisma. */
export const parseScheduledTimes = (raw: unknown): ScheduledSlot[] => {
  if (!Array.isArray(raw)) {
    throw new DomainError("SCHEDULE_INVALID", "scheduledTimes is not an array");
  }
  if (!raw.every(isScheduledSlot)) {
    throw new DomainError("SCHEDULE_INVALID", "scheduledTimes contains malformed slots");
  }
  return raw;
};

const toDto = (row: HealthCheckSchedule): ScheduleDto => ({
  id: row.id,
  checkType: row.checkType,
  frequency: row.frequency,
  scheduledTimes: parseScheduledTimes(row.scheduledTimes),
  reminderEnabled: row.reminderEnabled,
  active: row.active,
  createdAtIso: row.createdAt.toISOString(),
  updatedAtIso: row.updatedAt.toISOString(),
});

const fetchReadingsForCheckType = async (
  userId: string,
  checkType: ScheduleCheckType,
  windowStartIso: string,
): Promise<ReadingForCompliance[]> => {
  const startDate = new Date(windowStartIso);
  if (checkType === "glucose") {
    const rows = await prisma.glucoseReading.findMany({
      where: { userId, measuredAt: { gte: startDate } },
      select: { id: true, measuredAt: true },
      orderBy: { measuredAt: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      measuredAtIso: r.measuredAt.toISOString(),
      checkType: "glucose" as const,
    }));
  }
  if (checkType === "bp") {
    const rows = await prisma.bPReading.findMany({
      where: { userId, measuredAt: { gte: startDate } },
      select: { id: true, measuredAt: true },
      orderBy: { measuredAt: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      measuredAtIso: r.measuredAt.toISOString(),
      checkType: "bp" as const,
    }));
  }
  // Cardiac + respiratory are Phase 4 Feature E.1 — tables don't
  // exist yet. Return empty so a forward-compatible schedule (e.g. an
  // admin pre-creating cadence) still evaluates as all-pending.
  return [];
};

export const createSchedule = async (
  userId: string,
  input: CreateScheduleInput,
): Promise<ScheduleDto> => {
  const row = await prisma.healthCheckSchedule.create({
    data: {
      userId,
      checkType: input.checkType,
      frequency: input.frequency,
      scheduledTimes: input.scheduledTimes,
      reminderEnabled: input.reminderEnabled,
      active: input.active,
    },
  });
  capture("schedule_created", userId, {
    schedule_id: row.id,
    check_type: input.checkType,
    frequency: input.frequency,
    slot_count: input.scheduledTimes.length,
    reminder_enabled: input.reminderEnabled,
  });
  return toDto(row);
};

export const updateSchedule = async (
  userId: string,
  scheduleId: string,
  input: UpdateScheduleInput,
): Promise<ScheduleDto> => {
  const existing = await prisma.healthCheckSchedule.findUnique({
    where: { id: scheduleId },
    select: { id: true, userId: true, frequency: true },
  });
  if (existing?.userId !== userId) {
    throw new DomainError("SCHEDULE_NOT_FOUND", "schedule not found");
  }

  const fieldsChanged: string[] = [];
  const data: Record<string, unknown> = {};
  if (input.scheduledTimes !== undefined) {
    if (existing.frequency === "weekly") {
      input.scheduledTimes.forEach((s, idx) => {
        if (s.dayOfWeek === undefined) {
          throw new DomainError(
            "SCHEDULE_INVALID",
            `weekly schedules require dayOfWeek (slot ${idx})`,
          );
        }
      });
    }
    data.scheduledTimes = input.scheduledTimes;
    fieldsChanged.push("scheduledTimes");
  }
  if (input.reminderEnabled !== undefined) {
    data.reminderEnabled = input.reminderEnabled;
    fieldsChanged.push("reminderEnabled");
  }
  if (input.active !== undefined) {
    data.active = input.active;
    fieldsChanged.push("active");
  }

  const row = await prisma.healthCheckSchedule.update({
    where: { id: scheduleId },
    data,
  });
  capture("schedule_updated", userId, {
    schedule_id: row.id,
    active: row.active,
    fields_changed: fieldsChanged,
  });
  return toDto(row);
};

const summarizeFromDb = async (
  scheduleId: string,
  userId: string,
  nextDueAtIso: string | null,
): Promise<ScheduleComplianceSummary> => {
  // Last 7 days of compliance — matches the GET /api/v1/schedules
  // dashboard surface; the cron worker has already UPSERTed these
  // rows from the pure evaluator.
  const since = new Date(Date.now() - 7 * dayMs);
  const rows = await prisma.healthCheckCompliance.findMany({
    where: { scheduleId, userId, expectedAt: { gte: since } },
    orderBy: { expectedAt: "desc" },
    take: 50,
    select: { expectedAt: true, status: true, readingId: true },
  });
  const counts = rows.reduce(
    (acc, r) => {
      const s = r.status;
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    },
    {} as Record<HealthCheckComplianceStatus, number>,
  );
  return {
    scheduleId,
    nextDueAtIso,
    recentSlots: rows.map((r) => ({
      expectedAtIso: r.expectedAt.toISOString(),
      status: r.status,
      ...(r.readingId ? { matchedReadingId: r.readingId } : {}),
    })),
    onTimeCount: counts.on_time ?? 0,
    lateCount: counts.late ?? 0,
    missedCount: counts.missed ?? 0,
    pendingCount: counts.pending ?? 0,
  };
};

export const dtoToScheduleInput = (
  dto: ScheduleDto,
  userTzOffsetMinutes: number,
): ScheduleInput => ({
  id: dto.id,
  checkType: dto.checkType,
  frequency: dto.frequency,
  scheduledTimes: dto.scheduledTimes,
  active: dto.active,
  userTzOffsetMinutes,
});

export const listSchedules = async (userId: string): Promise<ScheduleListItem[]> => {
  const [user, schedules] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    }),
    prisma.healthCheckSchedule.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!user) {
    throw new DomainError("FAMILY_NO_ACCESS", "user not found");
  }
  const offset = tzOffsetMinutes(user.timezone);
  const nowIso = new Date().toISOString();
  const windowStartIso = new Date(Date.now() - 7 * dayMs).toISOString();

  return await Promise.all(
    schedules.map(async (s) => {
      const dto = toDto(s);
      // nextDueAtIso is cheap to compute live (no DB) — we pass an
      // empty readings list because we only need the next *future*
      // slot, which `evaluateCompliance` derives from the schedule
      // recurrence rule alone.
      const evalResult = evaluateCompliance({
        schedule: dtoToScheduleInput(dto, offset),
        readings: [],
        windowStartIso,
        nowIso,
      });
      const compliance = await summarizeFromDb(s.id, userId, evalResult.nextDueAtIso);
      return { ...dto, compliance };
    }),
  );
};

/** Used by the SCHEDULE_COMPLIANCE_CHECK worker. Pure-input
 * preparation for one schedule + persistence of the result. */
export const evaluateAndPersist = async (
  userId: string,
  schedule: HealthCheckSchedule,
  userTimezone: string,
  nowIso: string,
): Promise<{ onTime: number; late: number; missed: number; pending: number }> => {
  const dto = toDto(schedule);
  const offset = tzOffsetMinutes(userTimezone, new Date(nowIso).getTime());
  const windowStartIso = new Date(new Date(nowIso).getTime() - dayMs).toISOString();
  const readings = await fetchReadingsForCheckType(userId, dto.checkType, windowStartIso);
  const result = evaluateCompliance({
    schedule: dtoToScheduleInput(dto, offset),
    readings,
    windowStartIso,
    nowIso,
  });

  // Persist each slot via UPSERT keyed on (scheduleId, expectedAt).
  // Idempotent across cron re-runs: status flips from pending → on_time
  // when a matching reading arrives; never the other direction.
  for (const slot of result.slots) {
    await prisma.healthCheckCompliance.upsert({
      where: {
        scheduleId_expectedAt: {
          scheduleId: schedule.id,
          expectedAt: new Date(slot.expectedAtIso),
        },
      },
      create: {
        scheduleId: schedule.id,
        userId,
        expectedAt: new Date(slot.expectedAtIso),
        completedAt: slot.matchedReadingIso ? new Date(slot.matchedReadingIso) : null,
        readingId: slot.matchedReadingId ?? null,
        status: slot.status,
      },
      update: {
        completedAt: slot.matchedReadingIso ? new Date(slot.matchedReadingIso) : null,
        readingId: slot.matchedReadingId ?? null,
        status: slot.status,
      },
    });
  }

  return {
    onTime: result.onTimeCount,
    late: result.lateCount,
    missed: result.missedCount,
    pending: result.pendingCount,
  };
};
