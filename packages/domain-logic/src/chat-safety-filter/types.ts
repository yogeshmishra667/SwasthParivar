// Categories the Post-Response Safety Filter recognises. Listed in
// CLAUDE.md "AI Chat Safety" and phase3.md A.2 — keep this enum stable;
// downstream PostHog dashboards index on the string literals.
export type SafetyViolation =
  | "dosage_number"
  | "start_stop_directive"
  | "dose_change"
  | "diagnosis_claim"
  | "emergency_advice"
  | "verbatim_pii";

export interface SafetyFilterInput {
  content: string;
  // "hi-en" covers the code-mixed Hinglish the AI commonly produces.
  // The filter checks all language banks regardless — the field is
  // retained for PostHog and future per-language pattern tuning.
  language: "hi" | "en" | "hi-en";
}

export interface SafetyFilterResult {
  safe: boolean;
  violations: SafetyViolation[];
  // Substituted response when unsafe — exact string per CLAUDE.md.
  redactedContent: string;
  // Preserved so Sentry breadcrumbs / human audit queue can see what
  // the model originally produced. Never sent back to the patient.
  originalContent: string;
}

export const SAFETY_REPLACEMENT = "Yeh sawaal doctor se poochna best rahega." as const;
