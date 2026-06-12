// Phase 4 Feature G.4 — pre-visit report view-model types.
//
// `buildReportModel` is pure: it takes already-gathered, already-scoped
// health data + the patient's name/age and returns the PII-stripped view
// model the HTML template renders. The redaction guarantee is structural
// — the input type simply has no slot for phone / household_id / DoB, so
// they cannot leak into the PDF even if the worker has the full User row.

/** One reading reduced to {iso, value} — enough to plot a sparkline and
 * compute summary stats. */
export interface ReadingPoint {
  readonly iso: string;
  readonly value: number;
}

export interface BpPoint {
  readonly iso: string;
  readonly systolic: number;
  readonly diastolic: number;
}

/** One insight reduced to its display fields. No `message_params`, no
 * `trigger_readings` — just the headline + severity. */
export interface ReportInsight {
  readonly title: string;
  readonly severity: string;
}

export interface ReportModelInput {
  /** Patient given name. The ONLY direct identifier carried into the
   * report (CLAUDE.md G.3 "Patient name + age band only"). */
  readonly name: string;
  /** Used to derive the age BAND — the exact age never reaches the PDF. */
  readonly age: number;
  readonly generatedAtIso: string;
  readonly glucose: {
    readonly fasting: readonly ReadingPoint[];
    readonly postMeal: readonly ReadingPoint[];
  };
  readonly bp: readonly BpPoint[];
  readonly hba1cEstimate: number | null;
  readonly medAdherencePercent: number | null;
  readonly insights: readonly ReportInsight[];
  /** Claude executive summary, already safety-filtered. `null` when the
   * call was skipped, the spend cap tripped, or the filter rejected it. */
  readonly aiSummary: string | null;
}

export interface SeriesSummary {
  readonly count: number;
  readonly latest: number;
  readonly min: number;
  readonly max: number;
  /** Rounded to a whole number — clinical display, not analysis. */
  readonly avg: number;
  /** Raw values, oldest → newest, for the sparkline. */
  readonly values: readonly number[];
}

export interface BpSummary {
  readonly count: number;
  readonly latestSystolic: number;
  readonly latestDiastolic: number;
  readonly avgSystolic: number;
  readonly avgDiastolic: number;
}

export interface ReportAiSummary {
  readonly text: string;
  readonly label: string;
}

export interface ReportModel {
  readonly patientName: string;
  /** e.g. "60–69". Derived from age; the exact age is dropped. */
  readonly ageBand: string;
  readonly generatedAtIso: string;
  /** Mandatory watermark per CLAUDE.md G.3. */
  readonly watermark: string;
  readonly glucose: {
    readonly fasting: SeriesSummary | null;
    readonly postMeal: SeriesSummary | null;
  };
  readonly bp: BpSummary | null;
  readonly hba1cEstimate: number | null;
  readonly medAdherencePercent: number | null;
  readonly insights: readonly ReportInsight[];
  /** Present only when a safety-filtered AI paragraph survived. */
  readonly aiSummary: ReportAiSummary | null;
}
