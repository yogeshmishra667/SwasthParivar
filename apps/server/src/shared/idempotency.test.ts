import { describe, expect, it } from "vitest";
import { checkIdempotent, type IdempotentModel, type VersionedRow } from "./idempotency.js";

interface FakeRow extends VersionedRow {
  id: string;
  clientUuid: string;
  payload: string;
}

// Lightweight in-memory stand-in for a Prisma model. The helper only
// reads `findFirst({ where: { clientUuid } })`, so a single-key map
// is all we need to exercise every branch.
const makeStubModel = (rows: readonly FakeRow[]): IdempotentModel<FakeRow> => ({
  findFirst: ({ where: { clientUuid } }) =>
    Promise.resolve(rows.find((r) => r.clientUuid === clientUuid) ?? null),
});

const UUID = "00000000-0000-0000-0000-000000000001";

describe("checkIdempotent", () => {
  it("returns `insert` when no row matches the clientUuid", async () => {
    const result = await checkIdempotent(makeStubModel([]), UUID, 1);
    expect(result).toEqual({ kind: "insert" });
  });

  it("returns `replay` when incoming version equals stored version", async () => {
    const existing: FakeRow = { id: "r1", clientUuid: UUID, version: 3, payload: "a" };
    const result = await checkIdempotent(makeStubModel([existing]), UUID, 3);
    expect(result.kind).toBe("replay");
    if (result.kind === "replay") {
      // Narrow to the discriminated arm — TS preserves `existing` typing.
      expect(result.existing).toBe(existing);
    }
  });

  it("returns `update` when incoming version is newer than stored", async () => {
    const existing: FakeRow = { id: "r1", clientUuid: UUID, version: 3, payload: "a" };
    const result = await checkIdempotent(makeStubModel([existing]), UUID, 4);
    expect(result.kind).toBe("update");
    if (result.kind === "update") {
      expect(result.existing).toBe(existing);
    }
  });

  it("returns `stale` when incoming version is older than stored", async () => {
    const existing: FakeRow = { id: "r1", clientUuid: UUID, version: 3, payload: "a" };
    const result = await checkIdempotent(makeStubModel([existing]), UUID, 2);
    expect(result.kind).toBe("stale");
    if (result.kind === "stale") {
      expect(result.existing).toBe(existing);
    }
  });

  it("treats version 1 as stale when stored version is 2 (regression guard)", async () => {
    // Mobile bug pattern: an old offline retry arrives after a newer
    // edit synced from a different device. Must reject the older one.
    const existing: FakeRow = { id: "r1", clientUuid: UUID, version: 2, payload: "newer" };
    const result = await checkIdempotent(makeStubModel([existing]), UUID, 1);
    expect(result.kind).toBe("stale");
  });

  it("scopes the lookup to the requested clientUuid only", async () => {
    const other: FakeRow = {
      id: "r2",
      clientUuid: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      version: 9,
      payload: "different",
    };
    const result = await checkIdempotent(makeStubModel([other]), UUID, 5);
    expect(result.kind).toBe("insert");
  });
});
