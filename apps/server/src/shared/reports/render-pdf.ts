// Phase 4 Feature G.4 — HTML → PDF via Puppeteer.
//
// Isolated behind a one-function boundary so the GENERATE_PDF worker can
// be unit/integration-tested by mocking THIS module (tests must never
// launch real Chromium in CI — same reason expo-push is mocked).
//
// One browser per call: the cron generates a handful of reports a day,
// so the cost of a fresh launch is acceptable and avoids a long-lived
// Chromium process leaking into the worker. If report volume grows, swap
// to a pooled singleton — the signature stays the same.

import puppeteer from "puppeteer";

export const renderHtmlToPdf = async (html: string): Promise<Buffer> => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    // The HTML is fully self-contained (inline CSS + inline-SVG), so
    // "load" is sufficient — there are no network requests to idle on.
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
};
