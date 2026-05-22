# Admin Console — Build Progress

> **Live tracker for the admin/ops control console.** Design rationale lives in
> `docs/admin-dashboard-plan.md`. This file is the resume point: to continue the build,
> read this file, find the first unchecked task, and continue from there.
>
> **Conventions:** `[ ]` todo · `[~]` in progress · `[x]` done. Append a dated entry to
> the Session Log whenever you stop. Tick tasks only when fully done (typecheck + lint
> clean for that slice).

**Status:** M0 + M1 done — the full admin API surface (server typecheck + lint clean).
**Next task:** M2-T1 — scaffold the `@swasth/admin` Vite + React workspace package.

---

## M0 — RBAC backend foundation ✅

- [x] **M0-T1** Port the plan into the repo — `docs/admin-dashboard-plan.md` + this file.
- [x] **M0-T2** Prisma schema: `AdminRole` enum, `AdminUser`, `AdminAuditLog` models.
- [x] **M0-T3** Hand-written migration `20260527000000_admin_console`; `prisma:generate`.
- [x] **M0-T4** New `ErrorCode`s + `shared-types/src/admin.ts`; map codes in error handler.
- [x] **M0-T5** `env.ts` admin secrets; removed `ADMIN_API_TOKEN` + deleted `admin-auth.ts`.
- [x] **M0-T6** `admin-rbac.ts` middleware (`requireAdminAuth`, `requireAdminRole`).
- [x] **M0-T7** `shared/admin/audit.ts` — `recordAdminAction` helper.
- [x] **M0-T8** `modules/admin/auth/` — login + TOTP enrol/confirm/verify + refresh/me.
- [x] **M0-T9** `prisma/seed-admin.ts` + `admin:seed` script.

## M1 — Admin API surface (registry-driven) ✅

- [x] **M1-T1** `modules/admin/registry/` — `AdminResourceRegistry` (15 resources).
- [x] **M1-T2** `modules/admin/users/` — list/search + detailed 360° user view +
      lazy registry resource panels (sensitive panels role-gated + audit-logged).
- [x] **M1-T3** `modules/admin/analytics/` — metric-registry KPIs (`/overview`,
      `/:key`); 8 live DB metrics + 3 PostHog-sourced metrics surfaced as unavailable
      until a PostHog query client is wired.
- [x] **M1-T4** User mutations — tier change (audited). NOTE: **deactivate deferred** —
      `User` has no `active`/`deactivatedAt` field; adding one + enforcing it in patient
      auth is a patient-facing change, out of scope for an additive admin API. Revisit
      with the team / Phase 4.
- [x] **M1-T5** `modules/admin/ops/` — `/ops/queues` (BullMQ depth), `/ops/health`
      (db+redis probe), `/ops/maintenance` (kill switch). super_admin/ops.
- [x] **M1-T6** `modules/admin/flags/` — moved flags module into `flags/`; typed
      `RolloutConfig` validation (rollout objects validated, config objects pass).
- [x] **M1-T7** Flag control endpoints — `POST /flags/:key/rollback`,
      `GET /flags/:key/evaluate?userId=`, `PATCH /flags/:key/cohort`.
- [x] **M1-T8** `modules/admin/admins/` — admin-account CRUD (list/create/update/
      reset-password), super_admin only, self-lockout guard.
- [x] **M1-T9** `modules/admin/audit/` — `GET /admin/audit` (filter by action / actor).
- [x] **M1-T10** `admin.routes.ts` mounts all sub-routers: `/auth`, `/users`,
      `/analytics`, `/flags`, `/ops`, `/admins`, `/audit` (all behind `requireAdminAuth`).

## M2 — Frontend scaffold + component library

- [ ] **M2-T1** New `@swasth/admin` workspace package (Vite + React + TS).
- [ ] **M2-T2** shadcn/ui + shared component library.
- [ ] **M2-T3** App shell — auth, routing, layout, theming.
- [ ] **M2-T4** Typed API client + frontend `userPanelRegistry`.
- [ ] **M2-T5** Extend CI with admin lint/typecheck/build.

## M3 — Frontend pages

- [ ] **M3-T1** Login (password → TOTP → enrolment).
- [ ] **M3-T2** Overview dashboard.
- [ ] **M3-T3** Users — table + detailed user page.
- [ ] **M3-T4** Analytics.
- [ ] **M3-T5** App Control (flags, kill switches, maintenance, feature map).
- [ ] **M3-T6** Ops / Health.
- [ ] **M3-T7** Admin Users (RBAC management).
- [ ] **M3-T8** Audit Log.
- [ ] **M3-T9** Billing & Plans (scaffold).

## M4 — Verify, harden, document

