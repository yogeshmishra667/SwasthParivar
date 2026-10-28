import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawn, spawnSync } from "node:child_process";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { generateSecret, generateSync } from "otplib";

// `scripts/admin-token.mjs` is what the ops runbooks (rollback.md §2/§3,
// HOWTO.md) tell on-call to run during an incident to get a Bearer token.
// It must keep working against the real login + 2FA flow, so this drives
// it end to end against the app on a real port.

const SCRIPT = fileURLToPath(new URL("../../../../scripts/admin-token.mjs", import.meta.url));

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
let server: Server;
let api: string;
let prisma: any;

// Async spawn, not spawnSync: the app answers the script from this same
// process, so blocking the event loop would deadlock.
const runScript = (
  stdin: string,
  env: Record<string, string>,
): Promise<{ status: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, "--api", api], {
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(stdin);
  });

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
  process.env.ADMIN_JWT_SECRET = "test-admin-secret-test-admin-secret-123";
  process.env.ADMIN_JWT_REFRESH_SECRET = "test-admin-refresh-secret-test-123";

  runPrisma(["migrate", "deploy"]);

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  prisma = dbModule.prisma;
  server = appModule.buildApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
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
  if (postgresContainer) await postgresContainer.stop();
  if (redisContainer) await redisContainer.stop();
});

const seedAdmin = async (
  email: string,
  password: string,
  totpSecret: string | null,
): Promise<void> => {
  await prisma.adminUser.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 10),
      name: "On-call",
      role: "ops",
      active: true,
      totpEnabled: totpSecret !== null,
      totpSecret,
    },
  });
};

describe("scripts/admin-token.mjs", () => {
  it("prints only an access token that authorises admin routes", async () => {
    const totpSecret = generateSecret();
    await seedAdmin("oncall@example.com", "StrongPassword123!", totpSecret);

    const { status, stdout, stderr } = await runScript(
      `StrongPassword123!\n${generateSync({ secret: totpSecret })}\n`,
      { ADMIN_EMAIL: "oncall@example.com" },
    );

    expect(status, stderr).toBe(0);
    const token = stdout.trim();
    expect(token.split(".")).toHaveLength(3);
    // The password is never echoed, on either stream.
    expect(stdout + stderr).not.toContain("StrongPassword123!");

    const res = await fetch(`${api}/admin/flags`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("asks for the email when ADMIN_EMAIL is unset", async () => {
    const totpSecret = generateSecret();
    await seedAdmin("prompted@example.com", "StrongPassword123!", totpSecret);

    const { status, stdout, stderr } = await runScript(
      `prompted@example.com\nStrongPassword123!\n${generateSync({ secret: totpSecret })}\n`,
      { ADMIN_EMAIL: "" },
    );

    expect(status, stderr).toBe(0);
    expect(stderr).toContain("Admin email:");
    expect(stdout.trim().split(".")).toHaveLength(3);
  });

  it("exits 1 with nothing on stdout for a wrong password", async () => {
    await seedAdmin("wrongpw@example.com", "StrongPassword123!", generateSecret());

    const { status, stdout, stderr } = await runScript("not-the-password\n000000\n", {
      ADMIN_EMAIL: "wrongpw@example.com",
    });

    expect(status).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("ADMIN_INVALID_CREDENTIALS");
  });

  it("exits 1 for a wrong 2FA code", async () => {
    await seedAdmin("wrongcode@example.com", "StrongPassword123!", generateSecret());

    const { status, stdout } = await runScript("StrongPassword123!\n000000\n", {
      ADMIN_EMAIL: "wrongcode@example.com",
    });

    expect(status).toBe(1);
    expect(stdout).toBe("");
  });

  it("tells an account without 2FA to enrol in the console first", async () => {
    await seedAdmin("noenrol@example.com", "StrongPassword123!", null);

    const { status, stdout, stderr } = await runScript("StrongPassword123!\n", {
      ADMIN_EMAIL: "noenrol@example.com",
    });

    expect(status).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("2FA isn't set up");
  });
});
