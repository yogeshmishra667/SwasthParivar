import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeHogQLMock } = vi.hoisted(() => ({ executeHogQLMock: vi.fn() }));
vi.mock("../../../shared/posthog-query.js", () => ({ executeHogQL: executeHogQLMock }));

import { getAdminMetric } from "./admin-analytics.registry.js";

const smsRate = getAdminMetric("critical_bypass_sms_success_rate")!;

describe("critical_bypass_sms_success_rate (audit D1)", () => {
  beforeEach(() => executeHogQLMock.mockReset());

  it("divides only by alerts that actually attempted an SMS", async () => {
    // 100 alerts, 20 needed SMS, 19 delivered → 95%, not 19%.
    executeHogQLMock.mockResolvedValue({ results: [[20, 19, 100]] });
    expect(await smsRate.compute()).toEqual({ total: 20, success: 19, alerts: 100, rate: 0.95 });
    const query = executeHogQLMock.mock.calls[0]![0] as string;
    expect(query).toContain("properties.sms_triggered = 'true'");
  });

  it("reports no rate (not 0%) when no alert needed an SMS", async () => {
    executeHogQLMock.mockResolvedValue({ results: [[0, 0, 7]] });
    expect(await smsRate.compute()).toEqual({ total: 0, success: 0, alerts: 7, rate: null });
  });

  it("stays unwired when PostHog isn't configured", async () => {
    executeHogQLMock.mockResolvedValue(null);
    expect(await smsRate.compute()).toBeNull();
  });
});
