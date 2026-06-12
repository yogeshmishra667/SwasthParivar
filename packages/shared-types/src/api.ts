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
  // Patient account soft-disabled by admin (Phase 4 Week 13 admin
  // carry-over). Surfaces only on the auth perimeter: send-otp,
  // verify-otp / verify-firebase, and refresh. Existing access tokens
  // remain valid until they expire (≤1h).
  | "USER_DEACTIVATED"
  | "READING_INVALID_VALUE"
  | "READING_CONFIRMATION_NEEDED"
  | "READING_STALE_VERSION"
  | "READING_NOT_FOUND"
  | "MEAL_STALE_VERSION"
  | "MEAL_NOT_FOUND"
  | "MED_SCHEDULE_NOT_FOUND"
  // Phase 4 Week 17 carry-over (Phase 2). Health-check schedules
  // surface — `GET/POST/PUT /api/v1/schedules`. Distinct from
  // `MED_SCHEDULE_*` so the mobile client can differentiate the two
  // surfaces (medication reminder vs. self-check cadence).
  | "SCHEDULE_NOT_FOUND"
  | "SCHEDULE_INVALID"
  | "INSIGHT_NOT_FOUND"
  | "INSUFFICIENT_DATA"
  | "RX_PENDING_APPROVAL"
  // Phase 4 §F.5 — prescription approval flow. Caller is authenticated
  // but the upload's `prescription-approver-resolver` snapshot named a
  // different approver (e.g. the guardian). Maps to 403 — patient sees
  // "Maa ji ko approval ke liye bheja gaya hai" copy, not a retry.
  | "APPROVAL_REQUIRES_GUARDIAN"
  // The prescription has already transitioned to `approved` or
  // `rejected`. Append-photos / manual-add / clarify / re-approve are
  // all rejected at this terminal — open a new prescription instead.
  // 409 (state conflict).
  | "PRESCRIPTION_LOCKED"
  | "PRESCRIPTION_NOT_FOUND"
  | "PRESCRIPTION_ITEM_NOT_FOUND"
  // Hit the F.4 "max 3 clarification attempts per item" guardrail —
  // the item auto-promoted to `needs_doctor`. 409 surfaces the terminal
  // state so the mobile UI can swap in the "add by hand" copy.
  | "PRESCRIPTION_CLARIFICATION_EXHAUSTED"
  // Multipart upload outside the per-file size / per-array count limits
  // declared by the F.5 upload route. multer's own error mapped to a
  // typed code so the mobile client can show a localised banner.
  | "UPLOAD_TOO_LARGE"
  // Object storage (R2) is not configured — env vars missing in the
  // current environment. Fails the upload route at the boundary; OCR
  // never enqueues. 503.
  | "STORAGE_UNAVAILABLE"
  | "FAMILY_LINK_EXISTS"
  | "FAMILY_LINK_NOT_FOUND"
  | "FAMILY_INVITE_INVALID"
  | "FAMILY_NO_ACCESS"
  | "GUARDIAN_ALERT_NOT_FOUND"
  | "HOUSEHOLD_PROFILE_LIMIT"
  | "HOUSEHOLD_PROFILE_NOT_FOUND"
  | "CHAT_RATE_LIMITED"
  | "CHAT_DISABLED"
  | "CHAT_SAFETY_REJECTED"
  | "CHAT_CIRCUIT_OPEN"
  | "CHAT_UPSTREAM_TIMEOUT"
  | "CHAT_SPEND_CAP_REACHED"
  | "SOS_ALREADY_ACTIVE"
  // Phase 4 Feature D' — SOS kill-switch + access guards.
  | "SOS_DISABLED"
  | "SOS_NOT_FOUND"
  | "SOS_FORBIDDEN"
  // Phase 4 Feature E — multi-condition log surfaces. Each new surface
  // has its own kill-switch flag (`cardiac_logging_enabled` /
  // `respiratory_logging_enabled`, both default off). Mapped to 503 so
  // the mobile client retries on a later resync rather than burning the
  // local-queued write.
  | "CARDIAC_DISABLED"
  | "RESPIRATORY_DISABLED"
  // Phase 4 Feature F — Claude Vision wrapper failure modes. Map to
  // 503 — the BullMQ OCR job retries with backoff and the upload
  // route surfaces a "OCR busy, try in a few minutes" banner.
  | "VISION_CIRCUIT_OPEN"
  | "VISION_UPSTREAM_TIMEOUT"
  | "VISION_INVALID_JSON"
  | "VISION_NO_IMAGES"
  | "REPORT_GENERATING"
  // Phase 4 Feature G.4 — pre-visit reports. NOT_FOUND is 404 (also on a
  // cross-household access attempt); NOT_READY is 409 — the report row
  // exists but the PDF hasn't rendered yet, so /download has nothing to
  // hand back. The client polls /status until ready.
  | "REPORT_NOT_FOUND"
  | "REPORT_NOT_READY"
  // Phase 4 Feature G — doctor portal. `DOCTOR_PORTAL_DISABLED` is the
  // kill-switch (`doctor_portal_enabled=false`, default off) → 503 so the
  // mobile client retries later. The two NOT_FOUND codes are 404 and are
  // also returned on a cross-household access attempt that resolves to a
  // row the caller can't see (we 404 rather than 403 to avoid leaking
  // existence — household authz itself still throws FAMILY_NO_ACCESS for
  // an explicit cross-household `targetUserId`).
  | "DOCTOR_PORTAL_DISABLED"
  | "DOCTOR_NOT_FOUND"
  | "APPOINTMENT_NOT_FOUND"
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
