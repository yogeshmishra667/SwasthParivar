import { api } from "./api";

export type OtpProvider = "firebase" | "whatsapp" | "log";

interface ConfigEnvelope {
  success: boolean;
  data: { otpProvider: OtpProvider };
}

// 60-second in-memory cache so the login screen doesn't refetch on every
// keystroke. The server itself caches the flag for 30s; an ops flip will
// propagate within ~90s worst case (server cache + this cache), which
// is fine for an OTP-provider switch.
const TTL_MS = 60_000;
let cached: { provider: OtpProvider; fetchedAt: number } | null = null;

/**
 * Read the current OTP provider from the server. Cheap to call — hits
 * the in-memory cache between fetches and the server's flag cache
 * underneath. Falls back to the last known value (or "log") on network
 * failure so the user still sees a login screen rather than a crash.
 */
export const fetchOtpProvider = async (): Promise<OtpProvider> => {
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.provider;
  try {
    const envelope = await api.get<ConfigEnvelope>("/auth/config");
    const provider = envelope.data.otpProvider;
    cached = { provider, fetchedAt: Date.now() };
    return provider;
  } catch {
    // Last known wins, then "log" — keeps 000000 dev bypass reachable
    // even if the laptop is offline from the phone.
    return cached?.provider ?? "log";
  }
};

// Test seam / explicit refresh after the user pulls-to-refresh on the
// login screen (not wired today but cheap to expose).
export const invalidateOtpProviderCache = (): void => {
  cached = null;
};
