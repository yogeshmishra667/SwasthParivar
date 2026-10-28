// Audit P8 — BP, cardiac, respiratory and meal logs said "saved locally"
// offline and stored nothing. They now go to a WatermelonDB queue that is
// drained like the glucose queue (P9 rules): a row is deleted only when the
// server has it or refuses it for good, never a critical one.
jest.mock("@/services/api", () => ({ api: { post: jest.fn() } }));
jest.mock("@/services/analytics", () => ({ track: jest.fn(), logError: jest.fn() }));
jest.mock("@/services/sentry", () => ({ captureError: jest.fn() }));
jest.mock("uuid", () => ({ v4: () => "uuid-new" }));
jest.mock("@nozbe/watermelondb", () => ({
  Q: {
    where: (column: string, value: unknown) => ({ where: [column, value] }),
    sortBy: (column: string) => ({ sortBy: column }),
    asc: "asc",
  },
}));

interface MockRow {
  clientUuid: string;
  userId: string;
  kind: string;
  payloadJson: string;
  critical: boolean;
  takenAt: number;
  queuedAt: number;
  destroyPermanently: () => Promise<void>;
}

interface Clause {
  where?: [string, unknown];
  sortBy?: string;
}

const mockRows: MockRow[] = [];
const mockDb = { available: true, failWrite: false, failQuery: false };

const mockMatch = (clauses: Clause[]): MockRow[] => {
  let rows = [...mockRows];
  for (const c of clauses) {
    if (c.where?.[0] === "client_uuid") rows = rows.filter((r) => r.clientUuid === c.where?.[1]);
    if (c.sortBy === "taken_at") rows.sort((a, b) => a.takenAt - b.takenAt);
  }
  return rows;
};

const mockAddRow = (fields: Partial<MockRow>): MockRow => {
  const row = { ...fields } as MockRow;
  row.destroyPermanently = () => {
    mockRows.splice(mockRows.indexOf(row), 1);
    return Promise.resolve();
  };
  mockRows.push(row);
  return row;
};

jest.mock("@/db/database", () => ({
  getDatabase: () =>
    mockDb.available
      ? {
          write: async (fn: () => Promise<void>) => {
            if (mockDb.failWrite) throw new Error("disk full");
            await fn();
          },
          collections: {
            get: () => ({
              query: (...clauses: Clause[]) => ({
                fetch: () =>
                  mockDb.failQuery
                    ? Promise.reject(new Error("SQLite busy"))
                    : Promise.resolve(mockMatch(clauses)),
                fetchCount: () => Promise.resolve(mockMatch(clauses).length),
              }),
              create: (fn: (r: Partial<MockRow>) => void) => {
                const fields: Partial<MockRow> = {};
                fn(fields);
                mockAddRow(fields);
                return Promise.resolve();
              },
            }),
          },
        }
      : null,
}));

import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";

import { api } from "@/services/api";
import { track } from "@/services/analytics";
import { captureError } from "@/services/sentry";
import { saveCardiacLog, type SaveCardiacInput } from "@/services/cardiac";
import { saveMealLog } from "@/services/meals";
import {
  drainPendingWrites,
  enqueuePendingWrite,
  type PendingWriteKind,
} from "@/services/pending-writes";
import { saveRespiratoryLog } from "@/services/respiratory";
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

const queue = (
  clientUuid: string,
  kind: PendingWriteKind,
  takenAt: string,
  critical = false,
  userId = "user-1",
): MockRow =>
  mockAddRow({
    clientUuid,
    userId,
    kind,
    payloadJson: JSON.stringify({ clientUuid, targetUserId: userId, version: 1 }),
    critical,
    takenAt: Date.parse(takenAt),
    queuedAt: Date.now(),
  });

const sentUuids = (): string[] =>
  post.mock.calls.map((call: unknown[]) => (call[1] as { clientUuid: string }).clientUuid);
const queuedUuids = (): string[] => mockRows.map((r) => r.clientUuid);

