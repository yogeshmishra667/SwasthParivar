/**
 * True only when the signed-in user IS the prescription's approver. Both
 * ids must be real: a signed-out `null` must never match the `null`
 * approver of a prescription whose guardian is no longer linked (audit P6)
 * — that would render the approve controls to someone the server refuses.
 */
export const isPrescriptionApprover = (
  approverUserId: string | null | undefined,
  currentUserId: string | null,
): boolean =>
  approverUserId !== null &&
  approverUserId !== undefined &&
  currentUserId !== null &&
  approverUserId === currentUserId;
