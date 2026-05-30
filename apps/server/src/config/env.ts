import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

// Vetted Claude models — the chat model env overrides must pick from
// this allowlist so an operator cannot point patient-facing chat at an
// arbitrary, unvetted, or less-safety-aligned model. Bumping a model is
// therefore a deliberate, reviewed code change here (re-verify against
// the model catalogue first — see the CLAUDE_MODEL_* note below).
const VETTED_CLAUDE_MODELS = ["claude-haiku-4-5", "claude-sonnet-4-6"] as const;

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
  // Phase 3 chat — model IDs are env-driven so a model retirement
  // doesn't require a redeploy. Defaults match phase3.md A.6 / the
  // model catalogue current at 2026-05-19. Reverify against
  // https://platform.claude.com/docs/en/about-claude/models/overview
  // before bumping in production.
  CLAUDE_MODEL_HAIKU: z.enum(VETTED_CLAUDE_MODELS).default("claude-haiku-4-5"),
  CLAUDE_MODEL_SONNET: z.enum(VETTED_CLAUDE_MODELS).default("claude-sonnet-4-6"),
  // Per-user daily chat cap (free tier). Premium ignores this in the
  // service layer. Hard ceiling enforced at the controller.
  CHAT_DAILY_FREE_LIMIT: z.coerce.number().int().positive().default(3),
  // Hard per-request timeout on the Claude wrapper. Anything longer is
  // a runaway and gets aborted; the chat service falls back to Tier 1
  // template. Tuned against p95 sonnet latency + headroom.
  CHAT_HARD_TIMEOUT_MS: z.coerce.number().int().positive().default(12_000),
  // Org-wide spend cap per UTC day. When estimated cumulative spend
  // exceeds this, the wrapper auto-flips ai_chat_tier3_enabled=false
  // (Tier 1/2 still flow) and pages on-call via Sentry. CC.11 §6.
  CLAUDE_DAILY_SPEND_CAP_USD: z.coerce.number().positive().default(50),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY: z.string().optional(),
  R2_SECRET_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),

  WHATSAPP_BUSINESS_API_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_OTP_TEMPLATE_NAME: z.string().optional(),
  WHATSAPP_OTP_TEMPLATE_LANGUAGE: z.string().default("en"),
  MSG91_API_KEY: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),
  MSG91_OTP_TEMPLATE_ID: z.string().optional(),

  EXPO_ACCESS_TOKEN: z.string().optional(),

  // Firebase Admin service account credentials as a JSON string (single
  // env var — easier to inject via secret managers than 3+ separate
  // fields). When unset, the OTP provider flag MUST stay on "log" or
  // "whatsapp"; flipping to "firebase" without this will reject all
  // verify-firebase requests at startup of the helper.
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),

  // Admin / ops console (out-of-phase tooling). The console authenticates
  // staff with email+password+TOTP and mints its own JWTs — separate
  // secrets from the patient JWTs above so a leak of one never forges the
  // other. Optional in dev/test; prod-required by the guard below.
  ADMIN_JWT_SECRET: z.string().min(32).optional(),
  ADMIN_JWT_REFRESH_SECRET: z.string().min(32).optional(),
  // CSRF protection on /admin/auth — double-submit cookie pattern via
  // `csrf-csrf`. Defense in depth alongside SameSite=strict on the
  // refresh cookie + the CORS allowlist. Optional in dev/test;
  // prod-required by the guard below.
  ADMIN_CSRF_SECRET: z.string().min(32).optional(),
  // Issuer label shown in the operator's authenticator app entry.
  ADMIN_TOTP_ISSUER: z.string().default("SwasthParivar Admin"),
  // Bootstrap super-admin — read only by `pnpm admin:seed`, never at
  // request time. Leave unset once the first account exists.
  ADMIN_BOOTSTRAP_EMAIL: z.string().optional(),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(12).optional(),

  SENTRY_DSN: z.string().optional(),
  POSTHOG_API_KEY: z.string().optional(),
  POSTHOG_PERSONAL_API_KEY: z.string().optional(),
  POSTHOG_PROJECT_ID: z.string().optional(),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  // Phase 4 Feature D' — SOS IVR vendor wrappers. Both vendors are
  // optional at config time; the `sos_test_mode` flag (Redis-backed,
  // default true) is the runtime gate that suppresses real calls
  // regardless of credentials. When `sos_test_mode=false` AND a
  // matching vendor is unset, the dispatcher pages Sentry with
  // `SOS_IVR_NO_VENDOR` and falls through to the SMS-all-contacts
  // path (CLAUDE.md "Phase 4 Invariants" + phase4.md §D'.1).
  //
  //   Exotel — India E.164 (+91*). Primary.
  //   Twilio — international fallback.
  EXOTEL_ACCOUNT_SID: z.string().optional(),
  EXOTEL_API_KEY: z.string().optional(),
  EXOTEL_API_TOKEN: z.string().optional(),
  EXOTEL_CALLER_ID: z.string().optional(),

  // URL Exotel POSTs to for the call applet response (an XML body
  // resembling TwiML — `<Response><Say>…</Say></Response>`). For
  // SwasthParivar we expose `POST /api/v1/sos/webhooks/exotel/applet`
  // which generates the per-call TTS from the correlation id. The
  // env var is the PUBLIC absolute URL Exotel can reach.
  EXOTEL_APPLET_URL: z.string().optional(),
  // Optional Exotel webhook signing secret — we HMAC-verify the
  // status callback when set. Without it we accept the callback as-
  // is (Exotel does not currently sign by default).
  EXOTEL_WEBHOOK_SECRET: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  // Twilio status callbacks are signed with the auth token (X-
  // Twilio-Signature header). The webhook validates the signature
  // against the absolute URL it received the request at; we don't
  // need a separate secret env var.

  // Public base URL of the server — used to derive the absolute
  // status-callback URLs we pass to Exotel + Twilio. Without this
  // the vendors cannot reach back to us, so the real-call path
  // refuses to fire and falls back to log-only.
  PUBLIC_API_BASE_URL: z.string().optional(),
});

// Production-only required keys — these are nominally optional at the type
// level (so dev/test can run without them) but a production boot MUST have
// them, otherwise the server loses error visibility and product analytics
// silently. Treat absence as a fatal config error, same as a missing
// DATABASE_URL.
const PROD_REQUIRED_KEYS = [
  "SENTRY_DSN",
  "POSTHOG_API_KEY",
  "ADMIN_JWT_SECRET",
  "ADMIN_JWT_REFRESH_SECRET",
  "ADMIN_CSRF_SECRET",
] as const;

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
