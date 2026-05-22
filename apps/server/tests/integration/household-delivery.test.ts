// Stage 1 — household-scoped push delivery resolution.
//
// A shared phone registers ONE push token, always under the household
// primary. These tests prove a non-primary profile still resolves that
// shared device, and that a single-profile household is unaffected.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const runPrisma = (args: string[]): void => {
  const result = spawnSync("npx", ["prisma", ...args], {
    env: { ...process.env },
    stdio: "inherit",
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed (status ${result.status})`);
  }
};

let postgresContainer: StartedPostgreSqlContainer;
let prisma: any;
let resolveHouseholdDelivery: (
  userId: string,
) => Promise<{ memberIds: string[]; tokens: string[] }>;
let householdUserIds: (userId: string) => Promise<string[]>;

// Shared household: a primary (with the device token) + a non-primary
// profile. Solo household: one user, no token.
let primaryId: string;
let secondaryId: string;
let soloId: string;
const PRIMARY_TOKEN = "ExponentPushToken[shared-device-xyz]";

beforeAll(async () => {
  postgresContainer = await new PostgreSqlContainer("timescale/timescaledb:latest-pg16")
    .withDatabase("swasth_parivar_test")
    .start();
  process.env.DATABASE_URL = postgresContainer.getConnectionUri();
  process.env.NODE_ENV = "test";

  runPrisma(["migrate", "deploy"]);

  const dbModule = await import("../../src/shared/database.js");
  const deliveryModule = await import("../../src/shared/notifications/household-delivery.js");
  prisma = dbModule.prisma;
  resolveHouseholdDelivery = deliveryModule.resolveHouseholdDelivery;
  householdUserIds = deliveryModule.householdUserIds;

  const sharedHousehold = await prisma.household.create({ data: {} });
  const primary = await prisma.user.create({
    data: {
      phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      name: "Papa",
      age: 66,
      householdId: sharedHousehold.id,
      onboardingComplete: true,
    },
  });
  const secondary = await prisma.user.create({
    data: {
      phone: `household:${primary.id}:maa`,
      name: "Maa",
      age: 63,
      householdId: sharedHousehold.id,
      onboardingComplete: true,
    },
  });
  // The single device token registers under the primary only.
  await prisma.pushToken.create({
    data: { userId: primary.id, token: PRIMARY_TOKEN, platform: "android" },
  });

  const soloHousehold = await prisma.household.create({ data: {} });
  const solo = await prisma.user.create({
    data: {
      phone: `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      name: "Solo",
      age: 55,
      householdId: soloHousehold.id,
      onboardingComplete: true,
    },
  });

  primaryId = primary.id;
  secondaryId = secondary.id;
  soloId = solo.id;
}, 120_000);

afterAll(async () => {
  try {
    const dbModule = await import("../../src/shared/database.js");
    await dbModule.disconnectDatabase();
  } catch {
    /* ignore */
  }
  if (postgresContainer) await postgresContainer.stop();
});

describe("householdUserIds", () => {
  it("returns every member of a shared household, queried from any profile", async () => {
    const fromPrimary = await householdUserIds(primaryId);
    const fromSecondary = await householdUserIds(secondaryId);
    expect([...fromPrimary].sort()).toEqual([primaryId, secondaryId].sort());
    // Identical result regardless of which profile asked.
    expect([...fromSecondary].sort()).toEqual([primaryId, secondaryId].sort());
  });

  it("returns just the user for a single-profile household", async () => {
    expect(await householdUserIds(soloId)).toEqual([soloId]);
  });

  it("falls back to [userId] for an unknown user", async () => {
    const ghost = randomUUID();
    expect(await householdUserIds(ghost)).toEqual([ghost]);
  });
});

describe("resolveHouseholdDelivery", () => {
  it("resolves the shared device token for a NON-primary profile", async () => {
    const delivery = await resolveHouseholdDelivery(secondaryId);
    // The token belongs to the primary, yet Maa's notification reaches it.
    expect(delivery.tokens).toContain(PRIMARY_TOKEN);
    expect([...delivery.memberIds].sort()).toEqual([primaryId, secondaryId].sort());
  });

  it("resolves the same device token for the primary (unchanged behaviour)", async () => {
    const delivery = await resolveHouseholdDelivery(primaryId);
    expect(delivery.tokens).toEqual([PRIMARY_TOKEN]);
  });

  it("returns no tokens for a household with no registered device", async () => {
    const delivery = await resolveHouseholdDelivery(soloId);
    expect(delivery.tokens).toEqual([]);
    expect(delivery.memberIds).toEqual([soloId]);
  });
});
