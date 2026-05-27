// Admin API client.
//
// Responsibilities:
//   1. Attach the in-memory access token + send credentials (so the
//      httpOnly refresh cookie flows on /admin/auth/refresh).
//   2. Single-flight refresh on 401 — multiple concurrent requests that
//      race a 401 must wait on ONE refresh promise; otherwise the
//      rotating refresh token gets invalidated by the second call.
//   3. Double-submit CSRF token on state-changing /admin/auth/* calls.
//      Lazy-fetched on first need; on a 403/ADMIN_CSRF_INVALID the
//      client re-fetches a fresh token and retries the request once.
//   4. Unwrap the `{ success, data }` envelope and throw a typed
//      `ApiClientError` (carries `status` + `code`) on failure.
//
// The access token + CSRF token both live only in this module's
// closure — never on React context, localStorage, or sessionStorage —
// so a React DevTools dump or an XSS read of storage cannot
// exfiltrate them.

import type { ApiError, ApiResponse, ErrorCode } from "@swasth/shared-types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

let accessToken: string | null = null;
let refreshInflight: Promise<string | null> | null = null;
let csrfToken: string | null = null;
let csrfInflight: Promise<string | null> | null = null;
let onUnauthenticated: (() => void) | null = null;

/** Replace the in-memory access token (called by AuthProvider after login / refresh). */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** Read the current in-memory access token. */
export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Register a handler for the "refresh failed, you are signed out" event.
 * AuthProvider hooks this to flip auth state to `unauthenticated`.
 */
export function setOnUnauthenticated(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

/** Error thrown by `request()` on any non-success response. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly apiError: ApiError["error"];

  constructor(status: number, apiError: ApiError["error"]) {
    super(apiError.message);
    this.name = "ApiClientError";
    this.status = status;
    this.apiError = apiError;
  }

  get code(): ErrorCode {
    return this.apiError.code;
  }
}

// ── Access-token refresh ─────────────────────────────────────────

const refresh = async (): Promise<string | null> => {
  refreshInflight ??= (async (): Promise<string | null> => {
    try {
      // /admin/auth/refresh is a state-changing POST under /admin/auth,
      // so it needs the CSRF header. On a page reload csrfToken is null
      // (in-memory only), so fetch it first before the POST or csurf
      // will reject with 403 and the session restore silently fails.
      if (!csrfToken) await fetchCsrfToken();
      const headers = new Headers({ Accept: "application/json" });
      if (csrfToken) headers.set("x-csrf-token", csrfToken);
      const res = await fetch(`${API_BASE}/admin/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers,
      });
      if (!res.ok) return null;
      const body = (await res.json()) as ApiResponse<{ accessToken: string }>;
      if (!body.success) return null;
      accessToken = body.data.accessToken;
      return accessToken;
    } catch {
      return null;
    } finally {
      // Always clear the latch so the next 401 can refresh again.
      refreshInflight = null;
    }
  })();
  return await refreshInflight;
};

// ── CSRF token bootstrap ─────────────────────────────────────────

const fetchCsrfToken = async (): Promise<string | null> => {
  csrfInflight ??= (async (): Promise<string | null> => {
    try {
      const res = await fetch(`${API_BASE}/admin/auth/csrf`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as ApiResponse<{ csrfToken: string }>;
      if (!body.success) return null;
      csrfToken = body.data.csrfToken;
      return csrfToken;
    } catch {
      return null;
    } finally {
      csrfInflight = null;
    }
  })();
  return await csrfInflight;
};

/**
 * True when this request needs a CSRF token attached. The server
 * applies `doubleCsrfProtection` only on /admin/auth POSTs (data
 * routes are bearer-token-only, no cookies in flight); the client
 * mirrors that scope so we don't pay an extra round-trip on every
 * patient-data call.
 */
const needsCsrf = (method: string | undefined, path: string): boolean => {
  if (!path.startsWith("/admin/auth/")) return false;
  if (path === "/admin/auth/csrf") return false;
  const m = (method ?? "GET").toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
};

// ── request ──────────────────────────────────────────────────────

interface RequestOptions extends Omit<RequestInit, "body"> {
  /** Will be JSON.stringify'd. Pass `undefined` for no body. */
  json?: unknown;
}

const buildHeaders = (init: RequestOptions, path: string): Headers => {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.json !== undefined) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (csrfToken && needsCsrf(init.method, path)) {
    headers.set("x-csrf-token", csrfToken);
  }
  return headers;
};

const doFetch = async (path: string, init: RequestOptions): Promise<Response> => {
  const { json, headers: _headers, ...rest } = init;
  const fetchInit: RequestInit = {
    ...rest,
    credentials: "include",
    headers: buildHeaders(init, path),
  };
  // exactOptionalPropertyTypes: only set body if we actually have one.
  if (json !== undefined) fetchInit.body = JSON.stringify(json);
  return await fetch(`${API_BASE}${path}`, fetchInit);
};

interface Attempt<T> {
  res: Response;
  body: ApiResponse<T> | null;
}

const executeOnce = async <T>(path: string, init: RequestOptions): Promise<Attempt<T>> => {
  const res = await doFetch(path, init);
  let body: ApiResponse<T> | null = null;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    // Non-JSON response (e.g. a proxy 502) — leave body null.
  }
  return { res, body };
};

/**
 * Make a request to the admin API. Returns the unwrapped `data` on
 * success; throws `ApiClientError` on failure. Transparently refreshes
 * the access token on 401 and the CSRF token on 403/ADMIN_CSRF_INVALID
 * (one retry each, single-flight).
 */
export async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const sendCsrf = needsCsrf(init.method, path);
  if (sendCsrf && !csrfToken) {
    await fetchCsrfToken();
  }

  let attempt = await executeOnce<T>(path, init);

  // 401 → refresh access token + retry once.
  if (attempt.res.status === 401) {
    const refreshed = await refresh();
    if (refreshed) {
      attempt = await executeOnce<T>(path, init);
    } else {
      accessToken = null;
      onUnauthenticated?.();
    }
  }

  // 403 with ADMIN_CSRF_INVALID → refresh CSRF token + retry once.
  if (
    attempt.res.status === 403 &&
    sendCsrf &&
    attempt.body !== null &&
    !attempt.body.success &&
    attempt.body.error.code === "ADMIN_CSRF_INVALID"
  ) {
    csrfToken = null;
    await fetchCsrfToken();
    if (csrfToken) {
      attempt = await executeOnce<T>(path, init);
    }
  }

  if (attempt.res.ok && attempt.body?.success) return attempt.body.data;

  const apiError: ApiError["error"] =
    attempt.body?.success === false
      ? attempt.body.error
      : { code: "INTERNAL_ERROR", message: attempt.res.statusText || "Request failed" };
  throw new ApiClientError(attempt.res.status, apiError);
}
