import { z } from "zod";

export const notificationOpenedSchema = z.object({
  notificationId: z.string().uuid(),
  /** The household profile the push was for (shared phone). */
  targetUserId: z.string().uuid().optional(),
});

export type NotificationOpenedBody = z.infer<typeof notificationOpenedSchema>;
