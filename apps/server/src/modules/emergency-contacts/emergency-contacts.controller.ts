// Phase 1 corrigendum — emergency-contact CRUD controller.
//
// Thin layer: validates the path/query (Zod already passed in routes),
// resolves the household-member target id, and forwards to the service.

import type { Request, Response } from "express";
import * as service from "./emergency-contacts.service.js";

export const getContacts = async (req: Request, res: Response): Promise<void> => {
  const targetUserId =
    typeof req.query.targetUserId === "string" ? req.query.targetUserId : undefined;
  const contacts = await service.listContacts(req.auth!, targetUserId);
  res.json({ success: true, data: { contacts } });
};

export const postContact = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    name: string;
    phone: string;
    relationship: string;
    priority: number;
    isGuardian: boolean;
    targetUserId?: string;
  };
  const contact = await service.createContact(req.auth!, body);
  res.status(201).json({ success: true, data: { contact } });
};

export const putContact = async (req: Request, res: Response): Promise<void> => {
  const contactId = String(req.params.contactId);
  const body = req.body as {
    name?: string;
    phone?: string;
    relationship?: string;
    priority?: number;
    isGuardian?: boolean;
  };
  const contact = await service.updateContact(req.auth!, { contactId, ...body });
  res.json({ success: true, data: { contact } });
};

export const deleteContactController = async (req: Request, res: Response): Promise<void> => {
  const contactId = String(req.params.contactId);
  await service.deleteContact(req.auth!, contactId);
  res.json({ success: true });
};
