import pino from "pino";
import { env, isDev } from "../config/env.js";
import { LOG_REDACT_CENSOR, LOG_REDACT_PATHS } from "./log-redact.js";

export const logger = pino({
  level: isDev ? "debug" : "info",
  redact: { paths: [...LOG_REDACT_PATHS], censor: LOG_REDACT_CENSOR },
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss.l", singleLine: false },
        },
      }
    : {}),
  base: { env: env.NODE_ENV },
});
