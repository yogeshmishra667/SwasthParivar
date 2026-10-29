// Audit P9 — the glucose offline queue used to delete a row on ANY 4xx.
// After a long offline spell that meant a 401 (refresh expired) or a 429
// (daily cap / per-minute limit while draining a backlog) deleted medical
// readings. Worse (review C1): every queued row drained with
// `"notes": null` — WatermelonDB reads an unset optional column back as
// null — which the server 400'd, so EVERY offline reading was deleted.
// Now a row is deleted only when the server refuses it for good, never a
// critical one, and the drain never sends `notes: null`.
jest.mock("@/services/api", () => ({ api: { post: jest.fn() } }));
jest.mock("@/services/analytics", () => ({ track: jest.fn(), logError: jest.fn() }));
jest.mock("@/services/sentry", () => ({ captureError: jest.fn() }));
jest.mock("uuid", () => ({ v4: () => "uuid-new" }));
jest.mock("@nozbe/watermelondb", () => ({
  Q: { where: jest.fn(), sortBy: jest.fn(), asc: "asc" },
}));

interface MockRow {
  clientUuid: string;
  userId: string;
  valueMgDl: number;
  readingType: string;
  // Like WatermelonDB on a device: unset optional columns are null.
  context: string | null;
  notes: string | null;
  source: string;
  measuredAt: number;
  version: number;
  syncedAt: number | null;
  deleted: boolean;
  update: (fn: (r: MockRow) => void) => Promise<void>;
  markAsDeleted: () => Promise<void>;
}

const mockRows: MockRow[] = [];
const mockPendingRows = (): MockRow[] => mockRows.filter((r) => r.syncedAt === null && !r.deleted);
const mockDb = { failQuery: false, unavailable: false };

jest.mock("@/db/database", () => ({
  getDatabase: () =>
    mockDb.unavailable
      ? null
      : {
          write: async (fn: () => Promise<void>) => await fn(),
          collections: {
            get: () => ({
              query: () => ({
                fetch: () =>
                  mockDb.failQuery
                    ? Promise.reject(new Error("SQLite busy"))
                    : Promise.resolve(mockPendingRows()),
                fetchCount: () => Promise.resolve(mockPendingRows().length),
              }),
              create: (fn: (r: Partial<MockRow>) => void) => {
                const r: Partial<MockRow> = {
                  syncedAt: null,
                  deleted: false,
                  notes: null,
                  context: null,
                };
                fn(r);
                r.update = (change) => {
                  change(r as MockRow);
                  return Promise.resolve();
                };
                r.markAsDeleted = () => {
                  r.deleted = true;
                  return Promise.resolve();
                };
                mockRows.push(r as MockRow);
                return Promise.resolve();
              },
            }),
          },
        },
}));

import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";

import { api } from "@/services/api";
import { captureError } from "@/services/sentry";
import { classifyDrainFailure } from "@/services/drain-policy";
import {
  drainPendingReadings,
  saveGlucoseReading,
  type SaveReadingInput,
} from "@/services/readings";
import { useSyncStore } from "@/stores/sync.store";

const post = api.post as jest.Mock;

const networkError = (): AxiosError => new AxiosError("Network Error", "ERR_NETWORK");

const httpError = (status: number, data: unknown): AxiosError => {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  return new AxiosError("Request failed", "ERR_BAD_RESPONSE", config, null, {
    status,
    statusText: "",
    headers: {},
    config,
    data,
  });
};

const coded = (status: number, code: string): AxiosError =>
  httpError(status, { success: false, error: { code, message: "x" } });

// The two 429s the server sends: the free-tier daily cap (JSON body) and
// express-rate-limit's per-minute limiter (plain text).
const dailyCap = (): AxiosError => coded(429, "RATE_LIMITED");
const perMinute = (): AxiosError => httpError(429, "Too many requests, please try again later.");
const invalid = (): AxiosError => coded(400, "VALIDATION_ERROR");

