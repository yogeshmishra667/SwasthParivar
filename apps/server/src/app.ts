import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./shared/logger.js";
import { requestIdMiddleware } from "./shared/middleware/request-id.js";
import { errorHandler } from "./shared/middleware/error-handler.js";
import { defaultRateLimit } from "./shared/middleware/rate-limit.js";
import { maintenanceMode } from "./shared/middleware/maintenance-mode.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { readingsRouter } from "./modules/readings/readings.routes.js";
import { mealsRouter } from "./modules/meals/meals.routes.js";
import { insightsRouter } from "./modules/insights/insights.routes.js";
import { hba1cRouter } from "./modules/hba1c/hba1c.routes.js";
import { healthScoreRouter } from "./modules/health-score/health-score.routes.js";
import { medicationsRouter } from "./modules/medications/medications.routes.js";
import { streaksRouter } from "./modules/streaks/streaks.routes.js";
import { syncRouter } from "./modules/sync/sync.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { householdRouter } from "./modules/household/household.routes.js";
import { familyRouter } from "./modules/family/family.routes.js";
import { silentGuardianRouter } from "./modules/silent-guardian/silent-guardian.routes.js";
import { schedulesRouter } from "./modules/schedules/schedules.routes.js";
import { sosRouter } from "./modules/sos/sos.routes.js";
import { chatRouter } from "./modules/chat/chat.routes.js";
import { configRouter } from "./modules/config/config.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { adminRouter } from "./modules/admin/admin.routes.js";

// Parse TRUST_PROXY env value: "true"/"false"/<int>/<comma list>.
// Express accepts boolean, integer, or string of comma-separated CIDRs.
const parseTrustProxy = (raw: string): boolean | number | string[] => {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const asInt = Number(raw);
  if (Number.isInteger(asInt) && asInt >= 0) return asInt;
  return raw.split(",").map((s) => s.trim());
};

// CORS allowlist. Patterns are anchored with `^` to prevent
// substring-match bypass (e.g. `http://evil.com/.swasthparivar.com`
// can't match the path component, but defensive anchoring is cheap).
// The root domain is explicitly included alongside the subdomain pattern.
const corsAllowList: (string | RegExp)[] = [
  /^https?:\/\/localhost:8081$/,
  /^https?:\/\/localhost:3000$/,
  "https://swasthparivar.com",
  /^https:\/\/[a-z0-9-]+\.swasthparivar\.com$/,
];

export const buildApp = (): Express => {
  const app = express();

  // Required behind any reverse proxy so req.ip and rate-limit bucket
  // by real client IP, not the proxy IP. See env.ts comment for valid
  // values. NEVER set TRUST_PROXY=true in prod — that trusts any
  // X-Forwarded-For header from any caller and breaks IP-based rate
  // limiting / abuse blocking.
  app.set("trust proxy", parseTrustProxy(env.TRUST_PROXY));

  // Defensive: helmet already removes this, but a second layer costs
  // nothing and protects against helmet config regressions.
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(
    cors({
      origin: corsAllowList,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(requestIdMiddleware);
  app.use(
    pinoHttp({
      logger,
      customProps: (req: express.Request) => ({ requestId: req.requestId }),
      autoLogging: {
        ignore: (req: express.Request) => req.url?.startsWith("/health") ?? false,
      },
    }),
  );
  // /health probes MUST be reachable independent of the rate-limit
  // middleware. Since Phase 4 §T.2 the limit ceiling is read from the
  // flag service (Redis), so gating /health behind it makes liveness
  // dependent on Redis availability — the smoke test's stub Redis
  // would hang `redis.get()` forever and curl gets `Connection reset
  // by peer` after the job timeout. Mount /health FIRST.
  app.use(healthRouter);

  app.use(defaultRateLimit);

  // CC.12.7 #1 — global maintenance kill switch. Mounted after the
  // health probes and before the feature routers; exempts /health and
  // /admin so ops can monitor and lift maintenance mode.
  app.use(maintenanceMode);

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/readings", readingsRouter);
  app.use("/api/v1/meals", mealsRouter);
  app.use("/api/v1/insights", insightsRouter);
  app.use("/api/v1/hba1c", hba1cRouter);
  app.use("/api/v1/health-score", healthScoreRouter);
  app.use("/api/v1/medications", medicationsRouter);
  app.use("/api/v1/streaks", streaksRouter);
  app.use("/api/v1/sync", syncRouter);
  app.use("/api/v1/dashboard", dashboardRouter);
  app.use("/api/v1/users", usersRouter);
  app.use("/api/v1/household", householdRouter);
  app.use("/api/v1/family", familyRouter);
  app.use("/api/v1/guardian", silentGuardianRouter);
  app.use("/api/v1/schedules", schedulesRouter);
  app.use("/api/v1/sos", sosRouter);
  app.use("/api/v1/chat", chatRouter);
  app.use("/api/v1/config", configRouter);
  app.use("/admin", adminRouter);

  app.use(errorHandler);

  return app;
};
