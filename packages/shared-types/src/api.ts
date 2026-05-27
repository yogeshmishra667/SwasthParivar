export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface CursorPage<T> {
  data: T[];
  cursor: string | null;
  hasMore: boolean;
}

export type ErrorCode =
  | "AUTH_OTP_EXPIRED"
  | "AUTH_OTP_INVALID"
  | "AUTH_TOKEN_EXPIRED"
  | "AUTH_UNAUTHORIZED"
  | "READING_INVALID_VALUE"
  | "READING_CONFIRMATION_NEEDED"
  | "READING_STALE_VERSION"
  | "READING_NOT_FOUND"
  | "MEAL_STALE_VERSION"
  | "MEAL_NOT_FOUND"
  | "MED_SCHEDULE_NOT_FOUND"
  | "INSIGHT_NOT_FOUND"
  | "INSUFFICIENT_DATA"
  | "RX_PENDING_APPROVAL"
  | "FAMILY_LINK_EXISTS"
  | "FAMILY_LINK_NOT_FOUND"
  | "FAMILY_INVITE_INVALID"
  | "FAMILY_NO_ACCESS"
  | "GUARDIAN_ALERT_NOT_FOUND"
  | "HOUSEHOLD_PROFILE_LIMIT"
  | "CHAT_RATE_LIMITED"
  | "CHAT_DISABLED"
  | "CHAT_SAFETY_REJECTED"
  | "CHAT_CIRCUIT_OPEN"
  | "CHAT_UPSTREAM_TIMEOUT"
  | "CHAT_SPEND_CAP_REACHED"
  | "SOS_ALREADY_ACTIVE"
  | "REPORT_GENERATING"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "MAINTENANCE_MODE"
  // Admin / ops console (out-of-phase operational tooling).
  | "ADMIN_INVALID_CREDENTIALS"
  | "ADMIN_2FA_REQUIRED"
  | "ADMIN_2FA_INVALID"
  | "ADMIN_FORBIDDEN"
  | "ADMIN_ACCOUNT_DISABLED"
  | "ADMIN_NOT_FOUND"
  // Double-submit CSRF token missing / invalid on /admin/auth POSTs.
  // The client transparently fetches a fresh token and retries.
  | "ADMIN_CSRF_INVALID"
  | "INTERNAL_ERROR";
