// Admin-account management — list, create, update (role / active), and
// password reset. super_admin only (gated at the router).

import bcrypt from "bcryptjs";
import type { AdminUser } from "@prisma/client";
import { DomainError, type AdminRole, type AdminUserDto } from "@swasth/shared-types";
import { prisma } from "../../../shared/database.js";

const BCRYPT_COST = 12;

const toDto = (a: AdminUser): AdminUserDto => ({
  id: a.id,
  email: a.email,
  name: a.name,
  role: a.role,
  active: a.active,
  totpEnabled: a.totpEnabled,
  lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
  createdAt: a.createdAt.toISOString(),
});

export const listAdmins = async (): Promise<AdminUserDto[]> => {
  const rows = await prisma.adminUser.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(toDto);
};

export const createAdmin = async (input: {
  email: string;
  name: string;
  role: AdminRole;
  password: string;
}): Promise<AdminUserDto> => {
  const email = input.email.toLowerCase();
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    throw new DomainError("VALIDATION_ERROR", "an admin account with this email already exists");
  }
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  // New accounts start with TOTP un-enrolled — first login forces 2FA setup.
  const created = await prisma.adminUser.create({
    data: {
      email,
      name: input.name,
      role: input.role,
      passwordHash,
      active: true,
      totpEnabled: false,
    },
  });
  return toDto(created);
};

export const updateAdmin = async (params: {
  id: string;
  actorId: string;
  role?: AdminRole;
  active?: boolean;
}): Promise<AdminUserDto> => {
  const target = await prisma.adminUser.findUnique({ where: { id: params.id } });
  if (!target) throw new DomainError("ADMIN_NOT_FOUND", "admin account not found");

  // Lockout guard — an admin cannot demote or disable their own account.
  if (params.id === params.actorId) {
    if (params.active === false) {
      throw new DomainError("ADMIN_FORBIDDEN", "you cannot deactivate your own account");
    }
    if (params.role !== undefined && params.role !== "super_admin") {
      throw new DomainError("ADMIN_FORBIDDEN", "you cannot drop your own super_admin role");
    }
  }

  const updated = await prisma.adminUser.update({
    where: { id: params.id },
    data: {
      ...(params.role !== undefined ? { role: params.role } : {}),
      ...(params.active !== undefined ? { active: params.active } : {}),
    },
  });
  return toDto(updated);
};

export const resetAdminPassword = async (id: string, password: string): Promise<{ id: string }> => {
  const target = await prisma.adminUser.findUnique({ where: { id } });
  if (!target) throw new DomainError("ADMIN_NOT_FOUND", "admin account not found");
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  await prisma.adminUser.update({ where: { id }, data: { passwordHash } });
  return { id };
};
