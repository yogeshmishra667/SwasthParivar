// Phase 4 Feature G.4 — pre-visit report HTML template.
//
// Pure string builder: ReportModel → self-contained HTML (inline CSS +
// inline-SVG sparklines, no external assets so Puppeteer renders it
// offline). All dynamic text is HTML-escaped. The PII-redaction +
// watermark + AI-label invariants are already enforced by
// `buildReportModel`; this layer only presents what it's given.

import type { ReportModel, SeriesSummary } from "@swasth/domain-logic";

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Tiny inline-SVG sparkline. Scales the series into a 160×40 box. A
// single point renders as a dot.
const sparkline = (values: readonly number[]): string => {
  const W = 160;
  const H = 40;
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = values.length > 1 ? W / (values.length - 1) : 0;
  const points = values
    .map((v, i) => {
      const x = values.length > 1 ? i * stepX : W / 2;
      const y = H - ((v - min) / span) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const dot =
    values.length === 1
      ? `<circle cx="${W / 2}" cy="${H / 2}" r="3" fill="#0b6e4f" />`
      : `<polyline points="${points}" fill="none" stroke="#0b6e4f" stroke-width="2" />`;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${dot}</svg>`;
};

const seriesRow = (label: string, s: SeriesSummary | null): string => {
  if (!s) {
    return `<tr><td>${escapeHtml(label)}</td><td colspan="4" class="muted">No readings in the last 30 days</td><td></td></tr>`;
  }
  return `<tr>
    <td>${escapeHtml(label)}</td>
    <td>${s.latest}</td>
    <td>${s.avg}</td>
    <td>${s.min}</td>
    <td>${s.max}</td>
    <td>${sparkline(s.values)}</td>
  </tr>`;
};

export const renderReportHtml = (model: ReportModel): string => {
  const generated = new Date(model.generatedAtIso).toUTCString();

  const bpBlock = model.bp
    ? `<p><strong>Blood pressure</strong> — latest ${model.bp.latestSystolic}/${model.bp.latestDiastolic}, 30-day average ${model.bp.avgSystolic}/${model.bp.avgDiastolic} (${model.bp.count} readings).</p>`
    : `<p><strong>Blood pressure</strong> — <span class="muted">no readings in the last 30 days.</span></p>`;

  const hba1cBlock =
    model.hba1cEstimate !== null
      ? `<p><strong>HbA1c</strong> — <em>estimated</em> ${model.hba1cEstimate.toFixed(1)}% (ESTIMATE — recommend lab confirmation).</p>`
      : `<p><strong>HbA1c</strong> — <span class="muted">insufficient data to estimate.</span></p>`;

  const adherenceBlock =
    model.medAdherencePercent !== null
      ? `<p><strong>Medication adherence</strong> — ${model.medAdherencePercent}% over the last 30 days.</p>`
      : `<p><strong>Medication adherence</strong> — <span class="muted">no schedule data.</span></p>`;

  const insightsBlock =
    model.insights.length > 0
      ? `<ul>${model.insights
          .map(
            (i) =>
              `<li>${escapeHtml(i.title)} <span class="sev">(${escapeHtml(i.severity)})</span></li>`,
          )
          .join("")}</ul>`
      : `<p class="muted">No notable patterns detected.</p>`;

  const aiBlock = model.aiSummary
    ? `<section class="ai">
        <h2>Summary</h2>
        <p class="ai-label">${escapeHtml(model.aiSummary.label)}</p>
        <p>${escapeHtml(model.aiSummary.text)}</p>
      </section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; margin: 32px; font-size: 13px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 15px; margin: 18px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 12px; }
  th { color: #555; font-weight: 600; }
  .muted { color: #999; }
  .sev { color: #777; font-size: 11px; }
  .ai { background: #f3f8f6; border: 1px solid #cfe6dd; border-radius: 6px; padding: 12px 14px; margin-top: 18px; }
  .ai-label { color: #0b6e4f; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 6px; }
  footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #ddd; color: #999; font-size: 11px; }
</style>
</head>
<body>
  <h1>Pre-visit health report</h1>
  <div class="meta">${escapeHtml(model.patientName)} · age band ${escapeHtml(model.ageBand)} · generated ${escapeHtml(generated)}</div>

  <h2>Glucose (last 30 days)</h2>
  <table>
    <thead><tr><th>Type</th><th>Latest</th><th>Avg</th><th>Min</th><th>Max</th><th>Trend</th></tr></thead>
    <tbody>
      ${seriesRow("Fasting", model.glucose.fasting)}
      ${seriesRow("Post-meal", model.glucose.postMeal)}
    </tbody>
  </table>

  <h2>Other measures</h2>
  ${bpBlock}
  ${hba1cBlock}
  ${adherenceBlock}

  <h2>Notable patterns</h2>
  ${insightsBlock}

  ${aiBlock}

  <footer>${escapeHtml(model.watermark)}</footer>
</body>
</html>`;
};
