# SwasthParivar — Admin / Ops Control Console — Plan

> Design document for the internal admin console. The live build status is tracked in
> `admin-dashboard-progress.md` at the repo root. This file is the "why + what"; the
> progress file is the "where we are".

---

## Context

Phases 1–3 of SwasthParivar (the patient/guardian chronic-care app) are complete.
Before Phase 4 (scaling: cardiac/respiratory logs, prescription OCR, doctors,
appointments, activity/sleep, wearables, **payments/Razorpay**), we need an internal
**admin / ops control console**: analytics, detailed user data, a feature-flag/rollout
**control plane**, and role-gated staff access.

It is an **out-of-phase operational tool**. Constraints:

- Do **not** alter patient-facing phase code beyond adding read-only admin APIs.
- Do **not** touch existing spec/progress files: `CLAUDE.md`, `audit-progress.md`,
  `phase-3-progress.md`, `phase3.md`. The new `admin-dashboard-progress.md` tracks this work.
- Preserve `packages/domain-logic` purity — no admin imports may leak into it.

**Outcome:** a production-grade console the solo dev (and future staff) uses to operate
the platform — watch the URGENT `critical_bypass_sms_success_rate`, inspect users in
full detail for support, control feature rollout safely with an audit trail — and which
is **built to absorb Phase 4 and future paid features without rework**.

There is **no existing admin surface today** (ops is curl + `redis-cli` only). Greenfield.

---

## Architecture decision

**Monorepo, two pieces — no separate repo:**

- **Admin API** → extends the server's existing `/admin` module group in `apps/server`.
- **Admin UI** → new `apps/admin` workspace package: a Vite + React **static SPA**.

**Why monorepo:** `@swasth/shared-types` gives one type-checked API contract across
server + UI; atomic commits; single `pnpm install`. A separate repo loses all of that.

**Does this make the codebase "heavy"? No.** pnpm workspace packages are isolated
build/deploy units: the server runtime image and the mobile bundle are both unaffected
(`tsc` only compiles `apps/server/src`; Metro only bundles `apps/mobile`). The admin UI
is a static SPA deployed separately. Real cost: slightly longer `pnpm install`, one
extra CI job — trivial.

---

## Engineering principles (apply to every task)

Requirement: **fully reusable, refactored, best-practice code.** Concretely:

1. **Registry-driven, not hardcoded.** Phase 4 grows enums (`SignalSource`,
   `AlertChannel`, `ChatCostTier`) and adds ~9 entities (cardiac, respiratory,
   prescriptions, doctors, appointments, activity, sleep). So:
   - **Server `AdminResourceRegistry`** — each user-scoped domain entity registers one
     small typed module `{ key, label, sensitive, minRole, fetch(userId, page) }`.
     Adding a Phase 4 entity = add one panel file + one registry line. No controller edits.
   - **Frontend panel registry** mirrors it: the User Detail page maps over the registry.
   - **Frontend `flagEditorRegistry`** keyed by rollout kind — adding a kind (e.g. a
     future `tier` kind for paid gating) = register one editor component.
   - **Metric registry** for analytics — Phase 4 metrics slot in as registry entries.
2. **Reuse existing infra — do not reinvent:** flag service `shared/flags/*`, rollout
   resolver `shared/rollout.ts` + `evaluateRollout`, response helper `shared/http.ts`
   (`ok`), `DomainError`/`ErrorCode`, zod middleware `shared/validate.ts`, the existing
   controller/service/routes/validation/types module pattern (`modules/auth/*`).
3. **Thin controllers, typed services, zod at the edge.** Same as the rest of the server.
4. **One shared component library** on the frontend (`DataTable`, `DetailDrawer`,
   `KpiCard`, `ChartCard`, `FlagEditor`, `AuditTimeline`, `JsonViewer`, `ConfirmDialog`,
   `RoleGate`) — pages are composition, never bespoke one-offs.
5. **No Phase-3-specific assumptions in UI** — render enums/signal-sources/channels
   from data, so Phase 4 values appear automatically.

---

## Stack

