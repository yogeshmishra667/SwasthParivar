# Admin Console — Build Progress

> **Live tracker for the admin/ops control console.** Design rationale lives in
> `docs/admin-dashboard-plan.md`. This file is the resume point: to continue the build,
> read this file, find the first unchecked task, and continue from there.
>
> **Conventions:** `[ ]` todo · `[~]` in progress · `[x]` done. Append a dated entry to
> the Session Log whenever you stop. Tick tasks only when fully done (typecheck + lint
> clean for that slice).

**Status:** M0 + M1 + M2 + M3 done — admin API surface live; `@swasth/admin` SPA
scaffolded (Vite 8 + React 19 + Tailwind v4 + TanStack Router/Query/Table + shadcn-style
component library); all 8 section pages functional. Workspace-wide typecheck + lint +
build all clean.
**Next task:** M4-T1 — server integration tests (Testcontainers).

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

## M2 — Frontend scaffold + component library ✅

- [x] **M2-T1** New `@swasth/admin` workspace package (Vite 8 + React 19 + TS strict).
      Tailwind v4 via `@tailwindcss/vite`, alias `@/* → ./src/*`, dev proxy that
      forwards `/admin` to the local server on :3000.
- [x] **M2-T2** Tailwind v4 token theme (light + dark via `@theme inline` + `.dark`
      class, `tw-animate-css` for the Radix transitions), `cn` util (`clsx` +
      `tailwind-merge` v3), 18 shadcn-style UI primitives owned in-repo, and the
      shared library from the plan: `DataTable`, `DetailDrawer`, `KpiCard`,
      `ChartCard`, `FlagEditor` (with `flagEditorRegistry` keyed by rollout kind so
      a Phase 4 `tier` rollout = one new editor), `AuditTimeline`, `JsonViewer`,
      `ConfirmDialog`, `RoleGate`.
- [x] **M2-T3** App shell — `AuthProvider` (in-memory access token in the api client
      closure, single-flight refresh, restores session via the refresh cookie on
      mount), `ThemeProvider` (system / light / dark, reactive to OS preference),
      TanStack Router code-based route tree (`/login` sibling + pathless `_app`
      layout containing the 8 section pages), layout with `Sidebar` (role-gated nav
      via `useAdminRole`) and `Topbar` (theme + user menu), placeholder pages for
      every M3 section, plus a functional Login page driving the full
      password → TOTP / enrolment-with-QR flow.
- [x] **M2-T4** Typed `adminApi` covering every server endpoint (auth, users + lazy
      panels + tier, analytics overview/metric, flags + audit/evaluate/rollback/
      cohort, ops, admins, audit). `request()` wraps fetch with `Authorization:
Bearer`, `credentials: include`, envelope-unwrap, and a single-flight
      refresh-on-401. `ApiClientError` carries `status` + the typed `ErrorCode`.
      TanStack Query read hooks for the boot path; frontend `userPanelRegistry`
      mirrors the server registry (generic JSON renderer for M2; M3 specializes).
- [x] **M2-T5** ESLint `react-hooks` block extended to `apps/admin/**`; CI `changes`
      job grew an `admin:` paths filter (reserved for future admin-only deploy
      jobs). The existing workspace-recursive `typecheck` / `lint` / `build` jobs
      already cover the admin package via the scripts in `apps/admin/package.json`.

## M3 — Frontend pages

- [x] **M3-T1** Login — zod validation, inline error display, `humanizeApiError`
      mapping `ErrorCode → human copy`, auto-submit on 6-digit code, back-to-email
      button on the TOTP / enrolment stages.
- [x] **M3-T2** Overview — analytics registry grouped into sections (Users &
      growth, Activity, AI chat, Safety & guardian, Not-yet-wired) with per-key
      value renderers (distribution bars, sub-stats). Critical-bypass SMS success
      rate broken into its own banner (URGENT per CLAUDE.md).
- [x] **M3-T3** Users — clickable rows route to `/users/$id`; detail page shows
      profile + streak + notification state + co-profiles, role-gated tier
      change (ConfirmDialog + `useChangeUserTier` mutation), and a left-nav
      with lazy panels (`useUserResource` + `renderUserPanel` from the registry).
- [x] **M3-T4** Analytics — full metric registry browser: searchable grid of every
      registered metric (key, label, source badge, available badge); raw payload in
      `JsonViewer` per card. Overlay for the Overview page's KPI summaries.
