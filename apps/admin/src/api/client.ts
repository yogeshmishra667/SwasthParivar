// Admin API client.
//
// Responsibilities:
//   1. Attach the in-memory access token + send credentials (so the
//      httpOnly refresh cookie flows on /admin/auth/refresh).
//   2. Single-flight refresh on 401 — multiple concurrent requests that
//      race a 401 must wait on ONE refresh promise; otherwise the
//      rotating refresh token gets invalidated by the second call.
//   3. Unwrap the `{ success, data }` envelope and throw a typed
//      `ApiClientError` (carries `status` + `code`) on failure.
//
// The access token lives only in this module's closure — never on
// React context, localStorage, or sessionStorage — so a React DevTools
// dump or an XSS read of storage cannot exfiltrate it.

import type { ApiError, ApiResponse, ErrorCode } from "@swasth/shared-types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

let accessToken: string | null = null;
let refreshInflight: Promise<string | null> | null = null;
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

const refresh = async (): Promise<string | null> => {
  refreshInflight ??= (async (): Promise<string | null> => {
    try {
      const res = await fetch(`${API_BASE}/admin/auth/refresh`, {
        method: "POST",
        credentials: "include",
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

interface RequestOptions extends Omit<RequestInit, "body"> {
  /** Will be JSON.stringify'd. Pass `undefined` for no body. */
  json?: unknown;
}

const buildHeaders = (init: RequestOptions): Headers => {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.json !== undefined) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return headers;
};

const doFetch = async (path: string, init: RequestOptions): Promise<Response> => {
  const { json, headers: _headers, ...rest } = init;
  const fetchInit: RequestInit = {
    ...rest,
    credentials: "include",
    headers: buildHeaders(init),
  };
  // exactOptionalPropertyTypes: only set body if we actually have one.
  if (json !== undefined) fetchInit.body = JSON.stringify(json);
  return await fetch(`${API_BASE}${path}`, fetchInit);
};

/**
 * Make a request to the admin API. Returns the unwrapped `data` on
 * success; throws `ApiClientError` on failure. Transparently refreshes
 * the access token on 401 (one retry, single-flight).
 */
export async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  let res = await doFetch(path, init);

  if (res.status === 401) {
    const refreshed = await refresh();
    if (refreshed) {
      res = await doFetch(path, init);
    } else {
      accessToken = null;
      onUnauthenticated?.();
    }
  }

  let body: ApiResponse<T> | null = null;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    // Non-JSON response (e.g. a proxy 502) — fall through to the error throw.
  }

  if (res.ok && body?.success) return body.data;

  const apiError: ApiError["error"] =
    body?.success === false
      ? body.error
      : { code: "INTERNAL_ERROR", message: res.statusText || "Request failed" };
  throw new ApiClientError(res.status, apiError);
}
