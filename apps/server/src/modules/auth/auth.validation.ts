import { z } from "zod";

const phoneSchema = z.string().regex(/^\+91[6-9]\d{9}$/, "expected +91XXXXXXXXXX");

export const sendOtpSchema = z.object({
  phone: phoneSchema,
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  otp: z.string().regex(/^\d{6}$/),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(20),
});

export const pushTokenSchema = z.object({
  token: z.string().min(10),
  platform: z.enum(["ios", "android", "web"]),
  deviceId: z.string().optional(),
});

export const verifyFirebaseSchema = z.object({
  // Firebase ID tokens are JWTs around 1KB; min 100 catches a missing
  // body or a truncated token before it hits the verify call.
  idToken: z.string().min(100),
});