beforeEach(() => {
  // A critical log schedules quick retries; keep them inside the test.
  jest.useFakeTimers();
  post.mockReset();
  (captureError as jest.Mock).mockReset();
  (track as jest.Mock).mockReset();
  mockRows.length = 0;
  mockDb.available = true;
  mockDb.failWrite = false;
  mockDb.failQuery = false;
  useSyncStore.setState({ outboxCount: 0 });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("enqueuePendingWrite", () => {
  const input = (clientUuid: string, critical = false) => ({
    kind: "bp" as const,
    payload: { clientUuid, targetUserId: "user-2", systolic: 128, diastolic: 82, version: 1 },
    critical,
    takenAtIso: "2026-10-26T08:00:00.000Z",
  });

  it("stores the exact POST body, the profile and when it was taken", async () => {
    await expect(enqueuePendingWrite(input("u1"))).resolves.toBe(true);
    expect(mockRows).toHaveLength(1);
    expect(mockRows[0]).toMatchObject({
      clientUuid: "u1",
      userId: "user-2",
      kind: "bp",
      critical: false,
      takenAt: Date.parse("2026-10-26T08:00:00.000Z"),
    });
    expect(JSON.parse(mockRows[0]!.payloadJson)).toEqual(input("u1").payload);
    expect(useSyncStore.getState().outboxCount).toBe(1);
  });

  it("stores a clientUuid once; the repeat is a quiet no-op", async () => {
    post.mockResolvedValue({ data: {} });
    await expect(enqueuePendingWrite(input("u1", true))).resolves.toBe(true);
    await expect(enqueuePendingWrite(input("u1", true))).resolves.toBe(true);
    expect(queuedUuids()).toEqual(["u1"]);
    expect(track).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60_000);
    // One set of quick retries: delivered on the first, then nothing left.
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("returns false when there is no local DB", async () => {
    mockDb.available = false;
    await expect(enqueuePendingWrite(input("u1"))).resolves.toBe(false);
  });

  it("returns false, and reports to Sentry, when the write fails", async () => {
    mockDb.failWrite = true;
    await expect(enqueuePendingWrite(input("u1"))).resolves.toBe(false);
    expect(captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ where: "pendingWrites.enqueue" }),
    );
  });

  it("a critical log is retried within seconds, not on the next 60s tick", async () => {
    post.mockResolvedValue({ data: {} });
    await enqueuePendingWrite(input("u-crit", true));
    expect(post).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(sentUuids()).toEqual(["u-crit"]);
    expect(queuedUuids()).toEqual([]);
  });

  it("a normal log waits for the regular drain", async () => {
    post.mockResolvedValue({ data: {} });
    await enqueuePendingWrite(input("u-normal"));
    await jest.advanceTimersByTimeAsync(60_000);
    expect(post).not.toHaveBeenCalled();
  });
});

describe("drainPendingWrites", () => {
  it("sends each row to its endpoint and removes it once the server has it", async () => {
    queue("b1", "bp", "2026-10-26T08:00:00Z");
    queue("c1", "cardiac", "2026-10-26T08:01:00Z");
    queue("r1", "respiratory", "2026-10-26T08:02:00Z");
    queue("m1", "meal", "2026-10-26T08:03:00Z");
    post.mockResolvedValue({ data: {} });

    await expect(drainPendingWrites()).resolves.toEqual({ pushed: 4, failed: 0, held: 0 });
    expect(post.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      "/readings/bp",
      "/readings/cardiac",
      "/readings/respiratory",
      "/meals",
    ]);
    expect(post.mock.calls[0][1]).toEqual({
      clientUuid: "b1",
      targetUserId: "user-1",
      version: 1,
    });
    expect(queuedUuids()).toEqual([]);
    expect(useSyncStore.getState().outboxCount).toBe(0);
  });

  it("sends critical logs first, newest first, then the rest oldest first", async () => {
    // The per-category cooldown lets only the first critical alert: it must
    // be the one closest to now, not last night's.
    queue("old", "meal", "2026-10-26T07:00:00Z");
    queue("crit-night", "bp", "2026-10-25T22:00:00Z", true);
    queue("new", "bp", "2026-10-26T09:00:00Z");
    queue("crit-morning", "bp", "2026-10-26T06:00:00Z", true);
    post.mockResolvedValue({ data: {} });
    await drainPendingWrites();
    expect(sentUuids()).toEqual(["crit-morning", "crit-night", "old", "new"]);
  });

  it.each(["READING_STALE_VERSION", "MEAL_STALE_VERSION"])(
    "a 409 %s means the server already has it: removed, not reported",
    async (code) => {
      queue("m1", "meal", "2026-10-26T08:00:00Z");
      post.mockRejectedValue(coded(409, code));
      await expect(drainPendingWrites()).resolves.toEqual({ pushed: 1, failed: 0, held: 0 });
      expect(queuedUuids()).toEqual([]);
      expect(captureError).not.toHaveBeenCalled();
    },
  );

  it("a disabled feature (503) keeps its row and lets the rows behind it through", async () => {
    queue("c1", "cardiac", "2026-10-26T08:00:00Z");
    queue("b1", "bp", "2026-10-26T08:01:00Z");
    post.mockRejectedValueOnce(coded(503, "CARDIAC_DISABLED")).mockResolvedValueOnce({ data: {} });
    await expect(drainPendingWrites()).resolves.toEqual({ pushed: 1, failed: 0, held: 1 });
    expect(queuedUuids()).toEqual(["c1"]);
  });

  it("deletes a row the server refused for good, and reports it to Sentry", async () => {
    queue("b1", "bp", "2026-10-26T08:00:00Z");
    post.mockRejectedValue(coded(400, "VALIDATION_ERROR"));
    await expect(drainPendingWrites()).resolves.toEqual({ pushed: 0, failed: 1, held: 0 });
    expect(queuedUuids()).toEqual([]);
    expect(captureError).toHaveBeenCalledWith(
      expect.any(AxiosError),
      expect.objectContaining({ where: "drainPendingWrites.drop", kind: "bp", status: 400 }),
    );
  });

  it("never deletes a critical log, even when refused, and reports it to Sentry", async () => {
    queue("crit-refused", "bp", "2026-10-26T08:00:00Z", true);
    post.mockRejectedValue(coded(400, "VALIDATION_ERROR"));
    await expect(drainPendingWrites()).resolves.toEqual({ pushed: 0, failed: 0, held: 1 });
    expect(queuedUuids()).toEqual(["crit-refused"]);
    // That reading will never alert anyone: Sentry, not just analytics.
    expect(captureError).toHaveBeenCalledWith(
      expect.any(AxiosError),
      expect.objectContaining({ where: "drainPendingWrites.holdCritical", kind: "bp" }),
    );
  });

  it("a 5xx from one endpoint holds that kind only: a critical BP still goes", async () => {
    queue("resp-crit", "respiratory", "2026-10-26T09:05:00Z", true);
    queue("resp-2", "respiratory", "2026-10-26T08:00:00Z");
    queue("bp-crit", "bp", "2026-10-26T09:00:00Z", true);
    post.mockImplementation((url: string) =>
      url === "/readings/respiratory"
        ? Promise.reject(httpError(500, ""))
        : Promise.resolve({ data: {} }),
    );
    await expect(drainPendingWrites()).resolves.toEqual({ pushed: 1, failed: 0, held: 2 });
    // One respiratory request, not one per row.
    expect(sentUuids()).toEqual(["resp-crit", "bp-crit"]);
    expect(queuedUuids().sort()).toEqual(["resp-2", "resp-crit"]);
  });

  it("keeps a row on a 4xx it doesn't recognise and moves on", async () => {
    queue("other-profile", "bp", "2026-10-26T08:00:00Z");
    queue("b2", "bp", "2026-10-26T08:01:00Z");
    post.mockRejectedValueOnce(coded(403, "AUTH_UNAUTHORIZED")).mockResolvedValueOnce({ data: {} });
    await expect(drainPendingWrites()).resolves.toEqual({ pushed: 1, failed: 0, held: 1 });
    expect(queuedUuids()).toEqual(["other-profile"]);
  });

  it.each([
    ["no network", networkError()],
    ["maintenance (503)", coded(503, "MAINTENANCE_MODE")],
    ["an expired session (401)", coded(401, "AUTH_TOKEN_EXPIRED")],
    ["the per-minute limit (429)", httpError(429, "Too many requests")],
  ])("stops on %s and keeps every row", async (_label, err) => {
    queue("b1", "bp", "2026-10-26T08:00:00Z");
    queue("b2", "bp", "2026-10-26T08:01:00Z");
    post.mockRejectedValue(err);
    await expect(drainPendingWrites()).resolves.toEqual({ pushed: 0, failed: 0, held: 0 });
    expect(post).toHaveBeenCalledTimes(1);
    expect(queuedUuids()).toEqual(["b1", "b2"]);
    expect(useSyncStore.getState().outboxCount).toBe(2);
  });

  it("keeps a row it can't read instead of deleting it", async () => {
    mockAddRow({
      clientUuid: "bad",
      userId: "user-1",
      kind: "bp",
      payloadJson: "{not json",
      critical: false,
      takenAt: 1,
      queuedAt: 1,
    });
    queue("future", "glucose_v2" as PendingWriteKind, "2026-10-26T08:00:00Z");
    await expect(drainPendingWrites()).resolves.toEqual({ pushed: 0, failed: 0, held: 2 });
    expect(post).not.toHaveBeenCalled();
    expect(queuedUuids().sort()).toEqual(["bad", "future"]);
  });

  it("a drain asked for while one runs doesn't run alongside it, but right after", async () => {
    queue("b1", "bp", "2026-10-26T08:00:00Z");
    let land: (v: unknown) => void = () => undefined;
    post.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    const first = drainPendingWrites();
    await jest.advanceTimersByTimeAsync(0);
    // A critical log queued after the running drain read the table.
    queue("crit-late", "cardiac", "2026-10-26T08:05:00Z", true);
    await expect(drainPendingWrites()).resolves.toEqual({ pushed: 0, failed: 0, held: 0 });
    expect(post).toHaveBeenCalledTimes(1);
    post.mockResolvedValue({ data: {} });
    land({ data: {} });
    await expect(first).resolves.toEqual({ pushed: 1, failed: 0, held: 0 });
    await jest.advanceTimersByTimeAsync(0);
    expect(sentUuids()).toEqual(["b1", "crit-late"]);
    expect(queuedUuids()).toEqual([]);
  });

  it("a local failure doesn't leave the queue stuck: the next drain runs", async () => {
    queue("b1", "bp", "2026-10-26T08:00:00Z");
    mockDb.failQuery = true;
    await expect(drainPendingWrites()).rejects.toThrow("SQLite busy");
    mockDb.failQuery = false;
    post.mockResolvedValue({ data: {} });
    await expect(drainPendingWrites()).resolves.toEqual({ pushed: 1, failed: 0, held: 0 });
  });
});

