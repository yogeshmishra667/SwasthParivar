// What the logger scrubs. Side-effect free, so it is unit-testable without
// the env (logger.ts validates env on import).

// PII keys redacted at the top level and up to two levels down. A pino
// `*.phone` path matches only one level down, so `logger.warn({ phone })`
// printed the number (audit P22): every OTP request, and SMS/WhatsApp
// failures carrying emergency-contact numbers.
const PII_KEYS = [
  "phone",
  "mobile",
  "guardianPhone",
  "contactPhone",
  "email",
  "aadhaar",
  "dob",
  "dateOfBirth",
] as const;

/**
 * Anything that could authenticate a user OR identify a patient is
 * scrubbed. PII = name/phone/email/dob/aadhaar. Auth = tokens/secrets.
 * New sensitive fields MUST be added here when routes accept them — there
 * is no "log everything, redact later" path in this codebase.
 */
export const LOG_REDACT_PATHS: readonly string[] = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-api-key"]',
  "req.body.otp",
  "req.body.password",
  "req.body.token",
  "req.body.accessToken",
  "req.body.refreshToken",
  ...PII_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
];

export const LOG_REDACT_CENSOR = "[REDACTED]";
