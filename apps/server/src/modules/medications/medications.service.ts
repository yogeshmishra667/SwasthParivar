import type { MedicationSchedule, MedicationLog } from "@prisma/client";
import { prisma } from "../../shared/database.js";

interface CreateSchedule {
  userId: string;
  medicineName: string;
  dosage?: string | undefined;
  timeSlots: string[];
  condition?: string | undefined;
  isCritical: boolean;
}

export const listSchedules = async (userId: string): Promise<MedicationSchedule[]> =>
  prisma.medicationSchedule.findMany({ where: { userId, active: true }, orderBy: { startedAt: "asc" } });

export const createSchedule = async (input: CreateSchedule): Promise<MedicationSchedule> =>
  prisma.medicationSchedule.create({
    data: {
      userId: input.userId,
      medicineName: input.medicineName,
      ...(input.dosage !== undefined ? { dosage: input.dosage } : {}),
      timeSlots: input.timeSlots,
      ...(input.condition !== undefined ? { condition: input.condition } : {}),
      isCritical: input.isCritical,
    },
  });

interface LogInput {
  userId: string;
  scheduleId: string;
  status: "taken" | "skipped" | "missed_no_response" | "delayed";
  scheduledFor: string;
  skipReason?: string | undefined;
}

export const logMedication = async (input: LogInput): Promise<MedicationLog> =>
  prisma.medicationLog.create({
    data: {
      userId: input.userId,
      scheduleId: input.scheduleId,
      status: input.status,
      scheduledFor: new Date(input.scheduledFor),
      respondedAt: new Date(),
      ...(input.skipReason !== undefined ? { skipReason: input.skipReason } : {}),
    },
  });

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