const addPendingRow = (
  clientUuid: string,
  measuredAt: string,
  valueMgDl = 120,
  userId = "user-1",
): MockRow => {
  const row: MockRow = {
    clientUuid,
    userId,
    valueMgDl,
    readingType: "fasting",
    context: null,
    notes: null,
    source: "manual",
    measuredAt: new Date(measuredAt).getTime(),
    version: 1,
    syncedAt: null,
    deleted: false,
    update: (fn) => {
      fn(row);
      return Promise.resolve();
    },
    markAsDeleted: () => {
      row.deleted = true;
      return Promise.resolve();
    },
  };
  mockRows.push(row);
  return row;
};

const postedUuids = (): string[] =>
  post.mock.calls.map((call: unknown[]) => (call[1] as { clientUuid: string }).clientUuid);

const input: SaveReadingInput = {
  userId: "user-1",
  valueMgDl: 130,
  readingType: "fasting",
  context: "normal",
  source: "manual",
  measuredAtIso: "2026-10-28T02:00:00.000Z",
};

beforeEach(() => {
  post.mockReset();
  (captureError as jest.Mock).mockReset();
  mockRows.length = 0;
  mockDb.failQuery = false;
  mockDb.unavailable = false;
  useSyncStore.setState({ phase: "idle", pendingCount: 0 });
});

describe("classifyDrainFailure", () => {
  it.each<[string, string, unknown]>([
    ["network failure", "abort", networkError()],
    ["500", "abort", httpError(500, {})],
    ["503 maintenance", "abort", coded(503, "MAINTENANCE_MODE")],
    ["401 expired session", "abort", coded(401, "AUTH_TOKEN_EXPIRED")],
    ["408 timeout", "abort", httpError(408, "")],
    ["429 per-minute limiter", "abort", perMinute()],
    ["429 daily cap", "skip", dailyCap()],
    ["403", "skip", coded(403, "AUTH_UNAUTHORIZED")],
    ["404", "skip", httpError(404, {})],
    ["400 VALIDATION_ERROR", "drop", invalid()],
    ["400 READING_INVALID_VALUE", "drop", coded(400, "READING_INVALID_VALUE")],
    ["409 READING_STALE_VERSION", "drop", coded(409, "READING_STALE_VERSION")],
    // A 409 from an unrelated constraint race: the reading may never have
    // been stored, so it must not be deleted.
    ["409 FAMILY_LINK_EXISTS", "skip", coded(409, "FAMILY_LINK_EXISTS")],
    ["400 with no code", "skip", httpError(400, "Bad Request")],
    ["a non-axios error", "abort", new Error("boom")],
  ])("%s → %s", (_label, expected, err) => {
    expect(classifyDrainFailure(err)).toBe(expected);
  });
});

