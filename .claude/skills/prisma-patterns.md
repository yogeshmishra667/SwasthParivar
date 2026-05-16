---
name: prisma-patterns
description: Prisma + TimescaleDB patterns for SwasthParivar. Load when touching schema.prisma, migrations, hypertables, glucose/BP reading queries, sync conflict resolution, or cursor pagination.
---

# Prisma + TimescaleDB Patterns

## Singleton client

Never instantiate `new PrismaClient()` inside request handlers. One singleton:

```ts
// apps/server/src/shared/database/prisma.ts
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") global.__prisma = prisma;
```

Pool: `min=2, max=10`. Set via `DATABASE_URL=...?connection_limit=10`.

## TimescaleDB hypertables

Prisma does not manage hypertables. After `prisma migrate dev` generates the migration, append raw SQL to the migration file:

```sql
SELECT create_hypertable('"GlucoseReading"', 'measured_at', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS gr_user_measured_idx
  ON "GlucoseReading" (user_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS gr_user_type_measured_idx
  ON "GlucoseReading" (user_id, reading_type, measured_at DESC);
```

Hypertables in this project: `GlucoseReading`, `BPReading`, `CardiacLog`, `RespiratoryLog`, `MealLog`, `MedicationLog`, `ActivityDaily`, `SleepLog`, `InsightEvent`, `ChatMessage`, `SilentGuardianSignal`.

Compression policy (enable later, after 30-day data accumulates):

```sql
SELECT add_compression_policy('"GlucoseReading"', INTERVAL '30 days');
```

## Same-type reading query (CRITICAL)

Never mix fasting with post_meal in any comparison. Always filter `reading_type`:

```ts
const last7dFasting = await prisma.glucoseReading.findMany({
  where: {
    user_id,
    reading_type: "fasting",
    measured_at: { gte: subDays(now, 7) },
  },
  orderBy: { measured_at: "desc" },
});
```

For the feedback engine 7-day rolling median, require ≥ 3 same-type readings in window, else fall back to last-same-type comparison (see `feedback-engine.ts`).

## Sync idempotent upsert (strict version check)

```ts
async function upsertReading(input: ReadingInput) {
  const existing = await prisma.glucoseReading.findUnique({
    where: { client_uuid: input.client_uuid },
  });

  if (!existing) {
    return prisma.glucoseReading.create({ data: input });
  }

  if (input.version <= existing.version) {
    throw new ConflictError("READING_STALE_VERSION", 409);
  }

  return prisma.glucoseReading.update({
    where: { client_uuid: input.client_uuid },
    data: { ...input, version: input.version },
  });
}
```

Strict `>` — equal versions rejected. Device must always increment on edit.

## Cursor pagination

Never offset. Always cursor on `(measured_at, id)`:

```ts
const pageSize = 50;
const cursor = req.query.cursor
  ? JSON.parse(Buffer.from(req.query.cursor, "base64").toString())
  : undefined;

const rows = await prisma.glucoseReading.findMany({
  where: {
    user_id,
    ...(cursor && {
      OR: [
        { measured_at: { lt: new Date(cursor.t) } },
        { measured_at: new Date(cursor.t), id: { lt: cursor.id } },
      ],
    }),
  },
  orderBy: [{ measured_at: "desc" }, { id: "desc" }],
  take: pageSize + 1,
});

const hasMore = rows.length > pageSize;
const data = rows.slice(0, pageSize);
const nextCursor = hasMore
  ? Buffer.from(JSON.stringify({ t: data.at(-1)!.measured_at, id: data.at(-1)!.id })).toString(
      "base64",
    )
  : undefined;

return { data, cursor: nextCursor, hasMore };
```

## Raw SQL (only for TimescaleDB)

Use `prisma.$queryRaw` for `time_bucket` and continuous aggregates. Always parameterize:

```ts
// ✅
const buckets = await prisma.$queryRaw<BucketRow[]>`
  SELECT time_bucket('1 day', measured_at) AS day,
         AVG(value_mg_dl)::int AS avg_value
  FROM "GlucoseReading"
  WHERE user_id = ${user_id}
    AND reading_type = ${reading_type}
    AND measured_at >= ${start}
  GROUP BY day
  ORDER BY day DESC
`;

// ❌ Never string-concat user input
const bad = await prisma.$queryRawUnsafe(`... WHERE user_id = '${user_id}'`);
```

## Transactions

Wrap multi-write flows (save reading + update streak + write FeedbackEvent):

```ts
await prisma.$transaction(async (tx) => {
  const reading = await tx.glucoseReading.create({ data });
  const streak = await tx.userStreak.update({ where: { user_id }, data: nextStreak });
  await tx.feedbackEvent.create({ data: feedback });
  return { reading, streak };
});
```

Enqueue BullMQ jobs **after** the transaction commits, never inside — otherwise a rolled-back row can trigger jobs on nonexistent data.

## Soft delete

`deleted_at: DateTime?` + `updated_at: DateTime`. Never hard-delete medical data. Sync payloads include `deleted_at` so clients mirror tombstones.

## What NOT to do

- No `PrismaClient` in `packages/domain-logic/` — the purity rule in `tsconfig` blocks this anyway.
- No `findFirst({ orderBy })` with offset pagination on hypertables — always cursor.
- No `prisma.$queryRawUnsafe` with interpolated input.
- No Prisma migrations that drop hypertable columns without a TimescaleDB-aware plan.
