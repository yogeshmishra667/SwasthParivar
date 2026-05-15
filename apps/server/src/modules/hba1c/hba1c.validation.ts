import { z } from "zod";

// HbA1c GET only accepts `targetUserId` for household-profile routing.
// The query is otherwise empty — the service reads everything from the
// authenticated user + cache.
export const hba1cQuerySchema = z.object({
  targetUserId: z.string().uuid().optional(),
});

export type HbA1cQuery = z.infer<typeof hba1cQuerySchema>;
