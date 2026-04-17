import axios, { type AxiosInstance, type AxiosRequestConfig, type InternalAxiosRequestConfig } from "axios";
import Constants from "expo-constants";
import { useAuthStore } from "@/stores/auth.store";
import { TIMEOUTS } from "@/utils/constants";

const baseURL =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ??
  "http://localhost:4000/api/v1";

const client: AxiosInstance = axios.create({
  baseURL,
  timeout: TIMEOUTS.apiRequestMs,
});

// --- Request: attach Bearer token ---
client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.set("authorization", `Bearer ${token}`);
  }
  return config;
});

// --- Response: auto-refresh on 401 ---
let refreshPromise: Promise<boolean> | null = null;

const doRefresh = async (): Promise<boolean> => {
  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) return false;
  try {
    const res = await axios.post<{
      success: boolean;
      data: { accessToken: string; refreshToken: string };
    }>(`${baseURL}/auth/refresh`, { refreshToken });
    const { accessToken: newAccess, refreshToken: newRefresh } = res.data.data;
    await useAuthStore.getState().setTokens(
      newAccess,
      newRefresh,
      useAuthStore.getState().userId ?? "",
    );
    return true;
  } catch {
    await useAuthStore.getState().clear();
    return false;
  }
};

client.interceptors.response.use(undefined, async (error) => {
  const original = error.config as InternalAxiosRequestConfig & { _retried?: boolean };
  if (error.response?.status !== 401 || original._retried || original.url?.includes("/auth/")) {
    throw error;
  }
  original._retried = true;

  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }

  const ok = await refreshPromise;
  if (!ok) throw error;

  const newToken = useAuthStore.getState().accessToken;
  if (newToken) {
    original.headers.set("authorization", `Bearer ${newToken}`);
  }
  return client(original);
});

// --- Public API ---
export async function apiCall<T>(
  fn: () => Promise<T>,
  fallback: T,
): Promise<{ data: T; fromFallback: boolean }> {
  try {
    const data = await fn();
    return { data, fromFallback: false };
  } catch {
    return { data: fallback, fromFallback: true };
  }
}

export const api = {
  get: <T,>(url: string, config?: AxiosRequestConfig) =>
    client.get<T>(url, config).then((r) => r.data),
  post: <T, B = unknown>(url: string, body?: B, config?: AxiosRequestConfig) =>
    client.post<T>(url, body, config).then((r) => r.data),
  put: <T, B = unknown>(url: string, body?: B, config?: AxiosRequestConfig) =>
    client.put<T>(url, body, config).then((r) => r.data),
  patch: <T, B = unknown>(url: string, body?: B, config?: AxiosRequestConfig) =>
    client.patch<T>(url, body, config).then((r) => r.data),
  delete: <T,>(url: string, config?: AxiosRequestConfig) =>
    client.delete<T>(url, config).then((r) => r.data),
};

export { client };
