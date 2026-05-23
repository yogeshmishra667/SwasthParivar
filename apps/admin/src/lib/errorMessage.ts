// Map a server `ErrorCode` to UI copy. The server ships terse messages
// designed for logs; this is where we make them admin-readable. Keep
// entries here whenever a flow surfaces a code without a custom message.

import type { ErrorCode } from "@swasth/shared-types";
import { ApiClientError } from "@/api/client";

const ERROR_COPY: Partial<Record<ErrorCode, string>> = {
  // Admin auth
  ADMIN_INVALID_CREDENTIALS: "Wrong email or password.",
  ADMIN_2FA_REQUIRED: "Two-factor authentication is required.",
  ADMIN_2FA_INVALID: "That 6-digit code isn't valid — try the latest one in your app.",
  ADMIN_FORBIDDEN: "You don't have permission for that action.",
  ADMIN_ACCOUNT_DISABLED: "This admin account is disabled. Contact a super_admin to re-enable it.",
  ADMIN_NOT_FOUND: "Not found.",
  // Generic
  AUTH_UNAUTHORIZED: "Your session has expired. Please sign in again.",
  RATE_LIMITED: "Too many attempts. Wait a minute and try again.",
  MAINTENANCE_MODE: "The platform is in maintenance mode — try again soon.",
  VALIDATION_ERROR: "Please check the highlighted fields and try again.",
  INTERNAL_ERROR: "Something went wrong on our end. Try again in a moment.",
};

/** Turn any thrown value into a human-readable string for an Alert / toast. */
export function humanizeApiError(err: unknown, fallback = "Something went wrong."): string {
  if (err instanceof ApiClientError) {
    return ERROR_COPY[err.code] ?? (err.message || fallback);
  }
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}
