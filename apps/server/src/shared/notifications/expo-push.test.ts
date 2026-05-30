// Unit tests for sendExpoPush — token-pruning behaviour on permanent
// Expo errors. Heavy integration paths (delivery side effects, BullMQ
// jobs) live in tests/integration; this file isolates the HTTP+prisma
// surface so the prune contract is regressable without testcontainers.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteManyMock = vi.fn();

vi.mock("../database.js", () => ({
  prisma: {
    pushToken: {
      deleteMany: (...args: unknown[]) => deleteManyMock(...args),
    },
  },
}));

vi.mock("../../config/env.js", () => ({
  env: {
    EXPO_ACCESS_TOKEN: "test-token",
    NODE_ENV: "test",
  },
}));

vi.mock("../logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// Import AFTER the mocks so the SUT picks them up.
const { sendExpoPush } = await import("./expo-push.js");

const fetchMock = vi.fn();
beforeEach(() => {
  globalThis.fetch = fetchMock;
  fetchMock.mockReset();
  deleteManyMock.mockReset();
  deleteManyMock.mockResolvedValue({ count: 0 });
});

afterEach(() => {
  vi.clearAllMocks();
});

const okResponse = (data: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: (): Promise<unknown> => Promise.resolve({ data }),
  }) as unknown as Response;

describe("sendExpoPush — permanent-token-failure pruning", () => {
  it("prunes tokens that return DeviceNotRegistered (pre-existing behaviour)", async () => {
    fetchMock.mockResolvedValue(
      okResponse([{ status: "error", message: "x", details: { error: "DeviceNotRegistered" } }]),
    );

    const result = await sendExpoPush([{ to: "ExponentPushToken[gone]", title: "t", body: "b" }]);

    expect(result[0]?.success).toBe(false);
    expect(result[0]?.errorCode).toBe("DeviceNotRegistered");
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { token: { in: ["ExponentPushToken[gone]"] } },
    });
  });

  it("prunes tokens that return PushTooManyExperienceIds (broken Expo Go ↔ build mix)", async () => {
    // Real-world scenario: a phone first ran the app via Expo Go,
    // then again via a dev/prod build. The token Expo issued is
    // bound to multiple experiences; Enhanced Security refuses
    // delivery. The row must be deleted so a clean reinstall can
    // register a fresh token.
    fetchMock.mockResolvedValue(
      okResponse([
        { status: "error", message: "x", details: { error: "PushTooManyExperienceIds" } },
      ]),
    );

    const result = await sendExpoPush([{ to: "ExponentPushToken[mixed]", title: "t", body: "b" }]);

    expect(result[0]?.success).toBe(false);
    expect(result[0]?.errorCode).toBe("PushTooManyExperienceIds");
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { token: { in: ["ExponentPushToken[mixed]"] } },
    });
  });

  it("prunes tokens that return MismatchSenderId (FCM project mismatch)", async () => {
    fetchMock.mockResolvedValue(
      okResponse([{ status: "error", message: "x", details: { error: "MismatchSenderId" } }]),
    );

    await sendExpoPush([{ to: "ExponentPushToken[fcm-wrong]", title: "t", body: "b" }]);

    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { token: { in: ["ExponentPushToken[fcm-wrong]"] } },
    });
  });

  it("does NOT prune tokens with transient errors (MessageRateExceeded)", async () => {
    fetchMock.mockResolvedValue(
      okResponse([
        { status: "error", message: "slow down", details: { error: "MessageRateExceeded" } },
      ]),
    );

    const result = await sendExpoPush([{ to: "ExponentPushToken[busy]", title: "t", body: "b" }]);

    expect(result[0]?.success).toBe(false);
    expect(result[0]?.errorCode).toBe("MessageRateExceeded");
    // No deletion call at all — the row stays so the next send can retry.
    expect(deleteManyMock).not.toHaveBeenCalled();
  });

  it("prunes only the broken token from a mixed batch, leaves the healthy one", async () => {
    fetchMock.mockResolvedValue(
      okResponse([
        { status: "ok", id: "ticket-1" },
        { status: "error", message: "x", details: { error: "PushTooManyExperienceIds" } },
      ]),
    );

    const results = await sendExpoPush([
      { to: "ExponentPushToken[good]", title: "t", body: "b" },
      { to: "ExponentPushToken[bad]", title: "t", body: "b" },
    ]);

    expect(results[0]?.success).toBe(true);
    expect(results[1]?.success).toBe(false);
    expect(deleteManyMock).toHaveBeenCalledTimes(1);
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { token: { in: ["ExponentPushToken[bad]"] } },
    });
  });
});
