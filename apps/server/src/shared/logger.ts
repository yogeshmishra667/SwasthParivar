import pino from "pino";
import { env, isDev } from "../config/env.js";

export const logger = pino({
  level: isDev ? "debug" : "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body.otp",
      "req.body.password",
      "req.body.token",
      "*.phone",
    ],
    censor: "[REDACTED]",
  },
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
