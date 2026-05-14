import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  // Express `trust proxy` setting. Required when running behind a
  // reverse proxy (Cloudflare, nginx, Render's load balancer) so that
  // req.ip resolves to the real client IP rather than the proxy's —
  // without this, rate-limit applies one bucket to every user.
  //
  // Values: "false" (no proxy, default for dev), "true" (trust ALL —
  // NEVER use in production), a positive int (number of hops back to
  // trust, e.g. "1" for a single CF layer), or a CIDR/IP allowlist.
  TRUST_PROXY: z.string().default("false"),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  OTP_SECRET: z.string().min(32),

  CLAUDE_API_KEY: z.string().optional(),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY: z.string().optional(),
  R2_SECRET_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),

  WHATSAPP_BUSINESS_API_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  MSG91_API_KEY: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),

  EXPO_ACCESS_TOKEN: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
  POSTHOG_API_KEY: z.string().optional(),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
});

// Production-only required keys — these are nominally optional at the type
// level (so dev/test can run without them) but a production boot MUST have
// them, otherwise the server loses error visibility and product analytics
// silently. Treat absence as a fatal config error, same as a missing
// DATABASE_URL.
const PROD_REQUIRED_KEYS = ["SENTRY_DSN", "POSTHOG_API_KEY"] as const;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (parsed.data.NODE_ENV === "production") {
  const missing = PROD_REQUIRED_KEYS.filter((k) => !parsed.data[k]);
  if (missing.length > 0) {
    console.error("❌ Production environment is missing required observability keys:");
    console.error("   " + missing.join(", "));
    console.error("   Set them or change NODE_ENV away from 'production'.");
    process.exit(1);
  }
}

export const env = parsed.data;

export const isProd = env.NODE_ENV === "production";
export const isDev = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";
