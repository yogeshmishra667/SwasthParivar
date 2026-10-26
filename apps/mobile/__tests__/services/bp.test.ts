// Audit P4 review C1 — BP has no local queue, so a network failure must
// read "not saved" (never "saved locally"). A CRITICAL BP is re-sent in
// the background with the SAME clientUuid, so the server sees an
// idempotent replay and the family alert still goes out. W1: the pending
// critical BP is persisted, so an app restart doesn't drop it.
const mockStorage = new Map<string, string>();
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((k: string) => Promise.resolve(mockStorage.get(k) ?? null)),
    setItem: jest.fn((k: string, v: string) => Promise.resolve(void mockStorage.set(k, v))),
  },
}));
jest.mock("@/services/api", () => ({ api: { post: jest.fn(), get: jest.fn() } }));
jest.mock("@/services/analytics", () => ({ track: jest.fn(), logError: jest.fn() }));

import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";

import { api } from "@/services/api";
import { saveBPReading, type SaveBPInput } from "@/services/bp";

const post = api.post as jest.Mock;

const networkError = (): AxiosError => new AxiosError("Network Error", "ERR_NETWORK");

const httpError = (status: number): AxiosError => {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  return new AxiosError("Request failed", "ERR_BAD_RESPONSE", config, null, {
    status,
    statusText: "",
    headers: {},
    config,
    data: { error: { code: "READING_INVALID_VALUE", message: "bad" } },
  });
};

const bpInput = (clientUuid: string, systolic: number, diastolic: number): SaveBPInput => ({
  userId: "user-1",
  clientUuid,
  systolic,
  diastolic,
  source: "manual",
  measuredAtIso: "2026-10-26T08:00:00.000Z",
});

const sentPayloads = (): { clientUuid: string; version: number }[] =>
  post.mock.calls.map((call: unknown[]) => call[1] as { clientUuid: string; version: number });

const pendingUuids = (): string[] =>
  (
    JSON.parse(mockStorage.get("swasth.pendingCriticalBP.v1") ?? "[]") as {
      payload: { clientUuid: string };
    }[]
  ).map((i) => i.payload.clientUuid);

