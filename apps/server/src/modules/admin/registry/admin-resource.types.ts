// AdminResourceRegistry — types.
//
// A "resource" is one user-scoped domain entity (GlucoseReading,
// MedicationLog, ChatMessage, …) exposed in the admin user-detail view.
// The detailed 360° view iterates the registry; adding a Phase 4 entity
// (CardiacLog, RespiratoryLog, Prescription, …) is a single new entry —
// no controller or route change. See docs/admin-dashboard-plan.md.

import type { AdminRole } from "@swasth/shared-types";

/** Offset pagination for one resource panel. */
export interface AdminResourceQuery {
  limit: number;
  offset: number;
}

/** A page of one resource's rows for one patient user. */
export interface AdminResourcePage {
  // Rows are forwarded to the console as-is and rendered generically by
  // the panel registry — the server never introspects their shape, so
  // `unknown[]` is the honest type.
  rows: unknown[];
  total: number;
  hasMore: boolean;
}

/** One user-scoped domain entity in the registry. */
export interface AdminResource {
  /** Stable key, e.g. "glucose_readings" — used in the API path + UI. */
  readonly key: string;
  /** Human-readable label for the console. */
  readonly label: string;
  /** One-line description of what the panel shows. */
  readonly description: string;
  /**
   * True when the rows are sensitive patient health data. Reading a
   * sensitive resource writes a `patient_data_viewed` audit row and is
   * denied to the `analyst` role (see the RBAC table in the plan).
   */
  readonly sensitive: boolean;
  /** Fetch one page of this resource for a single patient user. */
  readonly fetch: (userId: string, query: AdminResourceQuery) => Promise<AdminResourcePage>;
}

// Admin role rank. Linear for the purpose of the resource gate only:
// analyst is the floor; sensitive patient data needs support or above.
const ROLE_RANK: Record<AdminRole, number> = {
  analyst: 0,
  support: 1,
  ops: 2,
  super_admin: 3,
};

/** True when `role` meets or exceeds `minimum` in the admin role rank. */
export const roleAtLeast = (role: AdminRole, minimum: AdminRole): boolean =>
  ROLE_RANK[role] >= ROLE_RANK[minimum];
