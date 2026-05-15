import { z } from "zod";

// Same shape as hba1c — only the optional `targetUserId` matters; the
// service reads everything else from auth + DB.
export const healthScoreQuerySchema = z.object({
  targetUserId: z.string().uuid().optional(),
});

export type HealthScoreQuery = z.infer<typeof healthScoreQuerySchema>;
