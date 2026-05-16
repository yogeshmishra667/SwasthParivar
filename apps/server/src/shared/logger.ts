import pino from "pino";
import { env, isDev } from "../config/env.js";

export const logger = pino({
  level: isDev ? "debug" : "info",
  redact: {
    // Anything that could authenticate a user OR identify a patient
    // is scrubbed. PII = name/phone/email/dob/aadhaar. Auth =
    // tokens/secrets. New sensitive fields MUST be added here when
    // routes accept them — there is no "log everything, redact later"
    // path in this codebase.
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-api-key"]',
      "req.body.otp",
      "req.body.password",
      "req.body.token",
      "req.body.accessToken",
      "req.body.refreshToken",
      "*.phone",
      "*.email",
      "*.aadhaar",
      "*.dob",
      "*.dateOfBirth",
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
