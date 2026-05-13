export interface BypassDecisionInput {
  glucoseValueMgDl: number;
  nowIso: string;
  lastBypassTriggeredAtIso: string | null;
  emergencyContacts: readonly {
    contactId: string;
    priority: number;
    isGuardian: boolean;
  }[];
}

export interface BypassDecision {
  isCritical: boolean;
  severity: "low" | "high" | null;
  withinCooldown: boolean;
  showFullscreenAlert: boolean;
  triggerPush: boolean;
  triggerSmsFallback: boolean;
  showCallButton: boolean;
  pushTargets: string[];
  smsTargets: string[];
  copyKey: "critical.low" | "critical.high" | null;
}

export const CRITICAL_COOLDOWN_MINUTES = 30 as const;
