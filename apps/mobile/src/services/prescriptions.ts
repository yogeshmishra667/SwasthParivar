// Phase 4 §F — prescription OCR + approval client. Mirrors the server
// module 1:1. The server resolves approver-vs-patient authority, so the
// mobile UI just forwards intent; a 403 `APPROVAL_REQUIRES_GUARDIAN`
// means "this device isn't the approver" and the UI shows read-only.

import type { PrescriptionItemColor, PrescriptionItemStatus } from "@swasth/shared-types";

import { api } from "@/services/api";

export type PrescriptionStatus =
  | "pending_ocr"
  | "pending_approval"
  | "partial"
  | "approved"
  | "rejected";

export interface PrescriptionItemView {
  id: string;
  ocrMedicineName: string;
  ocrDosage: string;
  ocrFrequency: string;
  ocrConfidence: number;
  ocrColor: PrescriptionItemColor;
  status: PrescriptionItemStatus;
  verifiedMedicineName: string | null;
  verifiedDosage: string | null;
  verifiedFrequency: string | null;
  approverNote: string | null;
  clarificationAttempts: number;
  pairedMedicinePhotoIds: string[];
}

export interface PrescriptionView {
  id: string;
  userId: string;
  status: PrescriptionStatus;
  requiresGuardianApproval: boolean;
  /** null — a guardian had to approve and none is linked now (read-only). */
  approverUserId: string | null;
  approverFrictionLevel: "none" | "high";
  originalPhotoUrls: string[];
  approvedBy: string | null;
  rejectionReason: string | null;
  createdAt: string;
  items: PrescriptionItemView[];
  medicinePhotos: {
    id: string;
    photoUrl: string;
    uploadedAt: string;
    aiReadName: string | null;
    matchStatus: string;
  }[];
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

/** A captured photo ready for multipart upload (expo-camera uri). */
export interface CapturedPhoto {
  uri: string;
  name: string;
}

const filePart = (p: CapturedPhoto): unknown =>
  // React Native FormData accepts this shape for a file part.
  ({ uri: p.uri, name: p.name, type: "image/jpeg" });

export interface UploadResult {
  prescriptionId: string;
  status: "pending_ocr";
  requiresGuardianApproval: boolean;
  approverUserId: string;
}

export const uploadPrescription = async (input: {
  prescriptionPhotos: CapturedPhoto[];
  medicinePhotos: CapturedPhoto[];
  targetUserId?: string;
}): Promise<UploadResult> => {
  const form = new FormData();
  for (const p of input.prescriptionPhotos) form.append("prescriptionPhotos", filePart(p) as Blob);
  for (const p of input.medicinePhotos) form.append("medicinePhotos", filePart(p) as Blob);
  if (input.targetUserId) form.append("targetUserId", input.targetUserId);
  const res = await api.post<Envelope<UploadResult>>("/prescriptions/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
};

export const getPrescription = async (id: string): Promise<PrescriptionView> => {
  const res = await api.get<Envelope<PrescriptionView>>(`/prescriptions/${id}`);
  return res.data;
};

export interface PrescriptionListItem {
  id: string;
  status: PrescriptionStatus;
  createdAt: string;
  pendingItemCount: number;
}

/**
 * Lists prescriptions for the active profile, optionally status-filtered.
 * Backs the dashboard "pending approval" nudge. `targetUserId` follows
 * the household pattern. Throws on failure — the dashboard wraps this in
 * a best-effort try/catch and hides the nudge on any error.
 */
export const listPrescriptions = async (params?: {
  status?: PrescriptionStatus;
  targetUserId?: string;
}): Promise<PrescriptionListItem[]> => {
  const query: Record<string, string> = {};
  if (params?.status) query.status = params.status;
  if (params?.targetUserId) query.targetUserId = params.targetUserId;
  const res = await api.get<Envelope<{ prescriptions: PrescriptionListItem[] }>>("/prescriptions", {
    params: Object.keys(query).length > 0 ? query : undefined,
  });
  return res.data.prescriptions;
};

export interface ApproverItemDecision {
  id: string;
  decision: "approve" | "reject" | "needs_doctor";
  verifiedMedicineName?: string;
  verifiedDosage?: string;
  verifiedFrequency?: string;
  approverNote?: string;
}

export const approvePrescription = async (
  id: string,
  items: ApproverItemDecision[],
): Promise<PrescriptionView["status"]> => {
  const res = await api.post<Envelope<{ status: PrescriptionView["status"] }>>(
    `/prescriptions/${id}/approve`,
    { items },
  );
  return res.data.status;
};

export const rejectPrescription = async (id: string, reason: string): Promise<void> => {
  await api.post(`/prescriptions/${id}/reject`, { reason });
};

export const clarifyItem = async (
  prescriptionId: string,
  itemId: string,
  input: { typedMedicineName?: string; photo?: CapturedPhoto; clarificationAttemptId: string },
): Promise<void> => {
  const form = new FormData();
  form.append("clarificationAttemptId", input.clarificationAttemptId);
  if (input.typedMedicineName) form.append("typedMedicineName", input.typedMedicineName);
  if (input.photo) form.append("photo", filePart(input.photo) as Blob);
  await api.post(`/prescriptions/${prescriptionId}/items/${itemId}/clarify`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const appendPhotos = async (
  prescriptionId: string,
  input: {
    prescriptionPhotos: CapturedPhoto[];
    medicinePhotos: CapturedPhoto[];
    deltaUploadId: string;
  },
): Promise<void> => {
  const form = new FormData();
  form.append("deltaUploadId", input.deltaUploadId);
  for (const p of input.prescriptionPhotos) form.append("prescriptionPhotos", filePart(p) as Blob);
  for (const p of input.medicinePhotos) form.append("medicinePhotos", filePart(p) as Blob);
  await api.post(`/prescriptions/${prescriptionId}/photos`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const addManualItem = async (
  prescriptionId: string,
  input: {
    typedMedicineName: string;
    typedDosage: string;
    typedFrequency: string;
    approverNote?: string;
    addAttemptId: string;
  },
): Promise<{ itemId: string; status: PrescriptionItemStatus }> => {
  const res = await api.post<Envelope<{ itemId: string; status: PrescriptionItemStatus }>>(
    `/prescriptions/${prescriptionId}/items`,
    input,
  );
  return res.data;
};

export const addMedicinePhoto = async (scheduleId: string, photo: CapturedPhoto): Promise<void> => {
  const form = new FormData();
  form.append("photo", filePart(photo) as Blob);
  await api.post(`/medicines/${scheduleId}/photo`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};
