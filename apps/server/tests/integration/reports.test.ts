// Phase 4 Feature G.4 — /api/v1/reports HTTP flow + GENERATE_PDF worker.
//
// Puppeteer, R2, and the Claude summary are mocked at module level — CI
// must never launch Chromium or hit R2/Anthropic. We assert the HTTP
// surface (generate → 202, dedup, status, download 409→302, authz) and
// the worker happy path (Report → ready, pdf_url set, ai flag honoured).

import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import request from "supertest";
import jwt from "jsonwebtoken";

const { renderPdfMock, uploadMock, refreshMock, summaryMock } = vi.hoisted(() => ({
  renderPdfMock: vi.fn(),
  uploadMock: vi.fn(),
  refreshMock: vi.fn(),
  summaryMock: vi.fn(),
}));

vi.mock("../../src/shared/reports/render-pdf.js", () => ({
  renderHtmlToPdf: renderPdfMock,
}));
vi.mock("../../src/shared/storage/r2.js", async (importActual) => ({
  ...(await importActual()),
  uploadObject: uploadMock,
  refreshObjectUrl: refreshMock,
}));
vi.mock("../../src/shared/ai/report-summary.js", () => ({
  generateReportSummary: summaryMock,
}));

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
let processGenerateReport: (job: any) => Promise<void>;
let setFlag: (key: string, value: boolean, actor: string) => Promise<unknown>;
let resetFlagCache: () => void;

let patientId: string;
let patientToken: string;
let outsiderToken: string;

