// Admin user inspection — list/search patient users, the detailed 360°
// view, per-resource panels, and the tier-change mutation.
//
// The 360° view does not embed every entity inline: it returns the
// profile + a list of registered resource panels, and each panel is
// fetched lazily through the AdminResourceRegistry. Sensitive panels are
// role-gated here and audit-logged by the controller.

import type { Prisma, User } from "@prisma/client";
import {
  DomainError,
  type AdminPatientDetail,
  type AdminPatientList,
  type AdminPatientListItem,
  type AdminResourcePanelData,
  type AdminRole,
  type AdminTier,
  type AdminTierChangeResult,
  type AdminUserActivationResult,
} from "@swasth/shared-types";
import { prisma } from "../../../shared/database.js";
import { resolveFeatures } from "../../config/config.service.js";
import { adminResources, getAdminResource } from "../registry/admin-resource.registry.js";
import { roleAtLeast } from "../registry/admin-resource.types.js";

const toListItem = (u: User): AdminPatientListItem => ({
  id: u.id,
  name: u.name,
  phone: u.phone,
  age: u.age,
  tier: u.tier,
  conditions: u.conditions,
  onboardingComplete: u.onboardingComplete,
  householdId: u.householdId,
  createdAt: u.createdAt.toISOString(),
  active: u.active,
  deactivatedAt: u.deactivatedAt?.toISOString() ?? null,
  deactivationReason: u.deactivationReason,
});

export const listUsers = async (params: {
  search?: string;
  limit: number;
  offset: number;
}): Promise<AdminPatientList> => {
  const { search, limit, offset } = params;
  const where: Prisma.UserWhereInput =
    search && search.length > 0
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { phone: { contains: search } },
          ],
        }
      : {};

  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    prisma.user.count({ where }),
  ]);

  return {
    users: rows.map(toListItem),
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total,
  };
};

export const getUserDetail = async (userId: string): Promise<AdminPatientDetail> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new DomainError("ADMIN_NOT_FOUND", "patient user not found");

  const [coProfiles, streak, notificationState] = await Promise.all([
    prisma.user.findMany({
      where: { householdId: user.householdId, id: { not: user.id } },
      orderBy: { createdAt: "asc" },
      take: 20,
    }),
    prisma.userStreak.findUnique({ where: { userId } }),
    prisma.notificationState.findUnique({ where: { userId } }),
  ]);

  return {
    user: {
      ...toListItem(user),
      gender: user.gender,
      preferredLanguage: user.preferredLanguage,
      timezone: user.timezone,
      onboardingStep: user.onboardingStep,
      timeAnomalyCount: user.timeAnomalyCount,
      updatedAt: user.updatedAt.toISOString(),
    },
    coProfiles: coProfiles.map(toListItem),
    streak,
    notificationState,
    panels: adminResources().map((r) => ({
      key: r.key,
      label: r.label,
      description: r.description,
      sensitive: r.sensitive,
    })),
  };
};

export const getUserResource = async (params: {
  userId: string;
  key: string;
  role: AdminRole;
  limit: number;
  offset: number;
}): Promise<AdminResourcePanelData> => {
  const resource = getAdminResource(params.key);
  if (!resource) {
    throw new DomainError("ADMIN_NOT_FOUND", `unknown resource: ${params.key}`);
  }
  if (resource.sensitive && !roleAtLeast(params.role, "support")) {
    throw new DomainError("ADMIN_FORBIDDEN", "this resource requires the support role or above");
  }
  // Confirm the patient exists so an unknown id is a clean 404 rather
  // than a silently-empty page.
  const exists = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true },
  });
  if (!exists) throw new DomainError("ADMIN_NOT_FOUND", "patient user not found");

  const page = await resource.fetch(params.userId, {
    limit: params.limit,
    offset: params.offset,
  });

  return {
    key: resource.key,
    label: resource.label,
    sensitive: resource.sensitive,
    rows: page.rows,
    total: page.total,
    limit: params.limit,
    offset: params.offset,
    hasMore: page.hasMore,
  };
};