**Backend (existing):** Express 5, Prisma 7, PostgreSQL 16 + TimescaleDB, Redis, BullMQ.
New deps — all tiny: `otplib` (TOTP), `qrcode` (enrollment QR). `bcryptjs` +
`jsonwebtoken` already present.

**Frontend `apps/admin` (new):** Vite 6 + React 19 + TypeScript strict; Tailwind v4 +
shadcn/ui (components owned in-repo); TanStack Query v5 + TanStack Table v8 + TanStack
Router (type-safe); Recharts; react-hook-form + zod. ESLint flat config + Prettier
consistent with the repo.

---

## Security model

**RBAC roles** (`AdminRole` enum): `super_admin`, `ops`, `support`, `analyst`.

| Capability                        | super_admin | ops | support | analyst |
| --------------------------------- | :---------: | :-: | :-----: | :-----: |
| Analytics / dashboards (read)     |      ✓      |  ✓  |    ✓    |    ✓    |
| Detailed user data (incl. health) |      ✓      |  ✓  |    ✓    |    —    |
| Feature flags / rollout — write   |      ✓      |  ✓  |    —    |    —    |
| Ops / queues / maintenance toggle |      ✓      |  ✓  |    —    |    —    |
| User tier change / deactivate     |      ✓      |  ✓  |    —    |    —    |
| Manage admin accounts (RBAC)      |      ✓      |  —  |    —    |    —    |
| View audit log                    |      ✓      |  ✓  |    —    |    —    |

**Authentication:** email + password (bcrypt) **+ mandatory TOTP 2FA**.

- Login is two-stage: `password` → short-lived `totpToken` → `totp/verify` → full tokens.
- Every account must enrol TOTP; a password-valid login on an un-enrolled account yields
  an **enrollment-only** session limited to `totp/enroll` + `totp/confirm`.
- Tokens: access JWT in memory on the client (~15 min, `ADMIN_JWT_SECRET`); refresh JWT
  in a `httpOnly`, `Secure`, `SameSite` cookie (`ADMIN_JWT_REFRESH_SECRET`). Separate
  secrets from the patient JWTs.

**Patient-data visibility — detailed, not aggregate.** The console shows a **full 360°
user view** (see M1-T2). Aggregates are summaries on top of detail, not a substitute.
Sensitive panels (raw glucose/BP/meal values, chat content) are still **audit-logged on
access** — every open writes an `AdminAuditLog` row (`patient_data_viewed`). This keeps
a clean access trail without restricting visibility. Honours CLAUDE.md "Sensitive NEVER
logged" by keeping raw values out of app logs while logging _access_.

**Audit:** every admin mutation + every sensitive-data view writes `AdminAuditLog`.

---

## App control surface — what the console controls in the live app

The console is a **control plane**. The server already ships the CC.12 feature-flag +
rollout machinery (`shared/flags/*`, `shared/rollout.ts`, `evaluateRollout` in
`packages/domain-logic/src/feature-rollout/rollout.ts`); the console gives it a real UI.

**Rollout config shapes already supported** (`RolloutConfig`):

- `boolean` — global on/off **kill switch**.
- `{ rollout: "cohort", userIds: [...] }` — **limited user access** / beta allowlist.
- `{ rollout: "percentage", percent: N }` — **traffic %** rollout (deterministic, stable).
- `{ rollout: "cohort_or_percentage", userIds, percent }` — both.

**Live operational flags the console must surface** (a kill-switch board): `maintenance_mode`,
`auth.otp.provider`, `ai_chat_enabled`, `ai_chat_tier3_enabled`, `silent_guardian_enabled`,
`silent_guardian_alerts_dispatch`, `correlation_detector_enabled`,
`cross_condition_detector_enabled`, `chat_retention_sweep_enabled`, `sos_enabled`.

**Console control surfaces:** typed flag editors (boolean toggle, **traffic-% slider**,
**cohort allowlist editor**), one-click **rollback** (flag audit stores `prevValue`),
per-flag audit timeline, **rollout preview** (`isFeatureEnabled` for a chosen user),
kill-switch board, confirm-guarded **maintenance mode**, a **resolved feature-map viewer**
(what `GET /api/v1/config/features` returns), and per-user controls (tier change,
deactivate, grant-beta-access by adding to a flag cohort).

