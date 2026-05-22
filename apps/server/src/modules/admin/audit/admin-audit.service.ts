// Admin audit-log reader. Lists rows from the Postgres `admin_audit_logs`
// table (written by recordAdminAction on every admin mutation + sensitive
// view), joined to the acting admin's email.

import type { Prisma } from "@prisma/client";
import type { AdminAuditLogDto } from "@swasth/shared-types";
import { prisma } from "../../../shared/database.js";

export interface AdminAuditPage {
  records: AdminAuditLogDto[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export const listAuditLog = async (params: {
  action?: string;
  adminUserId?: string;
  limit: number;
  offset: number;
}): Promise<AdminAuditPage> => {
  const where: Prisma.AdminAuditLogWhereInput = {
    ...(params.action ? { action: params.action } : {}),
    ...(params.adminUserId ? { adminUserId: params.adminUserId } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: params.limit,
      skip: params.offset,
      include: { adminUser: { select: { email: true } } },
    }),
    prisma.adminAuditLog.count({ where }),
  ]);

  const records: AdminAuditLogDto[] = rows.map((row) => ({
    id: row.id,
    adminUserId: row.adminUserId,
    adminEmail: row.adminUser.email,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    // metadata is always written as an object (or omitted) — see audit.ts.
    metadata: (row.metadata ?? null) as unknown as Record<string, unknown> | null,
    ip: row.ip,
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    records,
    total,
    limit: params.limit,
    offset: params.offset,
    hasMore: params.offset + rows.length < total,
  };
};
