import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { DomainError } from "@swasth/shared-types";
import { prisma } from "../../shared/database.js";
import { redis } from "../../shared/redis.js";
import { env } from "../../config/env.js";
import { logger } from "../../shared/logger.js";
import { getFlag } from "../../shared/flags/flags.js";
import { verifyFirebaseIdToken } from "../../shared/auth/firebase-admin.js";
import { sendWhatsappOtp } from "../../shared/notifications/whatsapp.js";
import { sendMsg91Otp } from "../../shared/notifications/msg91-sms.js";

// Single source of truth for which OTP delivery + verification mode is
// active. Read by sendOtp, getAuthConfig (mobile uses this to choose
// flow), and the controller layer when routing verify requests.
//
//   "firebase" → mobile drives OTP via @react-native-firebase/auth,
//                server only verifies the resulting ID token. Use this
//                while WhatsApp/MSG91 are blocked on business
//                verification / DLT registration.
//   "whatsapp" → original chain: WhatsApp Business API primary,
//                MSG91 SMS fallback on send-side failure.
//   "log"      → no real delivery; OTP appears in server logs, dev
//                bypass "000000" still works in verifyOtp.
//
// Default is "log" so a Redis outage or first-boot environment never
// promises the user an OTP we didn't send. Flip via:
//   redis-cli SET flag:auth.otp.provider '"firebase"'
export type OtpProvider = "firebase" | "whatsapp" | "log";
const OTP_PROVIDER_FLAG = "auth.otp.provider";
const OTP_PROVIDER_DEFAULT: OtpProvider = "log";

const readOtpProvider = async (): Promise<OtpProvider> => {
  const raw = await getFlag<OtpProvider>(OTP_PROVIDER_FLAG, OTP_PROVIDER_DEFAULT);
  // Defensive: the flag is admin-writable, so guard against typos
  // turning into a 500 at request time.
  if (raw === "firebase" || raw === "whatsapp" || raw === "log") return raw;
  logger.warn({ raw }, "invalid auth.otp.provider flag — falling back to default");
  return OTP_PROVIDER_DEFAULT;
};

const OTP_TTL_SECONDS = 300;
const OTP_MAX_ATTEMPTS = 5;

const otpKey = (phone: string): string => `otp:${phone}`;
const attemptsKey = (phone: string): string => `otp:attempts:${phone}`;

const generateOtp = (): string => String(crypto.randomInt(100_000, 1_000_000));

const hashOtp = (otp: string, phone: string): string =>
  crypto.createHmac("sha256", env.OTP_SECRET).update(`${phone}:${otp}`).digest("hex");

export const getAuthConfig = async (): Promise<{ otpProvider: OtpProvider }> => ({
  otpProvider: await readOtpProvider(),
});

export interface SendOtpResult {
  sent: boolean;
  provider: OtpProvider;
}

export const sendOtp = async (phone: string): Promise<SendOtpResult> => {
  const provider = await readOtpProvider();

  // Firebase: mobile SDK handles delivery, server has nothing to send.
  // Reply with provider so the client knows which verify endpoint to
  // call (the validate-otp endpoint would be the wrong one here).
  if (provider === "firebase") {
    logger.info({ phone, provider }, "OTP dispatch skipped — firebase mode");
    return { sent: true, provider };
  }

  const otp = generateOtp();
  const hashed = hashOtp(otp, phone);
  await redis.setex(otpKey(phone), OTP_TTL_SECONDS, hashed);
  await redis.del(attemptsKey(phone));

  if (provider === "log") {
    logger.info(
      {
        phone,
        provider,
        otp: env.NODE_ENV === "development" ? otp : "[REDACTED]",
      },
      "OTP dispatched (log mode — no external send)",
    );
    return { sent: true, provider };
  }

  // provider === "whatsapp": WhatsApp primary (cheaper, faster on
  // smartphones — see CLAUDE.md "OTP Delivery"). On send-side failure
  // (NOT_CONFIGURED, HTTP error, network error) immediately fall back
  // to MSG91 SMS. CLAUDE.md specifies a 15s delivery-callback fallback;
  // we approximate it via send-side failure for now and wire the
  // WhatsApp delivery webhook separately when the webhook endpoint
  // lands.
  const wa = await sendWhatsappOtp(phone, otp);
  let channel: "whatsapp" | "sms" | "log" = "whatsapp";
  let sent = wa.success;

  if (!wa.success) {
    const sms = await sendMsg91Otp(phone, otp);
    channel = sms.success ? "sms" : "log";
    sent = sms.success;
  }

  logger.info(
    {
      phone,
      provider,
      channel,
      delivered: sent,
      otp: env.NODE_ENV === "development" ? otp : "[REDACTED]",
    },
    "OTP dispatched",
  );

  // In production a total provider failure must surface — refuse the
  // request so the client can show "try again" rather than silently
  // claiming success.
  if (!sent && env.NODE_ENV === "production") {
    throw new DomainError("INTERNAL_ERROR", "otp delivery failed");
  }

  return { sent: true, provider };
};

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  userId: string;
  isNew: boolean;
}

