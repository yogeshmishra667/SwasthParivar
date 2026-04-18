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
