// Phase 4 Feature G.4 — reports controller.

import type { Request, Response } from "express";
import * as service from "./reports.service.js";

export const postGenerate = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { appointmentId?: string; targetUserId?: string };
  const report = await service.generateReport(req.auth!, body);
  // 202 Accepted — the PDF renders asynchronously; poll /:id/status.
  res.status(202).json({ success: true, data: { report } });
};

export const getStatus = async (req: Request, res: Response): Promise<void> => {
  const reportId = String(req.params.reportId);
  const status = await service.getReportStatus(req.auth!, reportId);
  res.json({ success: true, data: status });
};

export const getDownload = async (req: Request, res: Response): Promise<void> => {
  const reportId = String(req.params.reportId);
  const url = await service.getReportDownloadUrl(req.auth!, reportId);
  // 302 to a short-lived signed R2 URL (1-hour expiry) — the bytes never
  // pass through the API server.
  res.redirect(302, url);
};
