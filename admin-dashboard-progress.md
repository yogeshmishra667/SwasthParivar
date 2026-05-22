# Admin Console — Build Progress

> **Live tracker for the admin/ops control console.** Design rationale lives in
> `docs/admin-dashboard-plan.md`. This file is the resume point: to continue the build,
> read this file, find the first unchecked task, and continue from there.
>
> **Conventions:** `[ ]` todo · `[~]` in progress · `[x]` done. Append a dated entry to
> the Session Log whenever you stop. Tick tasks only when fully done (typecheck + lint
> clean for that slice).

**Status:** M0 complete (server typecheck + lint clean). Starting M1.
**Next task:** M1-T1 — `modules/admin/registry/` `AdminResourceRegistry`.

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

## M1 — Admin API surface (registry-driven)

- [ ] **M1-T1** `modules/admin/registry/` — `AdminResourceRegistry`.
- [ ] **M1-T2** `modules/admin/users/` — list/search + detailed 360° user view.
- [ ] **M1-T3** `modules/admin/analytics/` — metric-registry KPI endpoints.
- [ ] **M1-T4** User mutations — tier change, deactivate (audited).
- [ ] **M1-T5** `modules/admin/ops/` — queue stats, health, maintenance toggle.
- [ ] **M1-T6** `modules/admin/flags/` — move flags controller; `RolloutConfig` validation.
- [ ] **M1-T7** Flag control endpoints — rollback, evaluate, cohort patch.
- [ ] **M1-T8** `modules/admin/admins/` — admin account management.
- [ ] **M1-T9** `modules/admin/audit/` — audit log list.
- [ ] **M1-T10** Restructure `admin.routes.ts` behind RBAC.

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
