// Phase 1 corrigendum — /api/v1/emergency-contacts router.
//
// Endpoint map:
//   GET    /                       list caller's (or sub-profile's) contacts
//   POST   /                       create a new contact
//   PUT    /:contactId             edit a contact (name, phone, priority, …)
//   DELETE /:contactId             delete a contact
//
// All endpoints require `requireAuth`. Cross-profile actions (writing
// contacts for a sub-profile in the same household) use `targetUserId`
// in the body/query, validated by `resolveHouseholdMember` in the
// service. `requirePrimary` is NOT applied here because in a single-
// profile household the JWT subject == the contact owner — there is no
// "primary writing on behalf of someone else" distinction. The service
// authorises per-row.

import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody, validateQuery } from "../../shared/validate.js";
import {
  createContactSchema,
  listContactsQuerySchema,
  updateContactSchema,
} from "./emergency-contacts.validation.js";
import * as controller from "./emergency-contacts.controller.js";

export const emergencyContactsRouter: Router = Router();

emergencyContactsRouter.use(requireAuth);

emergencyContactsRouter.get("/", validateQuery(listContactsQuerySchema), controller.getContacts);

emergencyContactsRouter.post("/", validateBody(createContactSchema), controller.postContact);

emergencyContactsRouter.put(
  "/:contactId",
  validateBody(updateContactSchema),
  controller.putContact,
);

emergencyContactsRouter.delete("/:contactId", controller.deleteContactController);