- [ ] **M4-T1** Server integration tests (Testcontainers).
- [ ] **M4-T2** Frontend component tests.
- [ ] **M4-T3** Full `verify` gate.
- [ ] **M4-T4** Docs: `docs/admin-dashboard.md`, finalize this file, `.env.example`.

---

## Session log

### 2026-05-22 — Session 1

- Planning complete; plan approved. Design doc: `docs/admin-dashboard-plan.md`.
- Decisions locked: monorepo (`apps/admin` SPA), Vite+React, email+password+TOTP 2FA,
  detailed (audit-logged) patient data, registry-driven design for Phase 4 + monetization.
- **M0 complete** — full RBAC backend:
  - Prisma: `AdminRole` enum, `AdminUser` + `AdminAuditLog` models, migration
    `20260527000000_admin_console` (hand-written; tables additive, non-locking).
  - `admin-rbac.ts` (`requireAdminAuth` loads the account fresh per request so
    deactivation is instant; `requireAdminRole`), `shared/admin/audit.ts`.
  - `modules/admin/auth/` — email+password+TOTP login (otplib v13 functional API),
    challenge→verify two-stage flow, refresh in httpOnly cookie, `/me`.
  - `seed-admin.ts` + `admin:seed` script; old shared-token `admin-auth.ts` removed.
  - Server + shared-types typecheck and lint clean.
- Notes for next session: otplib installed is **v13** (functional API: `generateSecret`/
  `generateURI`/`verify` — no `authenticator` object). `shared-types` resolves types
  from `src` but runtime from `dist` — build it before running the server/integration
  tests. The seed script lives in `prisma/` and is typechecked via a tsconfig include.
- **M0 committed + pushed** — branch `admin/console`, commit `88ce488`. No PR opened.
- **M1-T1 / T2 / T4 done** (server + shared-types typecheck + lint clean):
  - `AdminResourceRegistry` — 15 user-scoped resources (glucose, BP, meals, meds,
    insights, health scores, chat, guardian signals/alerts, family links, contacts,
    push tokens). Add a Phase 4 entity = one registry entry.
  - `modules/admin/users/` — `GET /admin/users` (search + offset paging),
    `GET /admin/users/:id` (360° detail: profile + co-profiles + streak + notif
    state + panel list), `GET /admin/users/:id/resources/:key` (lazy panel; sensitive
    → support+ role gate + `patient_data_viewed` audit), `PATCH /admin/users/:id/tier`
    (super_admin/ops, audited).
  - New error code `ADMIN_NOT_FOUND` (404). Patient DTOs added to `shared-types/admin.ts`.
  - Admin uses **offset pagination** (admin grids want page jumps), deliberately
    differing from the patient API's cursor convention.
- **M1-T6 / T7 / T9 done** (server typecheck + lint clean):
  - `modules/admin/flags/` — flags module moved into its own folder with a service
    layer; `GET /flags`, `GET /flags/:key`, `GET /flags/:key/audit`,
    `GET /flags/:key/evaluate?userId=` (rollout preview), `PUT /flags/:key`,
    `POST /flags/:key/rollback`, `PATCH /flags/:key/cohort`. Writes super_admin/ops.
  - Typed rollout validation: a flag value object carrying a `rollout` key MUST be a
    valid `cohort` / `percentage` / `cohort_or_percentage` shape; plain config objects
    still pass. Flag-key regex now allows dots (e.g. `auth.otp.provider`) — the old
    regex silently rejected dotted keys via the admin API.
  - `modules/admin/audit/` — `GET /admin/audit` (filter by action / adminUserId,
    offset paged), super_admin/ops only.
  - Old flat `flags.controller.ts` / `flags.validation.ts` removed; `admin.routes.ts`
    now mounts `/auth`, `/users`, `/flags`, `/audit` sub-routers.
- **M1-T5 / T8 / T3 done — M1 COMPLETE** (server typecheck + lint clean):
  - `modules/admin/ops/` — `/ops/queues` (per-queue BullMQ counts, memoised Queue
    handles), `/ops/health` (db + redis probe), `POST /ops/maintenance` (toggles the
    `maintenance_mode` kill switch). Whole router super_admin/ops.
  - `modules/admin/admins/` — admin-account CRUD: list, create (bcrypt, TOTP
    un-enrolled), update role/active, reset-password. super_admin only; an admin
    cannot demote or deactivate their own account (lockout guard).
  - `modules/admin/analytics/` — metric registry: `GET /analytics/overview` +
    `GET /analytics/:key`. 8 live DB metrics (user growth, tier distribution,
    reading volume + voice ratio, chat cost tiers, chat safety, guardian health,
    streak distribution, med adherence) + 3 PostHog metrics (critical-bypass SMS
    success, voice success, retention) registered but `available:false` with a note.
- **Full admin API now live** under `/admin/*`. Next: M2 — the `apps/admin` frontend.
- Reminder: M1 work is **uncommitted** on `admin/console`.
