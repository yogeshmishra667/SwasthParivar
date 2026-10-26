// Audit P4 review C1 — BP has no local queue, so a network failure must
// read "not saved" (never "saved locally"). A CRITICAL BP is re-sent in
// the background with the SAME clientUuid, so the server sees an
// idempotent replay and the family alert still goes out.
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

beforeEach(() => {
  jest.useFakeTimers();
  post.mockReset();
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
