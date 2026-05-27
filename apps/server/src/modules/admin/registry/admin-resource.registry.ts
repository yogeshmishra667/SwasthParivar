// AdminResourceRegistry — the registered user-scoped domain entities.
//
// The admin user-detail view (modules/admin/users) iterates this list to
// build the 360° view of a patient. To expose a new entity — including
// the Phase 4 additions (CardiacLog, RespiratoryLog, Prescription,
// DoctorAppointment, ActivityDaily, SleepLog) — add ONE entry here. No
// controller, route, or registry-type change is needed.

import { prisma } from "../../../shared/database.js";
import type {
  AdminResource,
  AdminResourcePage,
  AdminResourceQuery,
} from "./admin-resource.types.js";

const buildPage = (rows: unknown[], total: number, offset: number): AdminResourcePage => ({
  rows,
  total,
  hasMore: offset + rows.length < total,
});

// Registration order = display order in the console.
const RESOURCES: readonly AdminResource[] = [
  {
    key: "glucose_readings",
    label: "Glucose readings",
    description: "All glucose readings, newest first.",
    sensitive: true,
    fetch: async (userId, { limit, offset }: AdminResourceQuery) => {
      const [rows, total] = await Promise.all([
        prisma.glucoseReading.findMany({
          where: { userId },
          orderBy: { measuredAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.glucoseReading.count({ where: { userId } }),
      ]);
      return buildPage(rows, total, offset);
    },
  },
  {
    key: "bp_readings",
    label: "Blood-pressure readings",
    description: "All BP readings, newest first.",
    sensitive: true,
    fetch: async (userId, { limit, offset }: AdminResourceQuery) => {
      const [rows, total] = await Promise.all([
        prisma.bPReading.findMany({
          where: { userId },
          orderBy: { measuredAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.bPReading.count({ where: { userId } }),
      ]);
      return buildPage(rows, total, offset);
    },
  },
  {
    key: "meal_logs",
    label: "Meal logs",
    description: "Logged meals with category, newest first.",
    sensitive: true,
    fetch: async (userId, { limit, offset }: AdminResourceQuery) => {
      const [rows, total] = await Promise.all([
        prisma.mealLog.findMany({
          where: { userId },
          orderBy: { loggedAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.mealLog.count({ where: { userId } }),
      ]);
      return buildPage(rows, total, offset);
    },
  },
  {
    key: "medication_schedules",
    label: "Medication schedules",
    description: "Configured medicines and their time slots.",
    sensitive: true,
    fetch: async (userId, { limit, offset }: AdminResourceQuery) => {
      const [rows, total] = await Promise.all([
        prisma.medicationSchedule.findMany({
          where: { userId },
          orderBy: { startedAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.medicationSchedule.count({ where: { userId } }),
      ]);
      return buildPage(rows, total, offset);
    },
  },
  {
    key: "medication_logs",
    label: "Medication logs",
    description: "Per-dose taken / skipped / missed history.",
    sensitive: true,
    fetch: async (userId, { limit, offset }: AdminResourceQuery) => {
      const [rows, total] = await Promise.all([
        prisma.medicationLog.findMany({
          where: { userId },
          orderBy: { scheduledFor: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.medicationLog.count({ where: { userId } }),
      ]);
      return buildPage(rows, total, offset);
    },
  },
  {
    key: "insight_events",
    label: "Insights",
    description: "Detector-generated insight events, newest first.",
    sensitive: true,
    fetch: async (userId, { limit, offset }: AdminResourceQuery) => {
      const [rows, total] = await Promise.all([
        prisma.insightEvent.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.insightEvent.count({ where: { userId } }),
      ]);
      return buildPage(rows, total, offset);
    },
  },
  {
    key: "health_scores",
    label: "Health scores",
    description: "Daily computed health score, newest first.",
    sensitive: true,
    fetch: async (userId, { limit, offset }: AdminResourceQuery) => {
      const [rows, total] = await Promise.all([
        prisma.healthScore.findMany({
          where: { userId },
          orderBy: { computedForDate: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.healthScore.count({ where: { userId } }),
      ]);
      return buildPage(rows, total, offset);
    },
  },
  {
    key: "chat_sessions",
    label: "Chat sessions",
    description: "AI chat sessions, newest first.",
    sensitive: true,
    fetch: async (userId, { limit, offset }: AdminResourceQuery) => {
      const [rows, total] = await Promise.all([
        prisma.chatSession.findMany({
          where: { userId },
          orderBy: { startedAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.chatSession.count({ where: { userId } }),
      ]);
      return buildPage(rows, total, offset);
    },
  },
  {
    key: "chat_messages",
    label: "Chat messages",
    description: "AI chat message history, newest first.",
    sensitive: true,
    fetch: async (userId, { limit, offset }: AdminResourceQuery) => {
      const [rows, total] = await Promise.all([
        prisma.chatMessage.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.chatMessage.count({ where: { userId } }),
      ]);
      return buildPage(rows, total, offset);
    },
  },
  {
    key: "silent_guardian_signals",
    label: "Silent Guardian signals",
    description: "Detected risk signals about this patient.",
    sensitive: true,
    fetch: async (userId, { limit, offset }: AdminResourceQuery) => {
      const [rows, total] = await Promise.all([
        prisma.silentGuardianSignal.findMany({
          where: { userId },
          orderBy: { detectedAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.silentGuardianSignal.count({ where: { userId } }),
      ]);
      return buildPage(rows, total, offset);
    },
  },
  {
    key: "guardian_alerts",
    label: "Guardian alerts",
    description: "Alerts fired to this patient's guardians.",
    sensitive: true,
    fetch: async (userId, { limit, offset }: AdminResourceQuery) => {
      const [rows, total] = await Promise.all([
        prisma.guardianAlert.findMany({
          where: { patientId: userId },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.guardianAlert.count({ where: { patientId: userId } }),
      ]);
      return buildPage(rows, total, offset);
    },
  },
  {
    key: "family_links",
    label: "Family links",
    description: "Guardian relationships where this user is the patient.",
    sensitive: false,
    fetch: async (userId, { limit, offset }: AdminResourceQuery) => {
      const [rows, total] = await Promise.all([
        prisma.familyLink.findMany({
          where: { patientId: userId },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.familyLink.count({ where: { patientId: userId } }),
      ]);
      return buildPage(rows, total, offset);
    },
  },
  {
    key: "emergency_contacts",
    label: "Emergency contacts",
    description: "Critical-bypass contacts, by priority.",
    sensitive: true,
    fetch: async (userId, { limit, offset }: AdminResourceQuery) => {
      const [rows, total] = await Promise.all([
        prisma.emergencyContact.findMany({
          where: { userId },
          orderBy: { priority: "asc" },
          take: limit,
          skip: offset,
        }),
        prisma.emergencyContact.count({ where: { userId } }),
      ]);
      return buildPage(rows, total, offset);
    },
  },
  {
    key: "push_tokens",
    label: "Push tokens",
    description: "Registered Expo push tokens / devices.",
    sensitive: false,
    fetch: async (userId, { limit, offset }: AdminResourceQuery) => {
      const [rows, total] = await Promise.all([
        prisma.pushToken.findMany({
          where: { userId },
          orderBy: { lastSeenAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.pushToken.count({ where: { userId } }),
      ]);
      return buildPage(rows, total, offset);
    },
  },
];

/** All registered resources, in display order. */
export const adminResources = (): readonly AdminResource[] => RESOURCES;

/** Look up one resource by key; undefined when the key is unknown. */
export const getAdminResource = (key: string): AdminResource | undefined =>
  RESOURCES.find((r) => r.key === key);
