import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { logger } from "./shared/logger.js";
import { requestIdMiddleware } from "./shared/middleware/request-id.js";
import { errorHandler } from "./shared/middleware/error-handler.js";
import { defaultRateLimit } from "./shared/middleware/rate-limit.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { readingsRouter } from "./modules/readings/readings.routes.js";
import { medicationsRouter } from "./modules/medications/medications.routes.js";
import { streaksRouter } from "./modules/streaks/streaks.routes.js";
import { syncRouter } from "./modules/sync/sync.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";

export const buildApp = (): Express => {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: [/localhost:8081$/, /localhost:3000$/, /\.swasthparivar\.com$/],
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
  app.use(defaultRateLimit);

  app.use(healthRouter);

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/readings", readingsRouter);
  app.use("/api/v1/medications", medicationsRouter);
  app.use("/api/v1/streaks", streaksRouter);
  app.use("/api/v1/sync", syncRouter);
  app.use("/api/v1/dashboard", dashboardRouter);
  app.use("/api/v1/users", usersRouter);

  app.use(errorHandler);

  return app;
};