const setPortal = async (enabled: boolean): Promise<void> => {
  await setFlag("doctor_portal_enabled", enabled, "integration_test");
  resetFlagCache();
};

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
  runPrisma(["db", "execute", "--stdin"], {
    input: "SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE);",
  });

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  const procModule = await import("../../src/workers/generate-report.processor.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;
  setFlag = flagsModule.setFlag;
  resetFlagCache = flagsModule.__resetFlagCache;
  processGenerateReport = procModule.processGenerateReport;

  await setPortal(true);

  const householdA = await prisma.household.create({ data: {} });
  const householdB = await prisma.household.create({ data: {} });
  const patient = await prisma.user.create({
    data: {
      phone: "+919812380010",
      name: "Ramesh",
      age: 67,
      householdId: householdA.id,
      preferredLanguage: "hi",
      onboardingComplete: true,
    },
  });
  const outsider = await prisma.user.create({
    data: {
      phone: "+919812380020",
      name: "Stranger",
      age: 40,
      householdId: householdB.id,
      onboardingComplete: true,
    },
  });
  patientId = patient.id;
  patientToken = jwt.sign(
    { sub: patient.id, householdId: patient.householdId },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
  outsiderToken = jwt.sign(
    { sub: outsider.id, householdId: outsider.householdId },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
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

beforeEach(async () => {
  renderPdfMock.mockReset();
  uploadMock.mockReset();
  refreshMock.mockReset();
  summaryMock.mockReset();
  renderPdfMock.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));
  uploadMock.mockResolvedValue({
    key: "reports/x.pdf",
    url: "https://r2.example/reports/x.pdf?sig=stored",
    bytes: 12,
    contentType: "application/pdf",
  });
  refreshMock.mockResolvedValue("https://r2.example/reports/x.pdf?sig=fresh");
  summaryMock.mockResolvedValue({
    text: "Glucose stable; discuss morning readings.",
    reason: "ok",
  });
  await prisma.report.deleteMany({ where: { userId: patientId } });
  await setPortal(true);
});

const generate = (token: string, body: Record<string, unknown> = {}) =>
  request(app).post("/api/v1/reports/generate").set("Authorization", `Bearer ${token}`).send(body);

describe("POST /api/v1/reports/generate", () => {
  it("creates a generating report and returns 202", async () => {
    const res = await generate(patientToken);
    expect(res.status).toBe(202);
    expect(res.body.data.report.status).toBe("generating");
  });

  it("returns 503 when the portal is disabled", async () => {
    await setPortal(false);
    const res = await generate(patientToken);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("DOCTOR_PORTAL_DISABLED");
  });

  it("dedups concurrent generation — second call returns the in-flight row", async () => {
    const first = await generate(patientToken);
    const second = await generate(patientToken);
    expect(first.body.data.report.id).toBe(second.body.data.report.id);
  });

  it("404s when the named appointment is not the caller's", async () => {
    const res = await generate(patientToken, {
      appointmentId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("APPOINTMENT_NOT_FOUND");
  });
});

describe("GENERATE_PDF worker + status/download", () => {
  it("renders, uploads, and flips the report to ready with the AI flag", async () => {
    const gen = await generate(patientToken);
    const reportId = gen.body.data.report.id as string;

    await processGenerateReport({ data: { reportId } });

    expect(renderPdfMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const row = await prisma.report.findUnique({ where: { id: reportId } });
    expect(row.status).toBe("ready");
    expect(row.pdfR2Key).toBe(`reports/${patientId}/${reportId}.pdf`);
    expect(row.aiSummaryIncluded).toBe(true);

    const status = await request(app)
      .get(`/api/v1/reports/${reportId}/status`)
      .set("Authorization", `Bearer ${patientToken}`);
    expect(status.body.data).toEqual({ status: "ready", ready: true });

    const dl = await request(app)
      .get(`/api/v1/reports/${reportId}/download`)
      .set("Authorization", `Bearer ${patientToken}`)
      .redirects(0);
    expect(dl.status).toBe(302);
    expect(dl.headers.location).toBe("https://r2.example/reports/x.pdf?sig=fresh");
  });

  it("records aiSummaryIncluded=false when the summary is omitted", async () => {
    summaryMock.mockResolvedValue({ text: null, reason: "disabled" });
    const gen = await generate(patientToken);
    const reportId = gen.body.data.report.id as string;
    await processGenerateReport({ data: { reportId } });
    const row = await prisma.report.findUnique({ where: { id: reportId } });
    expect(row.status).toBe("ready");
    expect(row.aiSummaryIncluded).toBe(false);
  });

  it("marks the report failed and rethrows when rendering throws", async () => {
    renderPdfMock.mockRejectedValueOnce(new Error("chromium boom"));
    const gen = await generate(patientToken);
    const reportId = gen.body.data.report.id as string;
    await expect(processGenerateReport({ data: { reportId } })).rejects.toThrow("chromium boom");
    const row = await prisma.report.findUnique({ where: { id: reportId } });
    expect(row.status).toBe("failed");
    expect(row.error).toContain("chromium");
  });

  it("download is 409 before the PDF is ready", async () => {
    const gen = await generate(patientToken);
    const reportId = gen.body.data.report.id as string;
    const dl = await request(app)
      .get(`/api/v1/reports/${reportId}/download`)
      .set("Authorization", `Bearer ${patientToken}`)
      .redirects(0);
    expect(dl.status).toBe(409);
    expect(dl.body.error.code).toBe("REPORT_NOT_READY");
  });

  it("is idempotent — re-running on a ready report does not re-render", async () => {
    const gen = await generate(patientToken);
    const reportId = gen.body.data.report.id as string;
    await processGenerateReport({ data: { reportId } });
    renderPdfMock.mockClear();
    await processGenerateReport({ data: { reportId } });
    expect(renderPdfMock).not.toHaveBeenCalled();
  });
});

describe("reports authz", () => {
  it("404s status for an unknown report", async () => {
    const res = await request(app)
      .get(`/api/v1/reports/00000000-0000-0000-0000-000000000000/status`)
      .set("Authorization", `Bearer ${patientToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("REPORT_NOT_FOUND");
  });

  it("blocks a different household from reading status (403)", async () => {
    const gen = await generate(patientToken);
    const reportId = gen.body.data.report.id as string;
    const res = await request(app)
      .get(`/api/v1/reports/${reportId}/status`)
      .set("Authorization", `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FAMILY_NO_ACCESS");
  });

  it("requires auth", async () => {
    const res = await request(app).post("/api/v1/reports/generate").send({});
    expect(res.status).toBe(401);
  });
});