describe("saving while offline (cardiac, respiratory, meals)", () => {
  const cardiac = (heartRate: number): SaveCardiacInput => ({
    userId: "user-3",
    heartRate,
    source: "manual",
    measuredAtIso: "2026-10-26T08:00:00.000Z",
  });

  it("a cardiac log that can't be sent is stored, critical when the HR is", async () => {
    post.mockRejectedValue(networkError());
    await expect(saveCardiacLog(cardiac(35))).resolves.toEqual({
      kind: "queued",
      clientUuid: "uuid-new",
    });
    expect(mockRows).toHaveLength(1);
    expect(mockRows[0]).toMatchObject({ kind: "cardiac", userId: "user-3", critical: true });
    expect(JSON.parse(mockRows[0]!.payloadJson)).toMatchObject({
      clientUuid: "uuid-new",
      heartRate: 35,
      targetUserId: "user-3",
    });
  });

  it("keeps the caller's clientUuid, so a retry of the same entry is a replay", async () => {
    post.mockRejectedValue(networkError());
    await expect(saveCardiacLog({ ...cardiac(72), clientUuid: "entry-1" })).resolves.toEqual({
      kind: "queued",
      clientUuid: "entry-1",
    });
    expect(mockRows[0]?.clientUuid).toBe("entry-1");
  });

  it("a normal cardiac log is stored as not critical", async () => {
    post.mockRejectedValue(networkError());
    await saveCardiacLog(cardiac(72));
    expect(mockRows[0]).toMatchObject({ critical: false });
  });

  it("maintenance mode (503) is queued, the cardiac kill switch (503) is not", async () => {
    post.mockRejectedValueOnce(coded(503, "MAINTENANCE_MODE"));
    await expect(saveCardiacLog(cardiac(72))).resolves.toMatchObject({ kind: "queued" });
    post.mockRejectedValueOnce(coded(503, "CARDIAC_DISABLED"));
    await expect(saveCardiacLog(cardiac(72))).resolves.toMatchObject({
      kind: "rejected",
      code: "CARDIAC_DISABLED",
    });
    expect(mockRows).toHaveLength(1);
  });

  it("an expired session (401) is queued, not lost", async () => {
    post.mockRejectedValue(coded(401, "AUTH_TOKEN_EXPIRED"));
    await expect(saveCardiacLog(cardiac(72))).resolves.toMatchObject({ kind: "queued" });
  });

  it("says 'not saved' when the log couldn't be stored on the phone", async () => {
    mockDb.available = false;
    post.mockRejectedValue(networkError());
    await expect(saveCardiacLog(cardiac(72))).resolves.toEqual({ kind: "network_failed" });
  });

  it("a respiratory log with severe symptoms is stored as critical", async () => {
    post.mockRejectedValue(networkError());
    await expect(
      saveRespiratoryLog({
        userId: "user-3",
        symptomSeverity: "severe",
        inhalerUsed: false,
        source: "manual",
        measuredAtIso: "2026-10-26T08:00:00.000Z",
      }),
    ).resolves.toMatchObject({ kind: "queued" });
    expect(mockRows[0]).toMatchObject({ kind: "respiratory", critical: true });
  });

  it("the respiratory kill switch is reported, not queued", async () => {
    post.mockRejectedValue(coded(503, "RESPIRATORY_DISABLED"));
    await expect(
      saveRespiratoryLog({
        userId: "user-3",
        peakFlow: 400,
        source: "manual",
        measuredAtIso: "2026-10-26T08:00:00.000Z",
      }),
    ).resolves.toMatchObject({ kind: "rejected", code: "RESPIRATORY_DISABLED" });
    expect(mockRows).toHaveLength(0);
  });

  it("a meal that can't be sent is stored; one the server refuses is not", async () => {
    post.mockRejectedValueOnce(networkError());
    const meal = {
      userId: "user-3",
      mealType: "lunch" as const,
      mealCategory: "heavy_fried" as const,
      loggedAtIso: "2026-10-26T13:00:00.000Z",
    };
    await expect(saveMealLog(meal)).resolves.toMatchObject({ kind: "queued" });
    expect(mockRows[0]).toMatchObject({
      kind: "meal",
      critical: false,
      takenAt: Date.parse(meal.loggedAtIso),
    });

    post.mockRejectedValueOnce(coded(400, "VALIDATION_ERROR"));
    await expect(saveMealLog(meal)).resolves.toMatchObject({ kind: "rejected", status: 400 });
    expect(mockRows).toHaveLength(1);
  });

  it("end to end: a log saved offline reaches the server on the next drain", async () => {
    post.mockRejectedValueOnce(networkError());
    await saveCardiacLog(cardiac(72));
    post.mockResolvedValueOnce({ data: {} });
    await drainPendingWrites();
    expect(post.mock.calls[1]).toEqual([
      "/readings/cardiac",
      expect.objectContaining({ clientUuid: "uuid-new", heartRate: 72, targetUserId: "user-3" }),
    ]);
    expect(mockRows).toHaveLength(0);
  });
});