/**
 * Resolved feature map for one patient user — the same payload the
 * mobile app sees from `GET /api/v1/config/features`. Plan's "App
 * control surface" calls for an admin viewer so ops can answer
 * "what does this user actually see right now". Read-only — rollout
 * is changed via `/admin/flags/:key`.
 */
export const getUserFeatureMap = async (
  userId: string,
): Promise<{ userId: string; features: Record<string, boolean> }> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) throw new DomainError("ADMIN_NOT_FOUND", "patient user not found");
  const resolved = await resolveFeatures(userId);
  return { userId, features: resolved.features };
};

// ── Soft-disable (Phase 4 Week 13 admin carry-over) ─────────────────
//
// `active=false` blocks the auth surface (send-otp, verify-otp,
// refresh) so the patient cannot start a new session. Existing access
// tokens stay valid until they expire (≤1h). No data is deleted —
// retention follows the tier-downgrade rule. Reactivation is fully
// reversible; full medical history reappears on first refresh.
//
// Re-applying the same state is a no-op (idempotent) and DOES NOT
// audit-log: the controller skips its audit write when
// `previouslyActive === !targetActive` would be false. This keeps the
// audit trail trustworthy as a list of real transitions.

/** Payload accepted by `deactivateUser` (admin perspective). */
export interface DeactivateUserParams {
  userId: string;
  reason: string;
  adminUserId: string;
}

export const deactivateUser = async (
  params: DeactivateUserParams,
): Promise<AdminUserActivationResult> => {
  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) throw new DomainError("ADMIN_NOT_FOUND", "patient user not found");

  if (!user.active) {
    // Idempotent — return the existing terminal state without touching
    // `deactivatedAt`/`deactivationReason` (preserving the original
    // record of who first disabled the account).
    return {
      id: user.id,
      active: false,
      previouslyActive: false,
      deactivatedAt: user.deactivatedAt?.toISOString() ?? null,
      deactivationReason: user.deactivationReason,
    };
  }

  const updated = await prisma.user.update({
    where: { id: params.userId },
    data: {
      active: false,
      deactivatedAt: new Date(),
      deactivationReason: params.reason,
      deactivatedByAdminId: params.adminUserId,
    },
  });

  return {
    id: updated.id,
    active: false,
    previouslyActive: true,
    deactivatedAt: updated.deactivatedAt?.toISOString() ?? null,
    deactivationReason: updated.deactivationReason,
  };
};

export const reactivateUser = async (userId: string): Promise<AdminUserActivationResult> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new DomainError("ADMIN_NOT_FOUND", "patient user not found");

  if (user.active) {
    return {
      id: user.id,
      active: true,
      previouslyActive: true,
      deactivatedAt: null,
      deactivationReason: null,
    };
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      active: true,
      // Clear the audit fields on reactivation so the next deactivation
      // gets a fresh record. The AdminAuditLog row from the original
      // deactivation is the persistent trail of "who turned this off".
      deactivatedAt: null,
      deactivationReason: null,
      deactivatedByAdminId: null,
    },
  });

  return {
    id: updated.id,
    active: true,
    previouslyActive: false,
    deactivatedAt: null,
    deactivationReason: null,
  };
};

export const changeUserTier = async (params: {
  userId: string;
  tier: AdminTier;
}): Promise<AdminTierChangeResult> => {
  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) throw new DomainError("ADMIN_NOT_FOUND", "patient user not found");

  const previousTier: AdminTier = user.tier;
  if (previousTier === params.tier) {
    return { id: user.id, previousTier, tier: params.tier };
  }

  const updated = await prisma.user.update({
    where: { id: params.userId },
    data: { tier: params.tier },
  });
  return { id: updated.id, previousTier, tier: updated.tier };
};
