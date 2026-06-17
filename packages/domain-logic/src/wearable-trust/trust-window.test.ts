import { describe, expect, it } from "vitest";
import {
  WEARABLE_TRUST_WINDOW_DAYS,
  isDeviceSource,
  isWearableDetectorEligible,
  trustWindowEndsAt,
} from "./trust-window.js";

const NOW = new Date("2026-06-18T12:00:00Z");
const DAY = 86_400_000;

describe("isDeviceSource", () => {
  it("treats manual as non-device", () => {
    expect(isDeviceSource("manual")).toBe(false);
  });
  it("treats healthkit and googlefit as device", () => {
    expect(isDeviceSource("healthkit")).toBe(true);
    expect(isDeviceSource("googlefit")).toBe(true);
  });
});

describe("trustWindowEndsAt", () => {
  it("ends exactly WEARABLE_TRUST_WINDOW_DAYS after first sync", () => {
    const end = trustWindowEndsAt(NOW);
    expect(end).toBe(new Date(NOW.getTime() + WEARABLE_TRUST_WINDOW_DAYS * DAY).toISOString());
  });
});

describe("isWearableDetectorEligible", () => {
  it("manual is always eligible regardless of window/promotion", () => {
    expect(
      isWearableDetectorEligible({
        source: "manual",
        now: NOW,
        trustUntilIso: null,
        promoted: false,
      }),
    ).toBe(true);
  });

  it("device with no window yet (never synced) is not eligible", () => {
    expect(
      isWearableDetectorEligible({
        source: "healthkit",
        now: NOW,
        trustUntilIso: null,
        promoted: false,
      }),
    ).toBe(false);
  });

  it("device inside the open window is not eligible", () => {
    const until = new Date(NOW.getTime() + 5 * DAY).toISOString();
    expect(
      isWearableDetectorEligible({
        source: "googlefit",
        now: NOW,
        trustUntilIso: until,
        promoted: false,
      }),
    ).toBe(false);
  });

  it("device becomes eligible once now reaches the window end (inclusive)", () => {
    const until = NOW.toISOString();
    expect(
      isWearableDetectorEligible({
        source: "healthkit",
        now: NOW,
        trustUntilIso: until,
        promoted: false,
      }),
    ).toBe(true);
  });

  it("device past the window is eligible", () => {
    const until = new Date(NOW.getTime() - DAY).toISOString();
    expect(
      isWearableDetectorEligible({
        source: "healthkit",
        now: NOW,
        trustUntilIso: until,
        promoted: false,
      }),
    ).toBe(true);
  });

  it("explicit promotion makes device eligible even inside the window", () => {
    const until = new Date(NOW.getTime() + 20 * DAY).toISOString();
    expect(
      isWearableDetectorEligible({
        source: "googlefit",
        now: NOW,
        trustUntilIso: until,
        promoted: true,
      }),
    ).toBe(true);
  });

  it("a malformed trustUntil is treated as not-yet-eligible (fail safe)", () => {
    expect(
      isWearableDetectorEligible({
        source: "healthkit",
        now: NOW,
        trustUntilIso: "not-a-date",
        promoted: false,
      }),
    ).toBe(false);
  });
});
