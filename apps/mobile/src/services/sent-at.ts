// Audit P33 — every reading request carries `sentAt`, the device's clock at
// the moment of sending. With `measuredAt` (same clock) the server knows how
// old the reading was when sent, even when the phone's clock is hours off:
// a critical reading synced hours late gets a late notice to the family,
// not an emergency page. Stamped per attempt, never stored with the row.
export const withSentAt = <T extends object>(body: T): T & { sentAt: string } => ({
  ...body,
  sentAt: new Date().toISOString(),
});
