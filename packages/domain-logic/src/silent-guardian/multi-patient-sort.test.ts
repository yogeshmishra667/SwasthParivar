import { describe, expect, it } from "vitest";

import { sortPatientsByUrgency } from "./multi-patient-sort.js";
import type { PatientUrgency } from "./types.js";

describe("sortPatientsByUrgency", () => {
  it("orders orange before yellow before safe", () => {
    const patients: PatientUrgency[] = [
      { id: "safe-1", latestAlertSeverity: "safe", alertAgeMin: 10 },
      { id: "orange-1", latestAlertSeverity: "orange", alertAgeMin: 10 },
      { id: "yellow-1", latestAlertSeverity: "yellow", alertAgeMin: 10 },
    ];
    expect(sortPatientsByUrgency({ patients })).toEqual(["orange-1", "yellow-1", "safe-1"]);
  });

  it("within a severity, the freshest alert comes first", () => {
    const patients: PatientUrgency[] = [
      { id: "stale", latestAlertSeverity: "orange", alertAgeMin: 600 },
      { id: "fresh", latestAlertSeverity: "orange", alertAgeMin: 5 },
    ];
    expect(sortPatientsByUrgency({ patients })).toEqual(["fresh", "stale"]);
  });

  it("breaks exact ties deterministically by id", () => {
    const patients: PatientUrgency[] = [
      { id: "b", latestAlertSeverity: "yellow", alertAgeMin: 30 },
      { id: "a", latestAlertSeverity: "yellow", alertAgeMin: 30 },
      { id: "c", latestAlertSeverity: "yellow", alertAgeMin: 30 },
    ];
    expect(sortPatientsByUrgency({ patients })).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const patients: PatientUrgency[] = [
      { id: "y", latestAlertSeverity: "yellow", alertAgeMin: 1 },
      { id: "o", latestAlertSeverity: "orange", alertAgeMin: 1 },
    ];
    sortPatientsByUrgency({ patients });
    expect(patients.map((p) => p.id)).toEqual(["y", "o"]);
  });

  it("empty list → empty result", () => {
    expect(sortPatientsByUrgency({ patients: [] })).toEqual([]);
  });
});
