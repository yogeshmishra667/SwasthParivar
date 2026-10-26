// The critical alert's call target (audit P2): the profile's priority-1
// emergency contact, the same row the server's critical-bypass chain and
// SOS escalation dial. Cached per profile, so the alert can still offer it
// offline, when a critical reading is most likely to land unsynced.

import AsyncStorage from "@react-native-async-storage/async-storage";

import { logError } from "@/services/analytics";
import { listEmergencyContacts, type EmergencyContactDto } from "@/services/emergency-contacts";
import { useProfileStore } from "@/stores/profile.store";
import { sanitizePhoneForTelUri } from "@/utils/phone";

export interface CallTarget {
  id: string;
  name: string;
  phone: string;
}

const cacheKey = (userId: string): string => `swasth.priorityContact.v1.${userId}`;

/** Lowest priority number with a dialable phone. */
export const pickPriorityContact = (
  contacts: readonly EmergencyContactDto[],
): CallTarget | null => {
  const top = [...contacts]
    .sort((a, b) => a.priority - b.priority)
    .find((c) => sanitizePhoneForTelUri(c.phone).length > 0);
  return top ? { id: top.id, name: top.name, phone: top.phone } : null;
};

export const readCachedPriorityContact = async (userId: string): Promise<CallTarget | null> => {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(userId));
    return raw ? (JSON.parse(raw) as CallTarget) : null;
  } catch {
    return null;
  }
};

/**
 * Fetches the profile's priority-1 contact and refreshes the cache. When
 * the fetch fails (offline), returns the cached contact instead.
 */
export const refreshPriorityContact = async (userId: string): Promise<CallTarget | null> => {
  // Same rule as the contacts screen: the primary's own contacts are the
  // JWT subject's; a sub-profile's need `targetUserId`.
  const { primaryUserId } = useProfileStore.getState();
  const targetUserId = primaryUserId !== null && userId !== primaryUserId ? userId : undefined;
  let target: CallTarget | null;
  try {
    target = pickPriorityContact(await listEmergencyContacts(targetUserId));
  } catch {
    return await readCachedPriorityContact(userId);
  }
  try {
    if (target) await AsyncStorage.setItem(cacheKey(userId), JSON.stringify(target));
    else await AsyncStorage.removeItem(cacheKey(userId));
  } catch (err) {
    logError("priorityContactCache", err);
  }
  return target;
};
