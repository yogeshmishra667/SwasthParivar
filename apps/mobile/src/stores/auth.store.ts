import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { clearDashboardCache } from "@/services/dashboard-cache";
import { useProfileStore } from "@/stores/profile.store";

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  userId: string | null;
  hydrated: boolean;
  setTokens: (access: string, refresh: string, userId: string) => Promise<void>;
  clear: () => Promise<void>;
  hydrate: () => Promise<void>;
}

const KEY_ACCESS = "sp_access";
const KEY_REFRESH = "sp_refresh";
const KEY_USER = "sp_user";

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: null,
  userId: null,
  hydrated: false,
  setTokens: async (access, refresh, userId) => {
    await SecureStore.setItemAsync(KEY_ACCESS, access);
    await SecureStore.setItemAsync(KEY_REFRESH, refresh);
    await SecureStore.setItemAsync(KEY_USER, userId);
    set({ accessToken: access, refreshToken: refresh, userId });
  },
  clear: async () => {
    await SecureStore.deleteItemAsync(KEY_ACCESS);
    await SecureStore.deleteItemAsync(KEY_REFRESH);
    await SecureStore.deleteItemAsync(KEY_USER);
    // Drop cached server data — never leak the previous user's
    // dashboard onto a fresh login on the same device.
    await clearDashboardCache();
    // Reset in-memory household/profile state too; otherwise a fresh
    // login keeps the stale activeProfileId and the switcher breaks.
    useProfileStore.getState().reset();
    set({ accessToken: null, refreshToken: null, userId: null });
  },
  hydrate: async () => {
    const [access, refresh, userId] = await Promise.all([
      SecureStore.getItemAsync(KEY_ACCESS),
      SecureStore.getItemAsync(KEY_REFRESH),
      SecureStore.getItemAsync(KEY_USER),
    ]);
    set({ accessToken: access, refreshToken: refresh, userId, hydrated: true });
  },
}));
