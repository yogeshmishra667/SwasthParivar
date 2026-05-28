// Phase 4 Feature D' — shared shapes for outbound IVR vendors.
//
// Two vendor wrappers (Exotel for India, Twilio for international)
// must accept the same input shape and return the same result shape
// so the dispatcher can pick by phone prefix without case analysis.

export interface IvrCallRequest {
  /** E.164 with leading `+`. Used to pick the vendor (+91* → Exotel,
   * everything else → Twilio). */
  readonly to: string;
  /** TTS-friendly script (no emoji, full sentences). Built by
   * `buildSOSMessage`. */
  readonly script: string;
  /** Caller-controlled correlation id — surfaces in vendor webhooks
   * + dispatcher logs. Use `sos:<eventId>:<contactId>:<attempt>`. */
  readonly correlationId: string;
}

export type IvrCallStatus =
  | "queued" // vendor accepted, dialling in flight
  | "test_mode_skipped" // sos_test_mode flag is true → log-only
  | "no_vendor_configured" // creds missing for the routed vendor
  | "vendor_error"; // vendor returned non-2xx / network failure

export interface IvrCallResult {
  readonly status: IvrCallStatus;
  /** Vendor's own job/call id when available — useful for webhook
   * cross-reference. */
  readonly vendorCallId?: string;
  /** Human-readable error reason when status is `vendor_error`. */
  readonly errorMessage?: string;
}

/** Phone-prefix routing. `+91*` → Exotel; everything else → Twilio.
 * Lifted into its own helper so the test can exercise the rule
 * without booting either vendor. */
export const pickIvrVendor = (e164Phone: string): "exotel" | "twilio" => {
  return e164Phone.startsWith("+91") ? "exotel" : "twilio";
};
