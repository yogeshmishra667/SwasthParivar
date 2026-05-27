# Admin Dashboard & Control Console

The SwasthParivar Admin Dashboard provides a centralized, RBAC-secured web interface for managing the platform. It handles everything from detailed user analytics and support workflows to advanced feature flag rollouts and infrastructure monitoring.

## 1. Feature Flag & Rollout Control (`/admin/flags`)

The core of the "App Control" dashboard manages the CC.12 rollout gate, enabling precise feature access management.

### Recent Enhancements:

- **Dynamic Type Switching:** Added a dropdown switcher that allows you to instantly convert any existing flag between five different types:
  - **Boolean (Kill Switch):** Global On/Off toggle.
  - **Percentage Rollout:** Deterministic hashing assigns 0-100% of the traffic.
  - **Cohort Allowlist:** Only specific user IDs gain access.
  - **Cohort + Percentage:** Cohort members are guaranteed access, plus a percentage of remaining traffic.
  - **Raw JSON / String:** Generic configuration values (e.g. `auth.otp.provider`).
- **New Flag Creation:** Added a **"New flag"** button on the App Control page that lets you create a new rollout key from scratch and immediately configure its rollout strategy.
- **Rollback & Audit:** Every change (including type conversions and percentage adjustments) is tracked in the audit log with a 1-click rollback feature.

## 2. Analytics & Overview (`/admin/analytics`)

The dashboard features a registry-driven analytics pipeline that aggregates both DB metrics and PostHog time-series data.

- **KPI Metrics:** Track total users, retention, AI safety metrics, and system stability (like critical-bypass SMS delivery rates).
- **PostHog Integration:** Configured to pull data securely via HogQL directly onto the dashboard, generating time-series graphs for daily user growth and volume.

## 3. User Management & Support (`/admin/users`)

- **360° Detailed View:** The user detail drawer dynamically pulls from the `AdminResourceRegistry` to give support staff complete read-only context on a patient's chat history, alerts, and medical logs.
- **Action Mutations:** Authorized roles can manually edit a user's tier, suspend/deactivate accounts, or perform audit-logged interventions.

## 4. Ops & Infrastructure (`/admin/ops`)

- Monitor active Redis BullMQ queue lengths for the background job workers (e.g., summary generators, notification dispatchers).
- **Global Maintenance Toggle:** Easily flip the system into maintenance mode during critical outages.

## Architecture

The admin console is structured as a Vite + React SPA (`apps/admin`) backed by an Express 5 API (`apps/server/src/modules/admin`).

- **Registry-driven:** All metrics, user data panels, and feature flag types are strictly defined in registries (e.g., `AdminResourceRegistry` and `flagEditorRegistry`), meaning Phase 4 expansions will slot in automatically without UI rewrites.
- **RBAC Security:** Handled transparently by `requireAdminRole(...)` middleware checking `super_admin`, `ops`, `support`, or `analyst` privileges.

_See `admin-dashboard-plan.md` for historical design decisions and Phase 4 Monetization scaffolding._
