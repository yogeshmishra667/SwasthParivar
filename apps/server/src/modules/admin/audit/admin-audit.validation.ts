import { z } from "zod";

export const listAuditQuerySchema = z.object({
  // Filter by action key (e.g. "flag.set", "user.tier_changed").
  action: z.string().max(64).optional(),
  // Filter to one admin actor.
  adminUserId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
