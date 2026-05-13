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
  | "MED_SCHEDULE_NOT_FOUND"
  | "INSIGHT_NOT_FOUND"
  | "RX_PENDING_APPROVAL"
  | "FAMILY_LINK_EXISTS"
  | "FAMILY_NO_ACCESS"
  | "HOUSEHOLD_PROFILE_LIMIT"
  | "CHAT_RATE_LIMITED"
  | "SOS_ALREADY_ACTIVE"
  | "REPORT_GENERATING"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";