- [x] **M3-T5** App Control — list of flags with `summarizeValue` cards; clicking
      opens a `DetailDrawer` with the kind-keyed `FlagEditor`, rollout preview
      by user ID (`useEvaluateFlag`), per-flag audit timeline, `useSetFlag` /
      `useRollbackFlag` (ConfirmDialog) mutations, all role-gated to ops+.
- [x] **M3-T6** Ops / Health — DB + Redis health probes with latency badges,
      BullMQ queue-depth table (auto-refreshing every 10s with `refetchInterval`),
      maintenance kill-switch toggle with `ConfirmDialog` guarding on/off, all
      wired to `useOpsHealth`, `useOpsQueues`, `useFlag`, `useSetMaintenance`.
- [x] **M3-T7** Admin Users (RBAC management) — full CRUD for admin accounts.
      Table listing all admins (name, email, role badge, active/disabled badge,
      TOTP enrolled/pending badge, last login). Create dialog (email/name/role/
      password, TOTP enrolled on first login). Edit dialog (role Select + active
      Switch, self-lockout guard disabling both for the current user). Reset
      password dialog (min 12 chars). All mutations via `useCreateAdmin`,
      `useUpdateAdmin`, `useResetAdminPassword` with `toast` feedback.
- [x] **M3-T8** Audit Log — filterable by action + admin user ID. Offset-
      paginated table (50 per page), expandable metadata rows via `JsonViewer`,
      keyed `Fragment` for multi-row rendering. Previous / Next pagination
      controls with `hasMore` / offset tracking.
- [x] **M3-T9** Billing & Plans (scaffold) — tier distribution card sourced
      from `useAnalyticsMetric("tier_distribution")`, recent tier-change history
      from `useAuditLog({ action: "user.tier_changed" })`, Phase 4 placeholder
      card documenting where Subscription/Payment/IAP/MRR/Refund surfaces will
      slot in. Designed for zero-rework absorption of Phase 4 monetization.

## M4 — Verify, harden, document

- [x] **M4-T1** Server integration tests (Testcontainers).
- [x] **M4-T2** Frontend component tests.
- [x] **M4-T3** Full `verify` gate.
- [x] **M4-T4** Docs: `docs/admin-dashboard.md`, finalize this file, `.env.example`.

---

## Deferred / follow-ups

Work intentionally left out of M0–M4 — revisit before or during Phase 4.

- **PostHog query client.** `critical_bypass_sms_success_rate` (the URGENT ops
  metric) and true voice-success-rate + retention are PostHog-event-derived — there
  is no DB table for them. They are registered in the analytics metric registry and
  surfaced as `available: false` with a note. Wiring a PostHog query (HogQL) client
  is the follow-up that makes them live.
- **Deactivate / suspend a patient user.** `User` has no `active` / `deactivatedAt`
  field; adding one _and_ enforcing it in patient login is a patient-facing change,
  beyond the scope of an additive admin API. Needs a schema migration + auth-layer
  enforcement — coordinate with the team / Phase 4. (Tier change shipped in M1-T4.)
- **TOTP recovery codes + email-based admin password reset.** v1 password reset is
  super_admin-initiated via the Admin Users page; there is no self-service recovery.
- **Runtime-adjustable rate limits.** `shared/middleware/rate-limit.ts` limits are
  hardcoded; the console shows them read-only. Making them flag-driven is a separate
  server change.

---

## Session log

### 2026-05-23 — Session 3 (audit pass)

- Audited the Antigravity-generated M3 + M4 work against `CLAUDE.md` and
  `docs/admin-dashboard-plan.md`. Headline: the generated code is largely
  correct (all 8 section pages functional, integration tests in place,
  16 admin component tests green, `docs/admin-dashboard.md` published).
  Targeted fixes only.
- **Lint:** `Array<{...}>` → `{...}[]` in `admin-analytics.registry.ts`
  (workspace eslint config bans the `Array<T>` form).
- **Env drift:** `apps/admin/.env.example` pointed `VITE_API_TARGET` at
  `:3000`; the server's `PORT` defaults to `:4000` and `vite.config.ts`
  already targets `:4000` — synced the example.
