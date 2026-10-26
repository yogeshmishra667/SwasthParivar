// Audit P2 — the critical alert's call target is the profile's priority-1
// emergency contact, cached so it is still offered offline.
const mockStorage = new Map<string, string>();
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((k: string) => Promise.resolve(mockStorage.get(k) ?? null)),
    setItem: jest.fn((k: string, v: string) => Promise.resolve(void mockStorage.set(k, v))),
    removeItem: jest.fn((k: string) => Promise.resolve(void mockStorage.delete(k))),
  },
}));
jest.mock("@/services/emergency-contacts", () => ({ listEmergencyContacts: jest.fn() }));
jest.mock("@/services/analytics", () => ({ logError: jest.fn() }));
jest.mock("@/stores/profile.store", () => ({
  useProfileStore: { getState: () => ({ primaryUserId: "primary" }) },
}));

import { listEmergencyContacts, type EmergencyContactDto } from "@/services/emergency-contacts";
import { readCachedPriorityContact, refreshPriorityContact } from "@/services/priority-contact";

const list = listEmergencyContacts as jest.Mock;

const contact = (id: string, priority: number, phone = "+919800000000"): EmergencyContactDto => ({
  id,
  userId: "u",
  name: `Contact ${id}`,
  phone,
  relationship: "son",
  priority,
  isGuardian: false,
  createdAt: "2026-10-01T00:00:00.000Z",
});

beforeEach(() => {
  mockStorage.clear();
  list.mockReset();
});

describe("refreshPriorityContact", () => {
  it("picks the lowest priority with a dialable phone and caches it", async () => {
    list.mockResolvedValue([contact("c3", 3), contact("c1", 1, "n/a"), contact("c2", 2)]);
    await expect(refreshPriorityContact("primary")).resolves.toMatchObject({ id: "c2" });
    await expect(readCachedPriorityContact("primary")).resolves.toMatchObject({ id: "c2" });
  });

  it("asks for a sub-profile's own contacts, and the primary's without targetUserId", async () => {
    list.mockResolvedValue([contact("c1", 1)]);
    await refreshPriorityContact("maa");
    expect(list).toHaveBeenLastCalledWith("maa");
    await refreshPriorityContact("primary");
    expect(list).toHaveBeenLastCalledWith(undefined);
  });

  it("offline, falls back to the cached contact", async () => {
    list.mockResolvedValueOnce([contact("c1", 1)]);
    await refreshPriorityContact("maa");
    list.mockRejectedValueOnce(new Error("Network Error"));
    await expect(refreshPriorityContact("maa")).resolves.toMatchObject({ id: "c1" });
  });

  it("clears the cache when the profile has no contacts left", async () => {
    list.mockResolvedValueOnce([contact("c1", 1)]);
    await refreshPriorityContact("maa");
    list.mockResolvedValueOnce([]);
    await expect(refreshPriorityContact("maa")).resolves.toBeNull();
    await expect(readCachedPriorityContact("maa")).resolves.toBeNull();
  });

  it("keeps each profile's contact separate", async () => {
    list.mockResolvedValueOnce([contact("papa-c", 1)]).mockResolvedValueOnce([contact("maa-c", 1)]);
    await refreshPriorityContact("primary");
    await refreshPriorityContact("maa");
    await expect(readCachedPriorityContact("primary")).resolves.toMatchObject({ id: "papa-c" });
    await expect(readCachedPriorityContact("maa")).resolves.toMatchObject({ id: "maa-c" });
  });
});
