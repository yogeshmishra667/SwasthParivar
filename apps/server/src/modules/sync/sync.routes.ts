import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody, validateQuery } from "../../shared/validate.js";
import { ok } from "../../shared/http.js";
import { prisma } from "../../shared/database.js";
import { createGlucoseReading } from "../readings/readings.service.js";

const pushSchema = z.object({
  lastSyncedAt: z.string().datetime().optional(),
  changes: z.object({
    glucoseReadings: z
      .array(
        z.object({
          clientUuid: z.string().uuid(),
          valueMgDl: z.number().int(),
          readingType: z.enum(["fasting", "pre_meal", "post_meal", "random", "bedtime"]),
          context: z.enum(["normal", "festive"]).default("normal"),
          notes: z.string().optional(),
          source: z.enum(["manual", "voice", "device"]),
          measuredAt: z.string().datetime(),
          version: z.number().int().positive(),
        }),
      )
      .default([]),
  }),
});

const pullQuerySchema = z.object({
  lastSyncedAt: z.string().datetime().optional(),
});

export const syncRouter: Router = Router();

syncRouter.use(requireAuth);

syncRouter.post(
  "/push",
  validateBody(pushSchema),
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.auth!.sub;
    const body = req.body as z.infer<typeof pushSchema>;
    const results: { clientUuid: string; status: "accepted" | "stale" | "error" }[] = [];

    for (const r of body.changes.glucoseReadings) {
      try {
        await createGlucoseReading({ userId, ...r });
        results.push({ clientUuid: r.clientUuid, status: "accepted" });
      } catch (err) {
        const code = (err as { code?: string }).code;
        results.push({
          clientUuid: r.clientUuid,
          status: code === "READING_STALE_VERSION" ? "stale" : "error",
        });
      }
    }

    ok(res, { results, serverTime: new Date().toISOString() });
  },
);

syncRouter.get(
  "/pull",
  validateQuery(pullQuerySchema),
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.auth!.sub;
    const { lastSyncedAt } = pullQuerySchema.parse(req.query);
    const since = lastSyncedAt ? new Date(lastSyncedAt) : new Date(0);

    const [readings, schedules] = await Promise.all([
      prisma.glucoseReading.findMany({
        where: { userId, updatedAt: { gte: since } },
        orderBy: { updatedAt: "asc" },
      }),
      prisma.medicationSchedule.findMany({
        where: { userId, updatedAt: { gte: since } },
        orderBy: { updatedAt: "asc" },
      }),
    ]);

    ok(res, { glucoseReadings: readings, medicationSchedules: schedules, serverTime: new Date().toISOString() });
  },
);
