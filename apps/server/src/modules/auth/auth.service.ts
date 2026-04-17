import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { DomainError } from "@swasth/shared-types";
import { prisma } from "../../shared/database.js";
import { redis } from "../../shared/redis.js";
import { env } from "../../config/env.js";
import { logger } from "../../shared/logger.js";

const OTP_TTL_SECONDS = 300;
const OTP_MAX_ATTEMPTS = 5;

const otpKey = (phone: string): string => `otp:${phone}`;
const attemptsKey = (phone: string): string => `otp:attempts:${phone}`;

const generateOtp = (): string =>
  String(crypto.randomInt(100_000, 1_000_000));

const hashOtp = (otp: string, phone: string): string =>
  crypto.createHmac("sha256", env.OTP_SECRET).update(`${phone}:${otp}`).digest("hex");

export const sendOtp = async (phone: string): Promise<{ sent: boolean }> => {
  const otp = generateOtp();
  const hashed = hashOtp(otp, phone);
  await redis.setex(otpKey(phone), OTP_TTL_SECONDS, hashed);
  await redis.del(attemptsKey(phone));

  // TODO: integrate MSG91 / WhatsApp Business API
  logger.info({ phone, otp: env.NODE_ENV === "development" ? otp : "[REDACTED]" }, "OTP dispatched");
  return { sent: true };
};

export const verifyOtp = async (
  phone: string,
  otp: string,
): Promise<{ accessToken: string; refreshToken: string; userId: string; isNew: boolean }> => {
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

export const refreshTokens = async (
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string }> => {
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