beforeEach(() => {
  jest.useFakeTimers();
  post.mockReset();
  mockStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("saveBPReading", () => {
  it("a network failure on a normal BP is 'not saved', with no background re-send", async () => {
    post.mockRejectedValue(networkError());
    await expect(saveBPReading(bpInput("uuid-normal", 128, 82))).resolves.toEqual({
      kind: "network_failed",
      retrying: false,
    });
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("a network failure on a critical BP re-sends it with the same clientUuid until it lands", async () => {
    post
      .mockRejectedValueOnce(networkError()) // the save itself
      .mockRejectedValueOnce(networkError()) // background retry 1
      .mockResolvedValueOnce({ data: { reading: { id: "r1" } } }); // retry 2 lands
    await expect(saveBPReading(bpInput("uuid-critical", 195, 120))).resolves.toEqual({
      kind: "network_failed",
      retrying: true,
    });

    await jest.advanceTimersByTimeAsync(5_000 + 15_000);
    expect(post).toHaveBeenCalledTimes(3);
    // Delivered — no more re-sends.
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(post).toHaveBeenCalledTimes(3);
    expect(sentPayloads()).toEqual([
      expect.objectContaining({ clientUuid: "uuid-critical", version: 1 }),
      expect.objectContaining({ clientUuid: "uuid-critical", version: 1 }),
      expect.objectContaining({ clientUuid: "uuid-critical", version: 1 }),
    ]);
  });

  it("a server error (5xx) on a critical BP is also 'not saved' and re-sent", async () => {
    post
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce({ data: { reading: { id: "r2" } } });
    await expect(saveBPReading(bpInput("uuid-503", 85, 55))).resolves.toEqual({
      kind: "network_failed",
      retrying: true,
    });
    await jest.advanceTimersByTimeAsync(5_000);
    expect(sentPayloads().map((p) => p.clientUuid)).toEqual(["uuid-503", "uuid-503"]);
  });

  it("a 4xx rejection is reported as rejected and never re-sent", async () => {
    post.mockRejectedValue(httpError(400));
    await expect(saveBPReading(bpInput("uuid-400", 195, 120))).resolves.toMatchObject({
      kind: "rejected",
      status: 400,
      code: "READING_INVALID_VALUE",
    });
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe("pending critical BP across an app restart (review W1)", () => {
  it("persists a critical BP that failed, and clears it once it lands", async () => {
    post
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ data: { reading: { id: "r9" } } });
    await saveBPReading(bpInput("uuid-persist", 195, 120));
    expect(pendingUuids()).toEqual(["uuid-persist"]);
    await jest.advanceTimersByTimeAsync(5_000);
    expect(pendingUuids()).toEqual([]);
  });

  it("a normal BP that failed is not persisted", async () => {
    post.mockRejectedValue(networkError());
    await saveBPReading(bpInput("uuid-normal-2", 128, 82));
    expect(pendingUuids()).toEqual([]);
  });

  it("after a restart, the resume re-sends it at once with the same clientUuid", async () => {
    post.mockRejectedValue(networkError());
    await saveBPReading(bpInput("uuid-restart", 85, 55));
    expect(pendingUuids()).toEqual(["uuid-restart"]);

    // App killed: fresh module state (no in-memory retry), storage survives.
    jest.resetModules();
    const fresh = jest.requireMock("@/services/api");
    fresh.api.post.mockReset().mockResolvedValue({ data: { reading: { id: "r10" } } });
    const { resumePendingCriticalBP } = jest.requireActual("@/services/bp");
    await resumePendingCriticalBP();
    await jest.advanceTimersByTimeAsync(0);
    expect(fresh.api.post).toHaveBeenCalledTimes(1);
    expect(fresh.api.post.mock.calls[0][1]).toMatchObject({
      clientUuid: "uuid-restart",
      version: 1,
    });
    expect(pendingUuids()).toEqual([]);
  });

  it.each([401, 408, 429])(
    "a %i on the re-send keeps it pending until it lands (review W2)",
    async (status) => {
      post
        .mockRejectedValueOnce(networkError())
        .mockRejectedValueOnce(httpError(status))
        .mockResolvedValueOnce({ data: { reading: { id: "r12" } } });
      await saveBPReading(bpInput(`uuid-${status}`, 195, 120));
      await jest.advanceTimersByTimeAsync(5_000);
      expect(post).toHaveBeenCalledTimes(2);
      expect(pendingUuids()).toEqual([`uuid-${status}`]);
      await jest.advanceTimersByTimeAsync(15_000);
      expect(post).toHaveBeenCalledTimes(3);
      expect(pendingUuids()).toEqual([]);
    },
  );

  it.each([400, 409])(
    "a %i on the re-send ends it (refused for good, or already stored)",
    async (status) => {
      post.mockRejectedValueOnce(networkError()).mockRejectedValueOnce(httpError(status));
      await saveBPReading(bpInput(`uuid-final-${status}`, 195, 120));
      await jest.advanceTimersByTimeAsync(10 * 60_000);
      expect(post).toHaveBeenCalledTimes(2);
      expect(pendingUuids()).toEqual([]);
    },
  );

  it("a critical BP whose first save gets a 429 is kept and re-sent", async () => {
    post
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce({ data: { reading: { id: "r13" } } });
    await expect(saveBPReading(bpInput("uuid-429-first", 195, 120))).resolves.toEqual({
      kind: "network_failed",
      retrying: true,
    });
    expect(pendingUuids()).toEqual(["uuid-429-first"]);
    await jest.advanceTimersByTimeAsync(5_000);
    expect(pendingUuids()).toEqual([]);
  });

  it("concurrent saves of two critical BPs both stay pending", async () => {
    post.mockRejectedValue(networkError());
    await Promise.all([
      saveBPReading(bpInput("uuid-a", 195, 120)),
      saveBPReading(bpInput("uuid-b", 85, 55)),
    ]);
    expect(pendingUuids().sort()).toEqual(["uuid-a", "uuid-b"]);
  });

  it("drops a pending critical BP older than 2 hours instead of alerting hours late", async () => {
    mockStorage.set(
      "swasth.pendingCriticalBP.v1",
      JSON.stringify([
        {
          payload: { clientUuid: "uuid-old" },
          queuedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
        },
      ]),
    );
    jest.resetModules();
    const fresh = jest.requireMock("@/services/api");
    fresh.api.post.mockReset().mockResolvedValue({ data: { reading: { id: "r11" } } });
    const { resumePendingCriticalBP } = jest.requireActual("@/services/bp");
    await resumePendingCriticalBP();
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(fresh.api.post).not.toHaveBeenCalled();
    expect(pendingUuids()).toEqual([]);
  });
});
