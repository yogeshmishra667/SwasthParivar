// Integration tests use `any` for `app` / `prisma` / `supertest` bodies
// to match the existing convention in readings.test.ts / meals.test.ts.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import request from "supertest";
import jwt from "jsonwebtoken";

const runPrisma = (args: string[], opts: { input?: string } = {}): void => {
  const result = spawnSync("npx", ["prisma", ...args], {
    env: { ...process.env },
    stdio: opts.input ? ["pipe", "inherit", "inherit"] : "inherit",
    ...(opts.input !== undefined ? { input: opts.input } : {}),
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed (status ${result.status})`);
  }
};

let postgresContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let app: any;
let prisma: any;
let accessToken: string;
const TEST_PHONE = "+919812345681";

beforeAll(async () => {
  postgresContainer = await new PostgreSqlContainer("timescale/timescaledb:latest-pg16")
    .withDatabase("swasth_parivar_test")
    .start();
  redisContainer = await new RedisContainer("redis:7-alpine").start();

  process.env.DATABASE_URL = postgresContainer.getConnectionUri();
  process.env.REDIS_URL = redisContainer.getConnectionUrl();
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret-123";
  process.env.JWT_REFRESH_SECRET = "test-refresh-test-refresh-test-refresh-123";
  process.env.OTP_SECRET = "test-otp-test-otp-test-otp-test-otp-12345";

  runPrisma(["migrate", "deploy"]);

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;

  const household = await prisma.household.create({ data: {} });
  const user = await prisma.user.create({
    data: {
      phone: TEST_PHONE,
      name: "Food Tester",
      age: 58,
      householdId: household.id,
      onboardingComplete: true,
    },
  });
  accessToken = jwt.sign({ sub: user.id, householdId: user.householdId }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

  await prisma.indianFoodItem.createMany({
    data: [
      {
        nameEn: "Aloo paratha",
        nameHi: "आलू पराठा",
        category: "grain",
        glycemicIndex: 56,
        glycemicLoad: 28,
        commonInRegions: ["north"],
        source: "test-source",
      },
      {
        nameEn: "Aloo gobi",
        nameHi: "आलू गोभी",
        category: "vegetable",
        glycemicIndex: 60,
        glycemicLoad: 12,
        commonInRegions: ["north"],
        source: "test-source",
      },
      {
        nameEn: "Idli",
        nameHi: "इडली",
        nameRegional: { mr: "इडली-mr" },
        category: "grain",
        glycemicIndex: 69,
        glycemicLoad: 14,
        commonInRegions: ["south"],
        source: "test-source",
      },
      {
        nameEn: "Banana",
        nameHi: "केला",
        category: "fruit",
        glycemicIndex: 51,
        glycemicLoad: 13,
        commonInRegions: ["pan_india"],
        source: "test-source",
      },
    ],
  });
}, 120_000);

afterAll(async () => {
  try {
    const dbModule = await import("../../src/shared/database.js");
    await dbModule.disconnectDatabase();
  } catch {
    /* ignore */
  }
  try {
    const cacheModule = await import("../../src/shared/redis.js");
    if (cacheModule.redis) await cacheModule.redis.quit();
  } catch {
    /* ignore */
  }
  try {
    const queueModule = await import("../../src/shared/queue.js");
    await queueModule.closeQueueConnection();
  } catch {
    /* ignore */
  }
  if (postgresContainer) await postgresContainer.stop();
  if (redisContainer) await redisContainer.stop();
});

describe("GET /api/v1/foods/search", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/api/v1/foods/search?q=aloo");
    expect(res.status).toBe(401);
  });

  it("prefix-matches case-insensitively on the English name", async () => {
    const res = await request(app)
      .get("/api/v1/foods/search?q=aloo")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const names = res.body.data.data.map((f: any) => f.nameEn);
    expect(names).toContain("Aloo paratha");
    expect(names).toContain("Aloo gobi");
    expect(names).not.toContain("Banana");
  });

  it("matches on the Hindi name and returns GI/GL fields", async () => {
    const res = await request(app)
      .get(`/api/v1/foods/search?q=${encodeURIComponent("केला")}&lang=hi`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const banana = res.body.data.data.find((f: any) => f.nameEn === "Banana");
    expect(banana).toBeDefined();
    expect(banana.displayName).toBe("केला");
    expect(banana.glycemicIndex).toBe(51);
    expect(banana.glycemicLoad).toBe(13);
    expect(banana.category).toBe("fruit");
  });

  it("falls back to the English name when the regional language is missing", async () => {
    // Aloo paratha has no `mr` entry → displayName falls back to nameEn.
    const res = await request(app)
      .get("/api/v1/foods/search?q=aloo&lang=mr")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const paratha = res.body.data.data.find((f: any) => f.nameEn === "Aloo paratha");
    expect(paratha.displayName).toBe("Aloo paratha");
  });

  it("uses the regional name when present", async () => {
    const res = await request(app)
      .get("/api/v1/foods/search?q=idli&lang=mr")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const idli = res.body.data.data.find((f: any) => f.nameEn === "Idli");
    expect(idli.displayName).toBe("इडली-mr");
  });

  it("honours the limit", async () => {
    const res = await request(app)
      .get("/api/v1/foods/search?q=a&limit=1")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.data.length).toBeLessThanOrEqual(1);
  });

  it("serves a warm cache identical to the cold result", async () => {
    const url = "/api/v1/foods/search?q=aloo";
    const cold = await request(app).get(url).set("Authorization", `Bearer ${accessToken}`);
    const warm = await request(app).get(url).set("Authorization", `Bearer ${accessToken}`);
    expect(warm.status).toBe(200);
    expect(warm.body.data.data).toEqual(cold.body.data.data);
    // The cache key per §H.3 is food:search:${lang}:...
    const dbModule = await import("../../src/shared/redis.js");
    const keys = await dbModule.redis.keys("food:search:en:*");
    expect(keys.length).toBeGreaterThan(0);
  });

  it("rejects an empty query with 400", async () => {
    const res = await request(app)
      .get("/api/v1/foods/search?q=")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
  });
});