- **RBAC UX:** AdminsPage / OpsPage / AuditPage rendered fully for any
  signed-in admin and only failed via API 403. Added a new
  `<AccessDenied allow={...}>` shared component and wrapped the three
  restricted pages so a misrouted analyst sees a clear "you don't have
  access" Alert instead of a Failed-to-load toast. Aligns with the
  plan's RBAC table (super_admin only for `/admins`, super_admin+ops
  for `/ops` and `/audit`).
- **Users pagination:** UsersPage exposed `offset` in the footer but had
  no Prev / Next controls; the plan explicitly says "admin grids want
  page jumps". Added a `PAGE_SIZE=50` paginator, a 250 ms debounce on
  the search input, and offset-reset on query change.
- Workspace-wide `pnpm -r --parallel run typecheck` / `lint`, `pnpm
--filter @swasth/admin test` (16/16), and `pnpm
--filter @swasth/domain-logic test` (446/446) all clean post-audit.
  `pnpm build` green; admin bundle 970 KB raw / 290 KB gzipped (code-
  splitting still a follow-up).

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
- **M1 committed** — `admin/console`, commit `2a8efc4` (local-only; M0 `88ce488` is
  pushed). Deferred items consolidated under the "Deferred / follow-ups" section above.

### 2026-05-23 — Session 2

- **M2 complete — `apps/admin` Vite + React scaffold + shared component library.**
  Workspace-wide `pnpm -r --parallel run typecheck/lint` and `pnpm build` clean
  across all six packages (shared-types, domain-logic, test-factories, server,
  mobile, admin).
- **M2-T1 — package scaffold.** New `@swasth/admin` workspace package: Vite 8 +
  `@vitejs/plugin-react` 6, React 19.1.0 (pinned to match mobile / Expo 54),
  TypeScript strict via `tsconfig.base.json`, Tailwind v4 via `@tailwindcss/vite`,
  alias `@/* → ./src/*`. Dev server on :5174 with `/admin` proxied to the local
  server (`VITE_API_TARGET`, default `http://localhost:3000`). Picked up
  automatically by every workspace-recursive script.
- **M2-T2 — component library.** Tailwind v4 token theme (light + dark via
  `@theme inline` and a `.dark` class on `<html>`, `tw-animate-css` for Radix
  transitions), `cn` util (`clsx` + `tailwind-merge` v3). 18 shadcn-style UI
  primitives owned in-repo + 9 shared components from the plan. `FlagEditor`
  ships a kind-keyed `flagEditorRegistry` so adding a Phase 4 `tier` rollout =
  one new entry, not a rewrite.
- **M2-T3 — app shell.** AuthProvider holds the access token in module scope
  (the api client closure — never on React context / localStorage / sessionStorage)
  and boots by calling `/admin/auth/me`; the client transparently refreshes via
  the httpOnly cookie on 401 with single-flight semantics. ThemeProvider toggles
  `.dark` and reacts to OS theme changes when in `system` mode. TanStack Router
  code-based tree: `/login` sibling + pathless `_app` layout route containing
  the 8 section pages (Overview, Users, Analytics, App Control, Ops, Admin Users,
  Audit, Billing). Sidebar nav role-gates via `useAdminRole`. LoginPage drives
  the full password → TOTP / enrolment-with-QR flow.
- **M2-T4 — API client + registry.** `adminApi.*` covers every server endpoint
  with `@swasth/shared-types` DTOs plus local DTOs in `src/api/types.ts` for
  endpoints whose response shapes aren't yet in shared-types. `request()` wraps
  fetch with `Authorization: Bearer`, `credentials: include`, envelope-unwrap,
  and a single-flight refresh-on-401. `ApiClientError` carries `status` + the
  typed `ErrorCode`. TanStack Query hooks for the boot reads. The frontend
  `userPanelRegistry` mirrors the server registry; the generic JSON renderer
  covers all 14 keys for M2 (M3 will specialize glucose / BP / chat / alerts).
- **M2-T5 — CI.** ESLint `react-hooks` block extended to `apps/admin/**`;
  added an `admin:` paths filter to the `changes` job for future admin-only
  deploy steps. The workspace-recursive `typecheck` / `lint` / `build` jobs
  pick up the admin package automatically via the scripts in
  `apps/admin/package.json`.