describe("drainPendingReadings", () => {
  it("never sends `notes: null` — the row WatermelonDB hands back syncs", async () => {
    const row = addPendingRow("uuid-1", "2026-10-20T08:00:00.000Z", 52);
    post.mockResolvedValueOnce({ data: {} });

    await expect(drainPendingReadings()).resolves.toEqual({ pushed: 1, failed: 0, held: 0 });

    const body = post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("notes");
    expect(body.context).toBe("normal");
    expect(row.syncedAt).not.toBeNull();
  });

  it("sends a real note", async () => {
    const row = addPendingRow("uuid-1", "2026-10-20T08:00:00.000Z");
    row.notes = "khana ke baad";
    post.mockResolvedValueOnce({ data: {} });

    await drainPendingReadings();

    expect((post.mock.calls[0]?.[1] as { notes?: string }).notes).toBe("khana ke baad");
  });

  it("says when each reading is sent, on the first try and on a drain (audit P33)", async () => {
    post.mockRejectedValueOnce(networkError());
    await saveGlucoseReading(input);
    post.mockResolvedValueOnce({ data: {} });
    await drainPendingReadings();
    for (const call of post.mock.calls as [string, { sentAt?: string }][]) {
      expect(typeof call[1].sentAt).toBe("string");
    }
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("sends critical readings first, newest first, ahead of an older backlog", async () => {
    // The 30-min cooldown lets only the first critical alert: it must be
    // the reading closest to now.
    addPendingRow("uuid-old-normal", "2026-10-20T08:00:00.000Z", 120);
    addPendingRow("uuid-critical-old", "2026-10-21T22:00:00.000Z", 340);
    addPendingRow("uuid-critical", "2026-10-22T08:00:00.000Z", 52);
    post.mockResolvedValue({ data: {} });

    await drainPendingReadings();

    expect(postedUuids()).toEqual(["uuid-critical", "uuid-critical-old", "uuid-old-normal"]);
  });

  it("a daily-cap 429 keeps that reading and still syncs the rest of the backlog", async () => {
    const capped = addPendingRow("uuid-capped", "2026-10-20T08:00:00.000Z");
    const next = addPendingRow("uuid-next", "2026-10-21T08:00:00.000Z");
    post.mockRejectedValueOnce(dailyCap()).mockResolvedValueOnce({ data: {} });

    await expect(drainPendingReadings()).resolves.toEqual({ pushed: 1, failed: 0, held: 1 });

    expect(capped.deleted).toBe(false);
    expect(capped.syncedAt).toBeNull();
    expect(next.syncedAt).not.toBeNull();
    expect(useSyncStore.getState().pendingCount).toBe(1);
  });

  it("after a daily-cap 429, the rest of that day is held without a request each", async () => {
    addPendingRow("uuid-day1-a", "2026-10-20T08:00:00.000Z");
    addPendingRow("uuid-day1-b", "2026-10-20T13:00:00.000Z");
    addPendingRow("uuid-day2", "2026-10-21T08:00:00.000Z");
    post.mockRejectedValueOnce(dailyCap()).mockResolvedValueOnce({ data: {} });

    await expect(drainPendingReadings()).resolves.toEqual({ pushed: 1, failed: 0, held: 2 });

    expect(postedUuids()).toEqual(["uuid-day1-a", "uuid-day2"]);
  });

  it("one profile's full day doesn't hold another profile's readings (shared phone)", async () => {
    addPendingRow("uuid-papa", "2026-10-20T08:00:00.000Z", 120, "papa");
    const maa = addPendingRow("uuid-maa", "2026-10-20T09:00:00.000Z", 120, "maa");
    post.mockRejectedValueOnce(dailyCap()).mockResolvedValueOnce({ data: {} });

    await expect(drainPendingReadings()).resolves.toEqual({ pushed: 1, failed: 0, held: 1 });

    expect(postedUuids()).toEqual(["uuid-papa", "uuid-maa"]);
    expect(maa.syncedAt).not.toBeNull();
  });

  it.each([
    ["401 (refresh expired)", httpError(401, {})],
    ["the per-minute 429", perMinute()],
    ["a network failure", networkError()],
  ])("%s stops the drain and deletes nothing", async (_label, err) => {
    const first = addPendingRow("uuid-1", "2026-10-20T08:00:00.000Z");
    const second = addPendingRow("uuid-2", "2026-10-21T08:00:00.000Z");
    post.mockRejectedValueOnce(err);

    await expect(drainPendingReadings()).resolves.toEqual({ pushed: 0, failed: 0, held: 0 });

    expect(post).toHaveBeenCalledTimes(1);
    expect(first.deleted).toBe(false);
    expect(second.deleted).toBe(false);
    expect(useSyncStore.getState().pendingCount).toBe(2);
    expect(useSyncStore.getState().phase).toBe("error");
  });

  it("deletes a row only when the server refuses it for good", async () => {
    const bad = addPendingRow("uuid-bad", "2026-10-20T08:00:00.000Z");
    const good = addPendingRow("uuid-good", "2026-10-21T08:00:00.000Z");
    post.mockRejectedValueOnce(invalid()).mockResolvedValueOnce({ data: {} });

    await expect(drainPendingReadings()).resolves.toEqual({ pushed: 1, failed: 1, held: 0 });

    expect(bad.deleted).toBe(true);
    expect(good.syncedAt).not.toBeNull();
    // A deleted medical reading reaches Sentry, not just analytics.
    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it("never deletes a critical reading, even when the server refuses it", async () => {
    const critical = addPendingRow("uuid-critical-refused", "2026-10-20T08:00:00.000Z", 52);
    post.mockRejectedValueOnce(invalid());

    await expect(drainPendingReadings()).resolves.toEqual({ pushed: 0, failed: 0, held: 1 });

    expect(critical.deleted).toBe(false);
    expect(critical.syncedAt).toBeNull();
    // It will never alert anyone: Sentry, not just analytics.
    expect(captureError).toHaveBeenCalledWith(
      expect.any(AxiosError),
      expect.objectContaining({ where: "drainPendingReadings.holdCritical" }),
    );
  });

  it("a local failure doesn't leave the phase stuck on 'draining'", async () => {
    mockDb.failQuery = true;

    await expect(drainPendingReadings()).rejects.toThrow("SQLite busy");
    expect(useSyncStore.getState().phase).toBe("error");

    // The next drain runs instead of returning at once.
    mockDb.failQuery = false;
    addPendingRow("uuid-1", "2026-10-20T08:00:00.000Z");
    post.mockResolvedValueOnce({ data: {} });
    await expect(drainPendingReadings()).resolves.toEqual({ pushed: 1, failed: 0, held: 0 });
  });
});

describe("saveGlucoseReading", () => {
  it.each([
    ["401 after a failed refresh", httpError(401, {})],
    ["the per-minute 429", perMinute()],
  ])("%s queues the reading locally instead of rejecting it", async (_label, err) => {
    post.mockRejectedValueOnce(err);

    const result = await saveGlucoseReading(input);

    expect(result.kind).toBe("queued");
    expect(mockPendingRows()).toHaveLength(1);
    expect(mockPendingRows()[0]?.valueMgDl).toBe(130);
  });

  it("with no local DB it says 'not saved' instead of 'saved locally' (audit P8)", async () => {
    mockDb.unavailable = true;
    post.mockRejectedValueOnce(networkError());

    await expect(saveGlucoseReading(input)).resolves.toMatchObject({
      kind: "rejected",
      code: "OFFLINE_QUEUE_UNAVAILABLE",
    });
    expect(useSyncStore.getState().pendingCount).toBe(0);
  });

  it("uses the caller's clientUuid, so a retry of the same entry is a replay", async () => {
    post.mockRejectedValueOnce(networkError());

    await expect(saveGlucoseReading({ ...input, clientUuid: "entry-1" })).resolves.toEqual({
      kind: "queued",
      clientUuid: "entry-1",
    });
    expect((post.mock.calls[0]?.[1] as { clientUuid: string }).clientUuid).toBe("entry-1");
    expect(mockPendingRows()[0]?.clientUuid).toBe("entry-1");
  });

  it("the daily cap is a rejection the log screen shows (not queued)", async () => {
    post.mockRejectedValueOnce(dailyCap());

    await expect(saveGlucoseReading(input)).resolves.toMatchObject({
      kind: "rejected",
      status: 429,
      code: "RATE_LIMITED",
    });
    expect(mockPendingRows()).toHaveLength(0);
  });

  it("a validation error is rejected, not queued", async () => {
    post.mockRejectedValueOnce(invalid());

    await expect(saveGlucoseReading(input)).resolves.toMatchObject({
      kind: "rejected",
      status: 400,
    });
    expect(mockPendingRows()).toHaveLength(0);
  });

  it("a queued reading drains without `notes: null` (the device path end to end)", async () => {
    post.mockRejectedValueOnce(networkError());
    await saveGlucoseReading(input);

    post.mockResolvedValueOnce({ data: {} });
    await expect(drainPendingReadings()).resolves.toMatchObject({ pushed: 1 });
    expect(post.mock.calls[1]?.[1]).not.toHaveProperty("notes");
  });
});
