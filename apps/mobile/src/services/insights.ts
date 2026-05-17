// Phase 2 — Insights service. Reads from `/insights` (paginated) and
// posts acknowledgements. Low-confidence rows are filtered server-side
// (confidence ≥ 0.7) so the client doesn't have to know the floor.

import { api } from "@/services/api";
import { logError } from "@/services/analytics";

export type InsightSeverity = "info" | "warn" | "critical";
export type InsightPatternType =
  | "spike"
  | "trend"
  | "meal_correlation"
  | "anomaly"
  | "cross_condition";

export interface InsightEventDto {
  id: string;
  patternType: InsightPatternType;
  conditionsInvolved: string[];
  severityScore: number;
  severityLevel: InsightSeverity;
  messageKey: string;
  messageParams: Record<string, unknown>;
  triggerReadings: string[];
  acknowledged: boolean;
  helpful: boolean | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface InsightListResult {
  data: InsightEventDto[];
  cursor: string | null;
  hasMore: boolean;
}

export const listInsights = async (params: {
  severity?: InsightSeverity;
  acknowledged?: boolean;
  patternType?: InsightPatternType;
  limit?: number;
  cursor?: string;
}): Promise<InsightListResult> => {
  try {
    const res = await api.get<{ success: boolean; data: InsightListResult }>("/insights", {
      params,
    });
    return res.data;
  } catch (err) {
    logError("listInsights", err);
    return { data: [], cursor: null, hasMore: false };
  }
};

export const acknowledgeInsight = async (
  id: string,
  helpful?: boolean,
): Promise<InsightEventDto | null> => {
  try {
    const res = await api.post<{ success: boolean; data: { insight: InsightEventDto } }>(
      `/insights/${id}/acknowledge`,
      helpful !== undefined ? { helpful } : {},
    );
    return res.data.insight;
  } catch (err) {
    logError("acknowledgeInsight", err);
    return null;
  }
};
