// Wire types for the emergency-contacts surface.
//
// Kept here (not in shared-types) until the mobile app actually consumes
// it — at which point this file moves to packages/shared-types/.

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
  userId: string;
  name: string;
  phone: string;
  relationship: string;
  priority: number;
  isGuardian: boolean;
}

export interface UpdateContactInput {
  userId: string;
  contactId: string;
  name?: string;
  phone?: string;
  relationship?: string;
  priority?: number;
  isGuardian?: boolean;
}
