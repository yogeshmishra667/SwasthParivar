---
description: Scaffold an Express server module with controller, service, routes, validation, jobs, and types.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
---

Scaffold a new module under `apps/server/src/modules/<name>/`. Arguments: `$ARGUMENTS` (module name, kebab-case).

## Phase gate

Check `CLAUDE.md` "STRICT BUILD PHASES". If this module is not allowed in the current phase, refuse and explain.

## Files to create

All under `apps/server/src/modules/<name>/`:

- `<name>.types.ts` — TypeScript types (shared request/response shapes, service return types)
- `<name>.validation.ts` — Zod schemas for each endpoint's request body/params/query
- `<name>.service.ts` — business logic. Throws typed errors from `shared/errors.ts` (e.g. `AuthOtpExpiredError`). Uses Prisma via singleton. Calls into `packages/domain-logic/` for any pure computation.
- `<name>.controller.ts` — thin. `req` → Zod parse → service call → `{ success: true, data }`. Relies on `express-async-errors` — no try/catch.
- `<name>.routes.ts` — `Router` with `/api/v1/<name>` paths. Mounts controller handlers. Applies auth middleware where needed.
- `<name>.jobs.ts` — BullMQ job definitions + processors (only if the module owns jobs).

## Wire-up

- Add `import <name>Routes from './modules/<name>/<name>.routes';` in `apps/server/src/app.ts`
- Mount: `app.use('/api/v1/<name>', <name>Routes);`
- If jobs added: register in `apps/server/src/shared/queue/index.ts`

## Conventions (enforce)

- Every controller method: Zod validate first.
- Response shape: success `{ success: true, data }`, error `{ success: false, error: { code, message } }`.
- Cursor pagination (never offset): `{ data, cursor?, hasMore }`.
- `requestId` middleware populates `req.id` → logger.
- No `any` types. No `as unknown as T` except when strictly necessary and commented.

After scaffolding, run `/verify` and report status.
