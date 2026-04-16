import { useProfileStore, selectActiveProfile, type Profile } from "@/stores/profile.store";

export const useActiveProfile = (): Profile | null => {
  return useProfileStore((s) => selectActiveProfile(s));
};
