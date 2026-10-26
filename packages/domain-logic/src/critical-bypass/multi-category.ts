import type { CriticalBypassCategory } from "@swasth/shared-types";
import { CRITICAL_COOLDOWN_MINUTES } from "./types.js";

const MS_PER_MIN = 60_000;

/**
 * Stable identifier for the push/SMS copy template that the server-side
 * i18n bundle will render. Categories own their own keys so a glucose-
 * low dispatched at the same moment as a cardiac-high produces two
 * distinct notifications (per CLAUDE.md "Phase 4 Invariants — Multi-
 * condition Critical-Bypass Dispatch", per-category cooldown).
 */
export type MultiCategoryCopyKey =
  | "critical.bp.low"
  | "critical.bp.high"
  | "critical.cardiac.hr_low"
  | "critical.cardiac.hr_high"
  | "critical.cardiac.chest_pain"
  | "critical.respiratory.peak_flow"
  | "critical.respiratory.severe_symptom";

export interface MultiCategoryBypassInput {
  readonly category: Exclude<CriticalBypassCategory, "glucose">;
  /**
   * Stable identifier for the reason the classifier picked. Each
   * `reasons[]` value from `classifyBPReading` / `classifyCardiacReading` /
   * `classifyRespiratoryReading` is mapped to one copy key by the
   * planner — falls through to the first matching critical reason.
   */
  readonly reasons: readonly string[];
  readonly nowIso: string;
  readonly lastBypassTriggeredAtIso: string | null;
  readonly emergencyContacts: readonly {
    contactId: string;
    priority: number;
    isGuardian: boolean;
  }[];
}

export interface MultiCategoryBypassDispatch {
  readonly category: Exclude<CriticalBypassCategory, "glucose">;
  readonly withinCooldown: boolean;
  /**
   * Always true when this helper is called — callers only build a
   * dispatch when the upstream classifier returned `critical_bypass`.
   * Surfaced explicitly so the field is shape-symmetric with the
   * glucose `BypassDecision` and the worker can treat both uniformly.
   */
  readonly showFullscreenAlert: true;
  readonly showCallButton: true;
  readonly triggerPush: boolean;
  readonly triggerSmsFallback: boolean;
  readonly pushTargets: readonly string[];
  readonly smsTargets: readonly string[];
  readonly copyKey: MultiCategoryCopyKey;
}

const cardiacCopyKey = (reasons: readonly string[]): MultiCategoryCopyKey => {
  // Precedence (medical-severity-ordered): chest_pain > hr_high > hr_low.
  // Chest pain severe is the highest-acuity cardiac signal — a 9/10
  // chest-pain reading paired with a borderline HR routes the SMS copy
  // to the cardiac-event template, not the bradycardia one.
  if (reasons.includes("critical.chest_pain_severe")) return "critical.cardiac.chest_pain";
  if (reasons.includes("critical.hr_high")) return "critical.cardiac.hr_high";
  return "critical.cardiac.hr_low";
};

const bpCopyKey = (reasons: readonly string[]): MultiCategoryCopyKey =>
  // Mirrors `bpCriticalDirection`: any high reason wins, so a reading that
  // is both (190/55) routes to the hypertensive-crisis copy.
  reasons.includes("critical.sys_high") || reasons.includes("critical.dia_high")
    ? "critical.bp.high"
    : "critical.bp.low";

const respiratoryCopyKey = (reasons: readonly string[]): MultiCategoryCopyKey => {
  // Peak-flow red zone is the more actionable signal — a numeric red-
  // zone reading is independently dispatchable to a clinician. Severe
  // symptom is the fall-back when no peak-flow was captured.
  if (reasons.includes("critical.peak_flow_red_zone")) return "critical.respiratory.peak_flow";
  return "critical.respiratory.severe_symptom";
};

/**
 * Pure planner for the per-category critical-bypass dispatch. Mirror of
 * `decideCriticalBypass` (glucose) but driven by a list of classifier
 * reason codes rather than a numeric threshold check — that keeps the
 * planner agnostic to the underlying classifier so future categories
 * (e.g. cardiac arrhythmia stream from a wearable) can reuse it without
 * teaching the planner each category's domain.
 *
 * Cooldown is **per-category** (CLAUDE.md): the `lastBypassTriggeredAtIso`
 * passed in must come from a category-scoped Redis key, not the global
 * one. The CRITICAL_COOLDOWN_MINUTES window is shared with glucose so
 * the rate-of-alert protection a guardian sees stays consistent.
 */
export const planMultiCategoryBypassDispatch = (
  input: MultiCategoryBypassInput,
): MultiCategoryBypassDispatch => {
  const nowMs = Date.parse(input.nowIso);
  const lastMs = input.lastBypassTriggeredAtIso ? Date.parse(input.lastBypassTriggeredAtIso) : null;
  const withinCooldown = lastMs !== null && nowMs - lastMs < CRITICAL_COOLDOWN_MINUTES * MS_PER_MIN;

  const sorted = [...input.emergencyContacts].sort((a, b) => a.priority - b.priority);
  const pushTargets = withinCooldown
    ? []
    : sorted.filter((c) => c.isGuardian).map((c) => c.contactId);
  const smsTargets = withinCooldown ? [] : sorted.map((c) => c.contactId);

  const copyKey =
    input.category === "bp"
      ? bpCopyKey(input.reasons)
      : input.category === "cardiac"
        ? cardiacCopyKey(input.reasons)
        : respiratoryCopyKey(input.reasons);

  return {
    category: input.category,
    withinCooldown,
    showFullscreenAlert: true,
    showCallButton: true,
    triggerPush: !withinCooldown,
    triggerSmsFallback: !withinCooldown,
    pushTargets,
    smsTargets,
    copyKey,
  };
};