**Hard guardrail (CLAUDE.md medical safety):** the console must NOT expose the hardcoded
medical constants as flags — critical-bypass thresholds (<65 / >315), bypass-chain step
ordering, the 30-min critical cooldown, the 3 AM streak boundary. These stay code-only.

---

## Monetization readiness ("some features will be paid")

CLAUDE.md puts **Payment in Phase 4** (Razorpay webhooks: `subscription.activated → tier
up`, `cancelled → downgrade`; Apple IAP for iOS). phase3.md confirms "Razorpay / paid
tier gating → Phase 4". So payments are **not implemented now** — but the console is
**designed so Phase 4 monetization slots in without rework**:

- **`tier` is a first-class managed field today.** The `User.tier` enum
  (`free | premium | family`) already exists and gates rate limits / chat caps. The
  console treats tier as an editable, audited field (M1-T4) — so a manual upgrade /
  comp / dispute fix works on day one.
- **Paid feature gating = a new rollout kind.** When Phase 4 gates features by plan, it
  adds a `tier`-aware rollout shape (e.g. `{ rollout: "tier", tiers: ["premium"] }`) to
  `evaluateRollout`. Because the console's `flagEditorRegistry` is **kind-keyed**, that
  becomes one new editor component — no rewrite.
- **Billing area is scaffolded now, populated in Phase 4.** The console reserves a
  **"Billing & Plans"** nav section. v1 shows the **tier distribution** + tier-change
  audit (data that exists today). When Phase 4 lands `Subscription` + `Payment` Prisma
  models + Razorpay webhooks, they register as `AdminResourceRegistry` entries and the
  Billing area fills in (subscription list, payment history, MRR-style metrics, refund
  / comp actions) with no structural change.
- **Cost ↔ revenue.** Phase 3 already tracks Claude cost per `ChatMessage.costTier` +
  a daily spend cap. The analytics metric-registry hosts cost metrics now and revenue
  metrics later, side by side — the groundwork for unit-economics dashboards.

We do **not** add `Subscription`/`Payment` models now (CLAUDE.md "no preemptive" rule;
they are Phase 4). We make the console's registries generic enough to absorb them.

---

## Milestones

### M0 — RBAC backend foundation

- **M0-T1** Port the plan into the project repo (this file + `admin-dashboard-progress.md`).
- **M0-T2** Prisma schema: `AdminRole` enum, `AdminUser` model (id, email unique,
  password_hash, name, role, active, totp_secret?, totp_enabled, last_login_at, timestamps),
  `AdminAuditLog` model (id, admin_user_id FK, action, target_type?, target_id?,
  metadata Json?, ip?, created_at; indexes on `(admin_user_id, created_at)` and
  `(action, created_at)`). `@@map` snake_case.
- **M0-T3** Hand-write migration `prisma/migrations/20260527000000_admin_console/migration.sql`;
  then `prisma:generate`.
- **M0-T4** `shared-types/src/api.ts`: new `ErrorCode`s — `ADMIN_INVALID_CREDENTIALS` (401),
  `ADMIN_FORBIDDEN` (403), `ADMIN_ACCOUNT_DISABLED` (403), `ADMIN_2FA_REQUIRED` (401),
  `ADMIN_2FA_INVALID` (401). New `shared-types/src/admin.ts`; export from `index.ts`.
  Map codes in `error-handler.ts`.
- **M0-T5** `config/env.ts`: add `ADMIN_JWT_SECRET`, `ADMIN_JWT_REFRESH_SECRET` (min 32,
  prod-required), `ADMIN_TOTP_ISSUER`, seed-only `ADMIN_BOOTSTRAP_EMAIL` /
  `ADMIN_BOOTSTRAP_PASSWORD`. Remove obsolete `ADMIN_API_TOKEN`; delete
  `shared/middleware/admin-auth.ts`.
- **M0-T6** `shared/middleware/admin-rbac.ts`: `requireAdminAuth` + `requireAdminRole(...)`.
  Extend Express `Request` in `types.d.ts`.
