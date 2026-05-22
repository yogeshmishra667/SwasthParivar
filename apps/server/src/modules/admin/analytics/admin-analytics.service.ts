// Admin analytics service — resolves registered metrics into results.
// A database metric runs its aggregate; a posthog metric resolves as
// unavailable with an explanatory note; a failed compute degrades to
// unavailable rather than 500-ing the whole overview.

import { DomainError } from "@swasth/shared-types";
import { logger } from "../../../shared/logger.js";
import {
  adminMetrics,
  getAdminMetric,
  type AdminMetric,
  type AdminMetricResult,
} from "./admin-analytics.registry.js";

const resolveMetric = async (metric: AdminMetric): Promise<AdminMetricResult> => {
  const base = {
    key: metric.key,
    label: metric.label,
    description: metric.description,
    source: metric.source,
  };

  if (metric.source === "posthog") {
    return { ...base, available: false, value: null, note: metric.note };
  }

  try {
    return { ...base, available: true, value: await metric.compute(), note: null };
  } catch (err) {
    logger.warn({ err, metric: metric.key }, "admin analytics: metric compute failed");
    return { ...base, available: false, value: null, note: "metric computation failed" };
  }
};

/** Resolve every registered metric (database aggregates run in parallel). */
export const getOverview = async (): Promise<{ metrics: AdminMetricResult[] }> => {
  const metrics = await Promise.all(adminMetrics().map(resolveMetric));
  return { metrics };
};

/** Resolve one metric by key. */
export const getMetric = async (key: string): Promise<AdminMetricResult> => {
  const metric = getAdminMetric(key);
  if (!metric) throw new DomainError("ADMIN_NOT_FOUND", `unknown metric: ${key}`);
  return await resolveMetric(metric);
};
