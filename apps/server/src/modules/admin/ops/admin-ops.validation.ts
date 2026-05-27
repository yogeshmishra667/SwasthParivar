import { z } from "zod";

export const maintenanceSchema = z.object({
  enabled: z.boolean(),
});
