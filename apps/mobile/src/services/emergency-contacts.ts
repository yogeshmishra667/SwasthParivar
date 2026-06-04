// Phase 1 corrigendum — mobile client for /api/v1/emergency-contacts.
//
// Mirrors the server shape 1:1. All endpoints are auth-protected; the
// server enforces household-scoped authz via `resolveHouseholdMember`
// using `targetUserId`. From the mobile side we pass the active
// profile's id as `targetUserId` so the household primary can manage a
// sub-profile's contacts (same pattern as family.ts).
//
// Error handling: each function returns the parsed DTO on success and
// throws on failure — the screen catches and surfaces a Hindi-first
// error toast. This is different from `dashboard-cache` style fallbacks
// because writes MUST be observable: silently swallowing a 5-contact
// cap rejection would leave the user wondering why the new contact
// didn't appear.

import { api } from "@/services/api";

export interface EmergencyContactDto {
  id: string;
  userId: string;
  name: string;
  phone: string;
  relationship: string;
  priority: number;
  isGuardian: boolean;
  createdAt: string;
}

export interface CreateContactInput {
  name: string;
  phone: string;
  relationship: string;
  priority: number;
  isGuardian: boolean;
  /** Active profile when the caller is the household primary. */
  targetUserId?: string | undefined;
}

export interface UpdateContactInput {
  name?: string;
  phone?: string;
  relationship?: string;
  priority?: number;
  isGuardian?: boolean;
}

interface ListResponse {
  success: boolean;
  data: { contacts: EmergencyContactDto[] };
}

interface MutateResponse {
  success: boolean;
  data: { contact: EmergencyContactDto };
}

export const listEmergencyContacts = async (
  targetUserId?: string,
): Promise<EmergencyContactDto[]> => {
  const params = targetUserId !== undefined ? { targetUserId } : undefined;
  const res = await api.get<ListResponse>("/emergency-contacts", { params });
  return res.data.contacts;
};

export const createEmergencyContact = async (
  input: CreateContactInput,
): Promise<EmergencyContactDto> => {
  const res = await api.post<MutateResponse, CreateContactInput>("/emergency-contacts", input);
  return res.data.contact;
};

export const updateEmergencyContact = async (
  contactId: string,
  patch: UpdateContactInput,
): Promise<EmergencyContactDto> => {
  const res = await api.put<MutateResponse, UpdateContactInput>(
    `/emergency-contacts/${contactId}`,
    patch,
  );
  return res.data.contact;
};

export const deleteEmergencyContact = async (contactId: string): Promise<void> => {
  await api.delete(`/emergency-contacts/${contactId}`);
};

export const MAX_EMERGENCY_CONTACTS = 5;
