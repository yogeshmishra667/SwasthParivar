import type { MedicationSchedule, MedicationLog } from "@prisma/client";
import { DomainError, type MedicationLogStatus } from "@swasth/shared-types";
import { prisma } from "../../shared/database.js";
import { scheduleMedReminders, cancelMedReminders } from "./medications.jobs.js";

interface CreateSchedule {
  userId: string;
  medicineName: string;
  dosage?: string | undefined;
  timeSlots: string[];
  condition?: string | undefined;
  isCritical: boolean;
}

export const listSchedules = async (userId: string): Promise<MedicationSchedule[]> =>
  await prisma.medicationSchedule.findMany({
    where: { userId, active: true },
    orderBy: { startedAt: "asc" },
  });

export const createSchedule = async (input: CreateSchedule): Promise<MedicationSchedule> => {
  const schedule = await prisma.medicationSchedule.create({
    data: {
      userId: input.userId,
      medicineName: input.medicineName,
      ...(input.dosage !== undefined ? { dosage: input.dosage } : {}),
      timeSlots: input.timeSlots,
      ...(input.condition !== undefined ? { condition: input.condition } : {}),
      isCritical: input.isCritical,
    },
  });
  await scheduleMedReminders(schedule.id, input.userId, input.timeSlots);
  return schedule;
};

interface LogInput {
  userId: string;
  scheduleId: string;
  status: MedicationLogStatus;
  scheduledFor: string;
  skipReason?: string | undefined;
}

export const logMedication = async (input: LogInput): Promise<MedicationLog> =>
  await prisma.medicationLog.create({
    data: {
      userId: input.userId,
      scheduleId: input.scheduleId,
      status: input.status,
      scheduledFor: new Date(input.scheduledFor),
      respondedAt: new Date(),
      ...(input.skipReason !== undefined ? { skipReason: input.skipReason } : {}),
    },
  });

export const deleteSchedule = async (params: { userId: string; id: string }): Promise<void> => {
  const existing = await prisma.medicationSchedule.findFirst({
    where: { id: params.id, userId: params.userId },
  });
  if (!existing) {
    throw new DomainError("MED_SCHEDULE_NOT_FOUND", "schedule does not exist");
  }
  await prisma.medicationSchedule.update({
    where: { id: existing.id },
    data: { active: false },
  });
  await cancelMedReminders(existing.id, existing.timeSlots as string[]);
};

export const adherenceLast = async (
  userId: string,
  days: number,
): Promise<{ taken: number; missed: number; skipped: number; rate: number }> => {
  const since = new Date(Date.now() - days * 86_400_000);
  const logs = await prisma.medicationLog.findMany({
    where: { userId, scheduledFor: { gte: since } },
  });
  const taken = logs.filter((l) => l.status === "taken").length;
  const missed = logs.filter((l) => l.status === "missed_no_response").length;
  const skipped = logs.filter((l) => l.status === "skipped").length;
  const total = taken + missed + skipped;
  return { taken, missed, skipped, rate: total === 0 ? 0 : taken / total };
};
