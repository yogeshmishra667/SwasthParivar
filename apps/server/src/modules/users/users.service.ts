import { prisma } from "../../shared/database.js";
import type { UpdateProfileInput } from "./users.validation.js";

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
