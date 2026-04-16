import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
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

client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.set("authorization", `Bearer ${token}`);
  }
  return config;
});

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
  delete: <T,>(url: string, config?: AxiosRequestConfig) =>
    client.delete<T>(url, config).then((r) => r.data),
};

export { client };
