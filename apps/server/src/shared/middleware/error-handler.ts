import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { DomainError, type ApiError, type ErrorCode } from "@swasth/shared-types";
import { logger } from "../logger.js";
import { isProd } from "../../config/env.js";

const statusFor = (code: ErrorCode): number => {
  switch (code) {
    case "AUTH_OTP_EXPIRED":
    case "AUTH_OTP_INVALID":
    case "AUTH_TOKEN_EXPIRED":
      return 401;
    case "AUTH_UNAUTHORIZED":
    case "FAMILY_NO_ACCESS":
      return 403;
    case "MED_SCHEDULE_NOT_FOUND":
      return 404;
    case "FAMILY_LINK_EXISTS":
    case "SOS_ALREADY_ACTIVE":
    case "READING_STALE_VERSION":
      return 409;
    case "CHAT_RATE_LIMITED":
    case "RATE_LIMITED":
      return 429;
    case "REPORT_GENERATING":
      return 202;
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
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    };
    res.status(statusFor(err.code)).json(body);
    return;
  }

  logger.error({ err, requestId: req.requestId, path: req.path }, "unhandled error");

  const body: ApiError = {
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: isProd ? "Something went wrong" : (err as Error).message,
    },
  };
  res.status(500).json(body);
};