- **M0-T7** `shared/admin/audit.ts`: `recordAdminAction(...)` helper.
- **M0-T8** `modules/admin/auth/`: `POST /admin/auth/login`, `/totp/enroll`,
  `/totp/confirm`, `/totp/verify`, `/refresh`, `/logout`, `GET /admin/auth/me`.
- **M0-T9** `prisma/seed-admin.ts` + `package.json` script `admin:seed`.

### M1 — Admin API surface (registry-driven)

- **M1-T1** `modules/admin/registry/` — `AdminResourceRegistry`.
- **M1-T2** `modules/admin/users/` — list/search + detailed 360° user view.
- **M1-T3** `modules/admin/analytics/` — metric-registry-driven KPI endpoints.
- **M1-T4** User mutations — tier change, deactivate (audited).
- **M1-T5** `modules/admin/ops/` — queue stats, health, maintenance toggle.
- **M1-T6** `modules/admin/flags/` — move flags controller; typed `RolloutConfig` validation.
- **M1-T7** Flag control endpoints — rollback, evaluate, cohort patch.
- **M1-T8** `modules/admin/admins/` — admin account management.
- **M1-T9** `modules/admin/audit/` — audit log list.
- **M1-T10** Restructure `admin.routes.ts` behind RBAC.

### M2 — Frontend scaffold + reusable component library

- **M2-T1** New `@swasth/admin` workspace package.
- **M2-T2** shadcn/ui + shared component library.
- **M2-T3** App shell — auth, routing, layout, theming.
- **M2-T4** Typed API client + frontend `userPanelRegistry`.
- **M2-T5** Extend CI with admin lint/typecheck/build.

### M3 — Frontend pages

- **M3-T1** Login (password → TOTP → enrolment).
- **M3-T2** Overview dashboard.
- **M3-T3** Users — table + detailed user page.
- **M3-T4** Analytics.
- **M3-T5** App Control (flags, kill switches, maintenance, feature map).
- **M3-T6** Ops / Health.
- **M3-T7** Admin Users (RBAC management).
- **M3-T8** Audit Log.
- **M3-T9** Billing & Plans (scaffold).

### M4 — Verify, harden, document

- **M4-T1** Server integration tests (Testcontainers).
- **M4-T2** Frontend component tests.
- **M4-T3** Full `verify` gate.
- **M4-T4** Docs: `docs/admin-dashboard.md`, finalize progress file, `.env.example`.

---

## Verification

1. `prisma:generate` → server typecheck clean.
2. Apply the migration on a local / Testcontainers Postgres → `admin_users` +
   `admin_audit_logs` exist with indexes.
3. `pnpm --filter @swasth/server admin:seed` → bootstrap super_admin created.
4. Server dev run, via `curl`: login → `totpToken` → enrol TOTP → `totp/verify` → tokens;
   `GET /admin/users/:id` returns registry-driven detail + writes a `patient_data_viewed`
   audit row; `GET /admin/analytics/overview` returns KPIs incl. critical-bypass SMS rate;
   `PUT /admin/flags/:key` as `analyst` → 403, as `ops` → 200 + audit row; percentage
   rollout + `/flags/:key/evaluate` + `/flags/:key/rollback` behave.
5. Integration tests green.
6. `pnpm --filter @swasth/admin dev` → log in via 2FA, click every page; role-gated nav,
   detailed user page, flag edit in the audit timeline.
7. Full `verify` gate green; no admin imports in `packages/domain-logic`.

---

## Notes / deferred

- **Phase 4 coupling:** `Subscription`/`Payment` models, Razorpay webhooks, Apple IAP,
  tier-aware rollout kind, and the cardiac/respiratory/prescription/doctor/appointment/
  activity/sleep entities land in Phase 4. The console's registries are built to absorb
  them — each is "add a registry entry", not a rewrite.
- TOTP recovery codes and email-based password reset are deferred (v1 reset is
  super_admin-initiated via Admin Users).
- Runtime-adjustable rate limits (flag-driven `rate-limit.ts`) are deferred — v1 shows
  configured limits read-only.
- Admin SPA deploy target (static host behind auth) is an ops decision; not a code dependency.
- Branch: admin work on a dedicated branch (`admin/console`) off the current HEAD.
