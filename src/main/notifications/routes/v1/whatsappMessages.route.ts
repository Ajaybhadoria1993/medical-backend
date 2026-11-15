import express from 'express';
import {
  CLINIC_STAFF_ROLES,
  requireAuth,
  requireClinic,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import {
  getWhatsAppMessagesController,
  saveWhatsAppMessagesController,
} from '../../controllers/whatsappMessagePrefs.controller';
import {
  saveWhatsAppMessagesSchema,
  whatsAppMessagesResponseSchema,
} from '../../schemas/whatsappMessagePrefs.schema';

// Mounted at /api/v1/notifications/whatsapp-messages; the clinic always comes from the token.
const whatsAppMessagesRouter = express.Router();

/** @route GET /api/v1/notifications/whatsapp-messages — patient WhatsApp messages and whether each is on
 *  @access Clinic staff (own clinic) */
whatsAppMessagesRouter.get(
  '/',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  getWhatsAppMessagesController
);

/** @route PUT /api/v1/notifications/whatsapp-messages — choose which patient WhatsApp messages are sent
 *  @access Admin (own clinic) */
whatsAppMessagesRouter.put(
  '/',
  requireAuth,
  requireRole(['Admin']),
  requireClinic,
  validate(saveWhatsAppMessagesSchema, 'body'),
  saveWhatsAppMessagesController
);

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/notifications/whatsapp-messages',
  description: "The clinic's patient WhatsApp messages and whether each is on",
  responseSchema: whatsAppMessagesResponseSchema,
  tags: ['notifications'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/notifications/whatsapp-messages',
  description: 'Choose which patient WhatsApp messages are sent (Admin)',
  requestSchema: saveWhatsAppMessagesSchema,
  responseSchema: whatsAppMessagesResponseSchema,
  tags: ['notifications'],
});

export default whatsAppMessagesRouter;
