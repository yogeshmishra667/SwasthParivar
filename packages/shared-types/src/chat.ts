// Shared chat types (Phase 3 Feature A). Imported by the pure
// domain-logic chat modules and by the server's chat module so both
// sides agree on intent / tier / language vocabulary without leaking
// Prisma enums into domain-logic.
//
// Mirrors `ChatCostTier` and `ChatRole` enums in prisma/schema.prisma —
// keep these unions in lockstep with the schema; the migration linter
// will fire if the schema drifts.

export type ChatRole = "user" | "assistant" | "system";

export type ChatCostTier = "template" | "cached" | "sonnet";

// Languages the chat surfaces accept. "hi-en" is the code-mixed
// transliterated Hinglish form the AI most commonly produces; the user
// profile's `preferredLanguage` enum stays narrower (hi | en) — the
// chat language widens at the boundary to capture mixed output.
export type ChatLanguage = "hi" | "en" | "hi-en";

// Intent buckets feed both the cost router and the template lookup.
// Stable strings; PostHog dashboards index on them.
export type ChatIntent =
  | "reading_summary"
  | "medication_question"
  | "lifestyle"
  | "data_explainer"
  | "open_ended";

// Coarsened condition for chat templates — the patient's full
// condition list (`Condition[]` on User) collapses to one of these
// three buckets so the template surface stays small and auditable.
//   diabetes → only diabetes
//   bp       → only hypertension
//   multi    → any combination including cardiac/asthma
export type ChatCondition = "diabetes" | "bp" | "multi";
