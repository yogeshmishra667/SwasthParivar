import { prisma } from "../../shared/database.js";
import type { UpdatePreferencesInput, UpdateProfileInput } from "./users.validation.js";

export const getProfile = async (userId: string) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      phone: true,
      age: true,
      gender: true,
      preferredLanguage: true,
      conditions: true,
      timezone: true,
      householdId: true,
      onboardingComplete: true,
      onboardingStep: true,
      tier: true,
      timeAnomalyCount: true,
      createdAt: true,
      household: { select: { primaryUserId: true } },
    },
  });

  const householdProfiles = await prisma.user.findMany({
    where: { householdId: user.householdId },
    select: { id: true, name: true, age: true, conditions: true },
    orderBy: { createdAt: "asc" },
  });

  // Mobile compares activeUserId against primaryUserId to gate
  // guardian-only UI. CLAUDE.md: "Guardian role requires login → a
  // guardian is ALWAYS a primary account."
  const { household, ...rest } = user;
  return { ...rest, primaryUserId: household?.primaryUserId ?? null, householdProfiles };
};

export const updateProfile = async (userId: string, input: UpdateProfileInput) => {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.age !== undefined) data.age = input.age;
  if (input.gender !== undefined) data.gender = input.gender;
  if (input.conditions !== undefined) data.conditions = input.conditions;
  if (input.preferredLanguage !== undefined) data.preferredLanguage = input.preferredLanguage;
  if (input.timezone !== undefined) data.timezone = input.timezone;
  if (input.onboardingStep !== undefined) data.onboardingStep = input.onboardingStep;
  if (input.onboardingComplete !== undefined) data.onboardingComplete = input.onboardingComplete;

  return await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      name: true,
      age: true,
      gender: true,
      preferredLanguage: true,
      conditions: true,
      timezone: true,
      householdId: true,
      onboardingComplete: true,
      onboardingStep: true,
    },
  });
};

// ── Preferences ─────────────────────────────────────────────────────
//
// Single source of truth lives in the `user_preferences` row. A
// missing row reads as the defaults below, which match the DB column
// defaults AND the mobile store defaults — three places, one shape.

export interface UserPreferencesView {
  theme: "light" | "dark" | "system" | "high-contrast";
  largeText: boolean;
  reduceMotion: boolean;
  checkFrequency: "daily" | "twice_weekly" | "weekly" | "biweekly" | "monthly";
  notificationsEnabled: boolean;
  reminderTime: string | null;
}

const DEFAULT_PREFERENCES: UserPreferencesView = {
  theme: "system",
  largeText: false,
  reduceMotion: false,
  checkFrequency: "daily",
  notificationsEnabled: true,
  reminderTime: "07:00",
};

const toView = (row: {
  theme: string;
  largeText: boolean;
  reduceMotion: boolean;
  checkFrequency: string;
  notificationsEnabled: boolean;
  reminderTime: string | null;
}): UserPreferencesView => ({
  theme: row.theme as UserPreferencesView["theme"],
  largeText: row.largeText,
  reduceMotion: row.reduceMotion,
  checkFrequency: row.checkFrequency as UserPreferencesView["checkFrequency"],
  notificationsEnabled: row.notificationsEnabled,
  reminderTime: row.reminderTime,
});

export const getPreferences = async (userId: string): Promise<UserPreferencesView> => {
  const row = await prisma.userPreferences.findUnique({ where: { userId } });
  return row === null ? DEFAULT_PREFERENCES : toView(row);
};

export const updatePreferences = async (
  userId: string,
  input: UpdatePreferencesInput,
): Promise<UserPreferencesView> => {
  // Strip `undefined` keys so Prisma's exact-optional input types
  // accept the partial body. `null` is preserved (used to clear
  // `reminderTime`).
  const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));

  // Upsert so the first PUT creates the row. Only fields the client
  // sent are written — column defaults handle the rest on create.
  const row = await prisma.userPreferences.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  return toView(row);
};