/**
 * Upsert the user for this phone and mint an access + refresh JWT pair.
 * Shared between verifyOtp (whatsapp/log providers) and
 * verifyFirebaseToken (firebase provider) so the post-OTP path stays
 * single-sourced — same household creation rules, same JWT shape, same
 * `isNew` semantics for the onboarding gate.
 */
const upsertUserAndIssueTokens = async (phone: string): Promise<IssuedTokens> => {
  let user = await prisma.user.findUnique({ where: { phone } });
  let isNew = false;
  if (!user) {
    const household = await prisma.household.create({ data: {} });
    user = await prisma.user.create({
      data: {
        phone,
        name: "",
        age: 0,
        householdId: household.id,
        onboardingComplete: false,
      },
    });
    isNew = true;
  }

  const accessToken = jwt.sign({ sub: user.id, householdId: user.householdId }, env.JWT_SECRET, {
    expiresIn: "1h",
  });
  const refreshToken = jwt.sign(
    { sub: user.id, householdId: user.householdId, type: "refresh" },
    env.JWT_REFRESH_SECRET,
    { expiresIn: "30d" },
  );

  return { accessToken, refreshToken, userId: user.id, isNew };
};

export const verifyOtp = async (phone: string, otp: string): Promise<IssuedTokens> => {
  const attempts = Number((await redis.get(attemptsKey(phone))) ?? "0");
  if (attempts >= OTP_MAX_ATTEMPTS) {
    throw new DomainError("AUTH_OTP_INVALID", "too many attempts, request a new OTP");
  }

  // Dev bypass: accept "000000" without Redis check (never in production)
  const devBypass = env.NODE_ENV === "development" && otp === "000000";

  if (!devBypass) {
    const stored = await redis.get(otpKey(phone));
    if (!stored) throw new DomainError("AUTH_OTP_EXPIRED", "otp expired");

    if (stored !== hashOtp(otp, phone)) {
      await redis.incr(attemptsKey(phone));
      await redis.expire(attemptsKey(phone), OTP_TTL_SECONDS);
      throw new DomainError("AUTH_OTP_INVALID", "invalid otp");
    }
  }

  await redis.del(otpKey(phone));
  await redis.del(attemptsKey(phone));

  return await upsertUserAndIssueTokens(phone);
};

/**
 * Verify a Firebase ID token (issued by mobile after
 * signInWithPhoneNumber + confirm). Extracts the verified phone number
 * from the token claims, then runs the same user-upsert + JWT pair
 * issuance as the OTP path. We do NOT trust any phone in the request
 * body — only the one Firebase signed.
 */
export const verifyFirebaseToken = async (idToken: string): Promise<IssuedTokens> => {
  const decoded = await verifyFirebaseIdToken(idToken);
  const phone = decoded.phone_number;
  if (!phone) {
    throw new DomainError("AUTH_OTP_INVALID", "firebase id token missing phone_number claim");
  }
  return await upsertUserAndIssueTokens(phone);
};

export const upsertPushToken = async (params: {
  userId: string;
  token: string;
  platform: "ios" | "android" | "web";
  deviceId?: string;
}): Promise<{ id: string }> => {
  const row = await prisma.pushToken.upsert({
    where: { token: params.token },
    create: {
      userId: params.userId,
      token: params.token,
      platform: params.platform,
      ...(params.deviceId !== undefined ? { deviceId: params.deviceId } : {}),
    },
    update: {
      userId: params.userId,
      platform: params.platform,
      ...(params.deviceId !== undefined ? { deviceId: params.deviceId } : {}),
      lastSeenAt: new Date(),
    },
  });
  return { id: row.id };
};

export const refreshTokens = (
  refreshToken: string,
): { accessToken: string; refreshToken: string } => {
  let payload: { sub: string; householdId: string; type: string };
  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as typeof payload;
  } catch {
    throw new DomainError("AUTH_TOKEN_EXPIRED", "invalid refresh token");
  }
  if (payload.type !== "refresh") {
    throw new DomainError("AUTH_TOKEN_EXPIRED", "not a refresh token");
  }

  const accessToken = jwt.sign(
    { sub: payload.sub, householdId: payload.householdId },
    env.JWT_SECRET,
    { expiresIn: "1h" },
  );
  const newRefresh = jwt.sign(
    { sub: payload.sub, householdId: payload.householdId, type: "refresh" },
    env.JWT_REFRESH_SECRET,
    { expiresIn: "30d" },
  );
  return { accessToken, refreshToken: newRefresh };
};
