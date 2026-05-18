// Idempotency helper (phase3.md CC.2). Generalises the
// `clientUuid + version` pattern that originated in readings.service.ts
// so ChatMessage and SOSEvent can reuse the same semantics without
// duplicating the version-compare branches.
//
// Why this exists as its own helper:
//   1. Three Phase-3 surfaces persist user-generated rows with
//      `client_uuid` as the idempotency key (glucose reading, chat
//      message, SOS event). If each reimplements the version compare,
//      stale-version semantics will drift.
//   2. The version-compare logic is pure decision work — easy to unit
//      test in isolation here, without spinning up Postgres.
//   3. Concurrent-write race recovery (P2002 on the unique index)
//      stays at the call site because each model has a different
//      composite key shape. The helper covers the happy path; the
//      caller wraps the create() with the P2002 catch.
//
// Contract:
//   - Pass a Prisma model that supports `findFirst({ where: { clientUuid } })`
//     and exposes a numeric `version` column.
//   - Pass the incoming `clientUuid` and `version` from the request.
//   - Get back one of four outcomes; act on each.
//
//      ┌─────────────┬───────────────────────────────────────────────┐
//      │ outcome     │ caller action                                  │
//      ├─────────────┼───────────────────────────────────────────────┤
//      │ insert      │ create the row                                 │
//      │ replay      │ rebuild the prior response (no side effects)  │
//      │ update      │ in-place update on the existing row           │
//      │ stale       │ throw {CODE}_STALE_VERSION                    │
//      └─────────────┴───────────────────────────────────────────────┘

export type IdempotencyOutcome<T> =
  | { readonly kind: "insert" }
  | { readonly kind: "replay"; readonly existing: T }
  | { readonly kind: "update"; readonly existing: T }
  | { readonly kind: "stale"; readonly existing: T };

// Structural shape we need from any Prisma model. Kept narrow so the
// helper is decoupled from `@prisma/client` — handy for unit tests
// (drop in a stub) and for any future non-Prisma backing store.
export interface IdempotentModel<TRow> {
  findFirst(args: { where: { clientUuid: string } }): Promise<TRow | null>;
}

export interface VersionedRow {
  version: number;
}

export const checkIdempotent = async <TRow extends VersionedRow>(
  model: IdempotentModel<TRow>,
  clientUuid: string,
  incomingVersion: number,
): Promise<IdempotencyOutcome<TRow>> => {
  const existing = await model.findFirst({ where: { clientUuid } });
  if (!existing) return { kind: "insert" };
  if (incomingVersion < existing.version) return { kind: "stale", existing };
  if (incomingVersion === existing.version) return { kind: "replay", existing };
  return { kind: "update", existing };
};
