import { GLUCOSE_CRITICAL_HIGH, GLUCOSE_CRITICAL_LOW } from "@swasth/shared-types";
import {
  CRITICAL_COOLDOWN_MINUTES,
  type BypassDecision,
  type BypassDecisionInput,
} from "./types.js";

const MS_PER_MIN = 60_000;

export const decideCriticalBypass = (input: BypassDecisionInput): BypassDecision => {
  const value = input.glucoseValueMgDl;
  const isLow = value < GLUCOSE_CRITICAL_LOW;
  const isHigh = value > GLUCOSE_CRITICAL_HIGH;
  const isCritical = isLow || isHigh;

  if (!isCritical) {
    return {
      isCritical: false,
      severity: null,
      withinCooldown: false,
      showFullscreenAlert: false,
      triggerPush: false,
      triggerSmsFallback: false,
      showCallButton: false,
      pushTargets: [],
      smsTargets: [],
      copyKey: null,
    };
  }

  const nowMs = Date.parse(input.nowIso);
  const lastMs = input.lastBypassTriggeredAtIso ? Date.parse(input.lastBypassTriggeredAtIso) : null;
  const withinCooldown = lastMs !== null && nowMs - lastMs < CRITICAL_COOLDOWN_MINUTES * MS_PER_MIN;

  const sortedContacts = [...input.emergencyContacts].sort((a, b) => a.priority - b.priority);
  const pushTargets = withinCooldown
    ? []
    : sortedContacts.filter((c) => c.isGuardian).map((c) => c.contactId);
  const smsTargets = withinCooldown ? [] : sortedContacts.map((c) => c.contactId);

  return {
    isCritical: true,
    severity: isLow ? "low" : "high",
    withinCooldown,
    showFullscreenAlert: true,
    triggerPush: !withinCooldown,
    triggerSmsFallback: !withinCooldown,
    showCallButton: true,
    pushTargets,
    smsTargets,
    copyKey: isLow ? "critical.low" : "critical.high",
  };
};
