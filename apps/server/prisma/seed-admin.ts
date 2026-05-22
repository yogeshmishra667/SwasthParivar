// Bootstrap the first admin-console account (a super_admin).
//
// Run once, after the admin_console migration is applied:
//   ADMIN_BOOTSTRAP_EMAIL=you@example.com \
//   ADMIN_BOOTSTRAP_PASSWORD='a-strong-password' \
//   pnpm --filter @swasth/server admin:seed
//
// The account is created with TOTP NOT yet enrolled — the first login
// forces 2FA enrolment before any session is issued. Idempotent: a
// second run for the same email is a no-op.

// This is a one-shot CLI script: console is the user-facing output
// channel, not the server's structured pino logger.
/* eslint-disable no-console */

import bcrypt from "bcryptjs";
import { env } from "../src/config/env.js";
import { prisma, disconnectDatabase } from "../src/shared/database.js";

const BCRYPT_COST = 12;

const seedAdmin = async (): Promise<void> => {
  const email = env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = env.ADMIN_BOOTSTRAP_PASSWORD;

  if (!email || !password) {
    console.error(
      "admin:seed needs ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD set.\n" +
        "  ADMIN_BOOTSTRAP_EMAIL=you@example.com \\\n" +
        "  ADMIN_BOOTSTRAP_PASSWORD='a-strong-password' \\\n" +
        "  pnpm --filter @swasth/server admin:seed",
    );
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(
      `Admin account already exists for ${email} (role: ${existing.role}) — nothing to do.`,
    );
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const admin = await prisma.adminUser.create({
    data: {
      email,
      passwordHash,
      name: "Super Admin",
      role: "super_admin",
      active: true,
      totpEnabled: false,
    },
  });

  console.log(
    `Created super_admin ${admin.email}.\n` +
      "Next: open the admin console and log in — you will be prompted to\n" +
      "enrol TOTP 2FA before your first session is issued.",
  );
};

seedAdmin()
  .catch((err: unknown) => {
    console.error("admin:seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
