// guardian-multi-patient-sort — orders a guardian's patients for the
// GuardianHome list. Pure and deterministic.
//
// Order: most urgent severity first (orange > yellow > safe); within a
// severity, the freshest alert first (smaller alertAgeMin); ties broken
// by id so the result is fully deterministic.

import type { GuardianRiskBand } from "@swasth/shared-types";
import type { MultiPatientSortInput } from "./types.js";

const SEVERITY_RANK: Record<GuardianRiskBand, number> = {
  orange: 3,
  yellow: 2,
  safe: 1,
};

export const sortPatientsByUrgency = (input: MultiPatientSortInput): string[] => {
  return [...input.patients]
    .sort((a, b) => {
      const byRank = SEVERITY_RANK[b.latestAlertSeverity] - SEVERITY_RANK[a.latestAlertSeverity];
      if (byRank !== 0) return byRank;
      if (a.alertAgeMin !== b.alertAgeMin) return a.alertAgeMin - b.alertAgeMin;
      // Fully deterministic tie-break on id.
      return a.id.localeCompare(b.id);
    })
    .map((p) => p.id);
};
