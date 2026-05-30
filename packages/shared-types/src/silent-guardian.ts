// Phase 3 — Silent Guardian. Cross-cutting string-literal contracts
// shared between the server (Prisma enums mirror these), the
// domain-logic pure functions, and the mobile client. Mirrors the
// pattern of `insights.ts`: keep the union small, never reuse a string.

// Source of a Silent Guardian signal.
//
// Phase 3 shipped med_adherence + data_anomaly. Phase 4 §C' expands:
//   chat_sentiment — derived from Tier-3 chat exchanges flagged as
//                    distressed by the safety filter (CLAUDE.md "Silent
//                    Guardian → Signals → chat_sentiment").
//   schedule_miss  — ≥ 3 consecutive HealthCheckCompliance.status='missed'
//                    slots on a single schedule. Depends on the Phase 2
//                    carry-over schedules surface that landed in PR #100.
//   activity_drop  — wired-but-dormant: SignalSource enum + scorer
//                    branch ship now, but the worker pulls no data
//                    until ActivityDaily lands (Feature I).
//   cross_signal   — meta-signal: when 2+ other sources fire in the
//                    same analysis cycle, add a stacking-bonus row.
export type SignalSource =
  | "med_adherence"
  | "data_anomaly"
  | "chat_sentiment"
  | "schedule_miss"
  | "activity_drop"
  | "cross_signal";

// What a fired GuardianAlert is about. `combined` = both a
// med-adherence and a trend concern in the same analysis window.
export type GuardianAlertType = "trend_concern" | "med_adherence" | "combined";

// Stored alert severity. `red` is reserved for Phase 4 (SOS-adjacent);
// in Phase 3 the highest band is orange.
export type GuardianAlertSeverity = "yellow" | "orange";

// Risk band emitted by the aggregator. `safe` is NOT a stored severity —
// it means aggregate risk is below the alert threshold and no
// GuardianAlert row is created.
export type GuardianRiskBand = "safe" | GuardianAlertSeverity;

// Delivery channel for a guardian alert. Push is primary, SMS is the
// fallback when push fails; in_app is always available. WhatsApp as a
// channel is Phase 4 — the enum is intentionally forward-compatible.
export type AlertChannel = "push" | "sms" | "in_app";
