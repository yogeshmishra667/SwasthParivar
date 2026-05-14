---
name: api-patterns
description: Express server module patterns for SwasthParivar — controller/service/routes/validation layout, Zod validation, typed errors, response envelope, cursor pagination, requestId middleware.
---

# Express Module Patterns

All server modules live under `apps/server/src/modules/<name>/` and follow the same 6-file layout.

## Module file layout

```
apps/server/src/modules/readings/
├── readings.controller.ts   ← thin: Zod parse → service → response
├── readings.service.ts      ← business logic, Prisma, domain-logic calls
├── readings.routes.ts       ← Router + middleware wiring
├── readings.validation.ts   ← Zod schemas
├── readings.jobs.ts         ← BullMQ processors (only if module owns jobs)
└── readings.types.ts        ← shared request/response/service types
```

## Flow: Zod → Service → Response

### validation

```ts
// readings.validation.ts
import { z } from "zod";

export const createGlucoseReadingSchema = z.object({
  body: z.object({
    client_uuid: z.string().uuid(),
    value_mg_dl: z.number().int().min(20).max(600),
    reading_type: z.enum(["fasting", "pre_meal", "post_meal", "random", "bedtime"]),
    measured_at: z.coerce.date(),
    context: z.enum(["normal", "festive"]).optional(),
    notes: z.string().max(500).optional(),
    source: z.enum(["manual", "voice", "device"]),
    version: z.number().int().positive(),
  }),
});

export type CreateGlucoseReadingInput = z.infer<typeof createGlucoseReadingSchema>["body"];
```

### controller (thin, no try/catch — `express-async-errors` handles it)

```ts
// readings.controller.ts
import type { Request, Response } from "express";
import { createGlucoseReadingSchema } from "./readings.validation";
import * as readingsService from "./readings.service";

export async function createGlucoseReading(req: Request, res: Response) {
  const { body } = createGlucoseReadingSchema.parse({ body: req.body });
  const result = await readingsService.createGlucoseReading(req.user!.id, body);
  res.status(201).json({ success: true, data: result });
}
```

### service (throws typed errors; calls into packages/domain-logic for pure logic)

```ts
// readings.service.ts
import { prisma } from "../../shared/database/prisma";
import { updateStreak } from "@swasth/domain-logic/streak-engine";
import { computeFeedback } from "@swasth/domain-logic/feedback-engine";

export async function createGlucoseReading(userId: string, input: CreateGlucoseReadingInput) {
  const history = await prisma.glucoseReading.findMany({
    where: { user_id: userId, reading_type: input.reading_type },
    orderBy: { measured_at: "desc" },
    take: 50,
  });

  const streakUpdate = updateStreak(existingStreak, input, user.timezone);
  const feedback = computeFeedback(input, history);

  return prisma.$transaction(async (tx) => {
    const reading = await tx.glucoseReading.create({ data: { ...input, user_id: userId } });
    const streak = await tx.userStreak.update({ where: { user_id: userId }, data: streakUpdate });
    await tx.feedbackEvent.create({
      data: { ...feedback, user_id: userId, reading_id: reading.id },
    });
    return { reading, streak, feedback };
  });
  // enqueue BullMQ jobs AFTER the transaction resolves, in the caller.
}
```

### routes

```ts
// readings.routes.ts
import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth";
import * as controller from "./readings.controller";

const router = Router();

router.post("/glucose", requireAuth, controller.createGlucoseReading);
router.get("/glucose", requireAuth, controller.listGlucoseReadings);

export default router;
```

Wire in `app.ts`:

```ts
import readingsRoutes from "./modules/readings/readings.routes";
app.use("/api/v1/readings", readingsRoutes);
```

## Response envelope

Success:

```ts
{ success: true, data: <payload> }
```

Error:

```ts
{ success: false, error: { code: 'READING_INVALID_VALUE', message: 'Value out of range' } }
```

Never leak stack traces. Typed error classes map to HTTP status:

```ts
// shared/errors.ts
export class TypedError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class AuthOtpExpiredError extends TypedError {
  constructor() {
    super("AUTH_OTP_EXPIRED", 401, "OTP expired");
  }
}
export class ReadingInvalidValueError extends TypedError {
  constructor() {
    super("READING_INVALID_VALUE", 400, "Out of medical range");
  }
}
// ... one class per error code from CLAUDE.md
```

Error middleware (last in `app.ts`):

```ts
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const requestId = req.id;
  if (err instanceof TypedError) {
    return res
      .status(err.status)
      .json({ success: false, error: { code: err.code, message: err.message }, requestId });
  }
  if (err instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      error: { code: "VALIDATION_FAILED", message: err.errors[0]?.message ?? "Invalid input" },
      requestId,
    });
  }
  req.logger.error({ err });
  Sentry.captureException(err, { tags: { requestId } });
  res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "Kuch gadbad hui" },
    requestId,
  });
});
```

## Error codes (from CLAUDE.md)

`AUTH_OTP_EXPIRED` 401 · `AUTH_OTP_INVALID` 401 · `AUTH_TOKEN_EXPIRED` 401 · `AUTH_UNAUTHORIZED` 403 · `READING_INVALID_VALUE` 400 · `READING_CONFIRMATION_NEEDED` 400 · `MED_SCHEDULE_NOT_FOUND` 404 · `RX_PENDING_APPROVAL` 400 · `FAMILY_LINK_EXISTS` 409 · `FAMILY_NO_ACCESS` 403 · `CHAT_RATE_LIMITED` 429 · `SOS_ALREADY_ACTIVE` 409 · `REPORT_GENERATING` 202 · `INTERNAL_ERROR` 500

## requestId middleware

```ts
// shared/middleware/request-id.ts
import { randomUUID } from "node:crypto";

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  req.id = (req.headers["x-request-id"] as string) ?? randomUUID();
  res.setHeader("X-Request-Id", req.id);
  req.logger = logger.child({ requestId: req.id, method: req.method, path: req.path });
  next();
}
```

Never log: phone numbers, OTPs, JWT tokens, patient names, medication names, glucose values, emergency contacts.

## Cursor pagination

Query: `GET /api/v1/readings/glucose?limit=50&cursor=<base64>`.

Response:

```ts
{ success: true, data: { data: Reading[], cursor?: string, hasMore: boolean } }
```

See `prisma-patterns` skill for the query.

## /api/v1/ versioning

Every route under `/api/v1/`. Version bumps are explicit — `/api/v2/` coexists with `/api/v1/` during migration.

## Graceful shutdown

```ts
process.on("SIGTERM", async () => {
  req.logger?.info?.("SIGTERM received, draining");
  server.close();
  await bullQueues.drain();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});
```

## What NOT to do

- No `try/catch` in controllers — let `express-async-errors` propagate to the error middleware.
- No business logic in controllers — parse + delegate + envelope, nothing else.
- No bare `res.json(data)` — always `{ success, data }` or `{ success: false, error }`.
- No raw library error messages in responses — map to typed errors.
- No Prisma/Redis/BullMQ imports in `packages/domain-logic/`.
- No offset pagination. Cursor only.
