import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { execSync } from "child_process";
import request from "supertest";

let postgresContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let app: any;
let prisma: any;

beforeAll(async () => {
  // 1. Start containers
  postgresContainer = await new PostgreSqlContainer("timescale/timescaledb:latest-pg16")
    .withDatabase("swasth_parivar_test")
    .start();
  
  redisContainer = await new RedisContainer("redis:7-alpine").start();

  // 2. Override environment variables for app modules
  process.env.DATABASE_URL = postgresContainer.getConnectionUri();
  process.env.REDIS_URL = redisContainer.getConnectionUrl();
  process.env.NODE_ENV = "test";

  // 3. Run Prisma Migrations on Test DB
  execSync("npx prisma migrate deploy", { 
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: "inherit"
  });
  
  // 4. Inject TimescaleDB hypertable
  execSync(`npx prisma db execute --stdin`, {
    input: "SELECT create_hypertable('glucose_readings', 'measured_at');"
  });

  // 5. Dynamically import App and DB AFTER env is set
  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  
  app = appModule.buildApp();
  prisma = dbModule.prisma;
}, 60000);

afterAll(async () => {
  if (prisma) {
    await prisma.$disconnect();
  }
  try {
    const cacheModule = await import("../../src/shared/redis.js");
    if (cacheModule.redis) await cacheModule.redis.quit();
  } catch (err) {
    // ignore
  }
  
  if (postgresContainer) {
    await postgresContainer.stop();
  }
  if (redisContainer) {
    await redisContainer.stop();
  }
});

describe("Server Integration Setup", () => {
  it("should have a healthy /health endpoint", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("should deeply check dependencies via /health/deep", async () => {
    const res = await request(app).get("/health/deep");
    expect(res.status).toBe(200);
    expect(res.body.checks.db).toBe("ok");
    expect(res.body.checks.redis).toBe("ok");
  });
});
