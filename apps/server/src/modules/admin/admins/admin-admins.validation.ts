import { z } from "zod";

const role = z.enum(["super_admin", "ops", "support", "analyst"]);
const password = z.string().min(12).max(200);

export const adminIdParamSchema = z.object({ id: z.uuid() });

export const adminCreateSchema = z.object({
  email: z.email().max(200),
  name: z.string().trim().min(1).max(120),
  role,
  password,
});

export const adminUpdateSchema = z
  .object({
    role: role.optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => d.role !== undefined || d.active !== undefined, {
    message: "provide at least one of role / active",
  });

export const adminResetPasswordSchema = z.object({ password });