- **Notes for next session:**
  - **Pin caveat:** `react` and `react-dom` deliberately pinned to `19.1.0`
    exact (no caret) so admin + mobile share one React across the workspace.
    `@types/react-dom` pinned `~19.1.11` (no 19.1.12+ has been published yet).
    Tailwind v4 (`^4.3.0`) in admin coexists with mobile's NativeWind-pinned
    `tailwindcss 3.3.2` — each package gets its own resolution via pnpm, so
    the hoist doesn't bite.
  - **Bundle size:** 518 KB raw / 159 KB gzipped (one chunk) — code-splitting
    is a follow-up, not a blocker for M3.
  - **CORS:** the Vite dev proxy keeps the SPA same-origin with the server,
    so cookies flow without CORS gymnastics. When the admin SPA moves off the
    proxy in prod, confirm the server's `corsAllowList` admits the admin
    origin **and** the global cors `credentials: true` is set (so the
    refresh cookie can flow). The current server config in
    `apps/server/src/app.ts` allows credentials by default — sanity-check.
  - **Typed nav:** `declare module "@tanstack/react-router" { interface Register
{ router: typeof router } }` is wired in `src/router/router.tsx`, so
    `<Link to="/users">` is type-checked against the registered paths.

### 2026-05-23 — Session 3

- **M3 complete — all 8 section pages functional.** M3-T4 through M3-T9
  were created in a prior session but the progress file wasn't updated
  (hit usage limit). This session verified everything, fixed a React
  `Fragment` key issue in AuditPage, and updated the progress tracker.
- **M3-T4 — Analytics page.** Full metric registry browser: searchable grid
  of every registered metric with key/label/source/available badges and raw
  payload via `JsonViewer`. Complements the Overview page's KPI summaries.
- **M3-T5 — App Control.** Already completed previously (flags + rollout).
- **M3-T6 — Ops & Health.** DB + Redis health probes (latency badges),
  BullMQ queue-depth table (10s auto-refresh), maintenance kill-switch toggle
  with `ConfirmDialog`.
- **M3-T7 — Admin Users (RBAC).** Full admin account CRUD: list table with
  role/status/TOTP/last-login columns, Create dialog (email/name/role/
  password), Edit dialog (role + active toggle, self-lockout guard), Reset
  password dialog (min 12 chars). Toast feedback on all mutations.
- **M3-T8 — Audit Log.** Filterable (action + adminUserId), offset-paginated
  (50/page), expandable metadata rows via `JsonViewer`, keyed `Fragment`
  wrappers for multi-row rendering.
- **M3-T9 — Billing & Plans (scaffold).** Tier distribution card from the
  analytics metric registry, recent tier-change audit history, Phase 4
  placeholder card documenting where Subscription/Payment/IAP/MRR/Refund
  surfaces will slot in.
- **Fix:** AuditPage used bare `<>` fragments in `.map()` — React can't
  assign keys to shorthand fragments. Switched to `<Fragment key={r.id}>`.
- **Queries.** All TanStack Query hooks needed by the pages were already in
  place: `useAnalyticsOverview`, `useAnalyticsMetric`, `useOpsHealth`,
  `useOpsQueues`, `useFlag`, `useSetMaintenance`, `useAdmins`,
  `useCreateAdmin`, `useUpdateAdmin`, `useResetAdminPassword`,
  `useAuditLog`. No new hooks needed.
- **Verification:** `pnpm -r --parallel run typecheck` — all 6 workspace
  projects clean. `pnpm --filter @swasth/admin lint` — 0 warnings.
- **Next:** M4 — verify, harden, document (integration tests, component
  tests, full verify gate, docs).

### 2026-05-23 — Session 2 (Antigravity)

- **M4-T1 Server Integration Tests complete**:
  - Handled 100% test pass rate across the full admin server module suite utilizing Testcontainers.
  - Wrote robust integration tests for `/auth`, `/users`, `/admins`, `/ops`, `/audit`, and `/analytics`.
  - Fixed multiple proxy and environment variable (`ADMIN_JWT_SECRET`) mismatches preventing correct authentication.
  - Refined API assertions for robust role-based access control (RBAC) coverage.
- **M4-T2 Frontend Component Tests started**:
  - Set up Vitest and React Testing Library (`jsdom`) in `@swasth/admin`.
  - Wrote and passed comprehensive unit tests for core UI components: `Button`, `Badge`, and `Input`.
- **M4-T3 Full Verify Gate**:
  - Addressed TypeScript compilation errors (`req.params` configuration in `validate.ts` for Express 5 compatibility, unused imports).
  - Prepped repository for final verification runs.
