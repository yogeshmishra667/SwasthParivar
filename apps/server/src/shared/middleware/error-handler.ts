import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { DomainError, type ApiError, type ErrorCode } from "@swasth/shared-types";
import { logger } from "../logger.js";
import { isProd } from "../../config/env.js";
import { captureUnhandled } from "../observability/sentry.js";

const statusFor = (code: ErrorCode): number => {
  switch (code) {
    case "AUTH_OTP_EXPIRED":
    case "AUTH_OTP_INVALID":
    case "AUTH_TOKEN_EXPIRED":
    case "AUTH_UNAUTHORIZED":
    case "ADMIN_INVALID_CREDENTIALS":
    case "ADMIN_2FA_REQUIRED":
    case "ADMIN_2FA_INVALID":
      return 401;
    case "FAMILY_NO_ACCESS":
    case "ADMIN_FORBIDDEN":
    case "ADMIN_ACCOUNT_DISABLED":
      return 403;
    case "MED_SCHEDULE_NOT_FOUND":
    case "READING_NOT_FOUND":
    case "MEAL_NOT_FOUND":
    case "INSIGHT_NOT_FOUND":
    case "FAMILY_LINK_NOT_FOUND":
    case "GUARDIAN_ALERT_NOT_FOUND":
    case "ADMIN_NOT_FOUND":
      return 404;
    case "FAMILY_INVITE_INVALID":
      return 400;
    case "FAMILY_LINK_EXISTS":
    case "SOS_ALREADY_ACTIVE":
    case "READING_STALE_VERSION":
    case "MEAL_STALE_VERSION":
    case "HOUSEHOLD_PROFILE_LIMIT":
      return 409;
    case "CHAT_RATE_LIMITED":
    case "RATE_LIMITED":
      return 429;
    // Phase 3 chat. Kill-switch / circuit-breaker / spend-cap all
    // map to 503 (transient operator signal — retry later). Upstream
    // timeout is 504 (gateway timeout). Safety-rejected stays 400
    // because the caller's prompt is the proximate cause and a
    // reworded retry is the right fix.
    case "CHAT_DISABLED":
    case "CHAT_CIRCUIT_OPEN":
    case "CHAT_SPEND_CAP_REACHED":
    case "MAINTENANCE_MODE": // CC.12.7 #1 — global maintenance window, retry later
      return 503;
    case "CHAT_UPSTREAM_TIMEOUT":
      return 504;
    case "CHAT_SAFETY_REJECTED":
      return 400;
    case "REPORT_GENERATING":
      return 202;
    case "INSUFFICIENT_DATA":
      return 422;
    case "READING_INVALID_VALUE":
    case "READING_CONFIRMATION_NEEDED":
    case "RX_PENDING_APPROVAL":
    case "VALIDATION_ERROR":
      return 400;
    case "INTERNAL_ERROR":
    default:
      return 500;
  }
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    const body: ApiError = {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: { issues: err.flatten().fieldErrors },
      },
    };
    res.status(400).json(body);
    return;
  }

  if (err instanceof DomainError) {
    const body: ApiError = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    };
    res.status(statusFor(err.code)).json(body);
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const prismaBody = (status: number, code: ErrorCode, message: string): void => {
      const body: ApiError = { success: false, error: { code, message } };
      res.status(status).json(body);
    };
    switch (err.code) {
      case "P2025":
        prismaBody(404, "MED_SCHEDULE_NOT_FOUND", "Record not found");
        return;
      case "P2002":
        prismaBody(409, "FAMILY_LINK_EXISTS", "Duplicate record");
        return;
      case "P2003":
        prismaBody(400, "VALIDATION_ERROR", "Referenced record does not exist");
        return;
      default:
        break;
    }
  }

  logger.error({ err, requestId: req.requestId, path: req.path }, "unhandled error");
  captureUnhandled(err, { requestId: req.requestId, path: req.path, method: req.method });

  const body: ApiError = {
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: isProd ? "Something went wrong" : (err as Error).message,
    },
  };
  res.status(500).json(body);
};
