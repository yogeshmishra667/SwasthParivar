import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import request from "supertest";

const ADMIN_TOKEN = "admin-token-admin-token-admin-token-12";

let redisContainer: StartedRedisContainer;
// Using any for app + module imports — supertest + dynamic-import returns
// untyped surfaces and this matches the pattern in readings.test.ts.
let app: any;

beforeAll(async () => {
  redisContainer = await new RedisContainer("redis:7-alpine").start();

  process.env.REDIS_URL = redisContainer.getConnectionUrl();
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:65432/stub";
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret-123";
  process.env.JWT_REFRESH_SECRET = "test-refresh-test-refresh-test-refresh-123";
  process.env.OTP_SECRET = "test-otp-test-otp-test-otp-test-otp-12345";
  process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;

  const appModule = await import("../../src/app.js");
  app = appModule.buildApp();

  const { __resetFlagCache } = await import("../../src/shared/flags/index.js");
  __resetFlagCache();
}, 60_000);

afterAll(async () => {
  try {
    const cacheModule = await import("../../src/shared/redis.js");
    if (cacheModule.redis) await cacheModule.redis.quit();
  } catch {
    /* ignore */
  }
  if (redisContainer) await redisContainer.stop();
});

describe("Admin flag service", () => {
  it("rejects missing admin token with 403", async () => {
    const res = await request(app).get("/admin/flags");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AUTH_UNAUTHORIZED");
  });

  it("rejects wrong admin token with 403", async () => {
    const res = await request(app)
      .get("/admin/flags")
      .set("Authorization", "Bearer not-the-real-token-not-the-real-token");
    expect(res.status).toBe(403);
  });

  it("PUT then GET returns the set value, audit log captures the change", async () => {
    const put = await request(app)
      .put("/admin/flags/otp_provider")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .set("X-Admin-Actor", "operator-yogesh")
      .send({ value: "sms" });
    expect(put.status).toBe(200);
    expect(put.body.data.newValue).toBe("sms");
    expect(put.body.data.prevValue).toBeNull();

    const get = await request(app)
      .get("/admin/flags/otp_provider")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(get.status).toBe(200);
    expect(get.body.data.value).toBe("sms");

    const audit = await request(app)
      .get("/admin/flags/otp_provider/audit")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(audit.status).toBe(200);
    expect(audit.body.data.records).toHaveLength(1);
    expect(audit.body.data.records[0].by).toBe("operator-yogesh");
    expect(audit.body.data.records[0].newValue).toBe("sms");
  });

  it("supports boolean + object values", async () => {
    await request(app)
      .put("/admin/flags/sms_msg91_enabled")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ value: false });

    await request(app)
      .put("/admin/flags/notification_caps")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ value: { daily: 2, peak_hour: 1 } });

    const list = await request(app)
      .get("/admin/flags")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(list.status).toBe(200);
    expect(list.body.data.flags.sms_msg91_enabled).toBe(false);
    expect(list.body.data.flags.notification_caps).toEqual({ daily: 2, peak_hour: 1 });
  });

  it("rejects invalid flag key with 400", async () => {
    const res = await request(app)
      .put("/admin/flags/INVALID-KEY")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ value: true });
    expect(res.status).toBe(400);
  });

  it("getFlag returns the default when key is unset", async () => {
    const { getFlag } = await import("../../src/shared/flags/index.js");
    const result = await getFlag<boolean>("never_set_key", true);
    expect(result).toBe(true);
  });
});
