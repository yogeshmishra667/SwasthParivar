// Audit P3 — a critical cardiac / respiratory log raises the fullscreen
// alert, synced or offline, from the shared classifiers.
import {
  cardiacAlertRequest,
  respiratoryAlertRequest,
  serverAlertRequest,
} from "@/services/critical-alert-requests";

const hr = (heartRateBpm: number, chestPain = false, painSeverity: number | null = null) => ({
  heartRateBpm,
  rhythmStatus: "regular" as const,
  chestPain,
  painSeverity,
  exerciseTolerance: "normal" as const,
});

describe("cardiacAlertRequest", () => {
  it.each([
    [35, false, null, "hr_low"],
    [160, false, null, "hr_high"],
    [80, true, 8, "chest_pain"],
  ])("HR %i, chest pain %s (%s) → %s", (bpm, pain, severity, key) => {
    expect(cardiacAlertRequest(hr(bpm, pain, severity), "maa", `${bpm} bpm`)).toEqual({
      audience: "patient",
      userId: "maa",
      category: "cardiac",
      reasonKey: key,
      valueLabel: `${bpm} bpm`,
    });
  });

  it("a normal log raises nothing", () => {
    expect(cardiacAlertRequest(hr(72), "maa", "72 bpm")).toBeNull();
  });
});

describe("respiratoryAlertRequest", () => {
  it("severe symptoms raise the alert", () => {
    expect(
      respiratoryAlertRequest({ inhalerUsed: false, symptomSeverity: "severe" }, "maa", undefined),
    ).toMatchObject({ category: "respiratory", reasonKey: "severe_symptom" });
  });

  it("mild symptoms raise nothing", () => {
    expect(
      respiratoryAlertRequest(
        { peakFlow: 400, inhalerUsed: false, symptomSeverity: "mild" },
        "maa",
        "400 L/min",
      ),
    ).toBeNull();
  });
});

describe("serverAlertRequest", () => {
  it("maps the server's reason (e.g. a peak-flow red zone) to the copy key", () => {
    expect(
      serverAlertRequest("respiratory", "critical.peak_flow_red_zone", "maa", "150 L/min"),
    ).toEqual({
      audience: "patient",
      userId: "maa",
      category: "respiratory",
      reasonKey: "peak_flow",
      valueLabel: "150 L/min",
    });
  });
});
