import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import {
  listWhatsAppMessagesController,
  setWhatsAppMessageController,
} from '../../controllers/whatsappMessages.controller';
import {
  platformWhatsAppMessagesResponseSchema,
  setWhatsAppMessageSchema,
  whatsappMessageParamSchema,
} from '../../schemas/whatsappMessages.schema';

// Mounted at /api/v1/superadmin-analytics/whatsapp-messages; applies to every clinic.
const whatsappMessagesRouter = express.Router();

/** @route GET /api/v1/superadmin-analytics/whatsapp-messages — patient WhatsApp messages, on or off for all clinics
 *  @access Super Admin */
whatsappMessagesRouter.get(
  '/',
  requireAuth,
  requireSuperAdmin,
  listWhatsAppMessagesController
);

/** @route PUT /api/v1/superadmin-analytics/whatsapp-messages/:key — turn one message on or off for all clinics
 *  @access Super Admin */
whatsappMessagesRouter.put(
  '/:key',
  requireAuth,
  requireSuperAdmin,
  validate(whatsappMessageParamSchema, 'params'),
  validate(setWhatsAppMessageSchema, 'body'),
  setWhatsAppMessageController
);

export default whatsappMessagesRouter;

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/superadmin-analytics/whatsapp-messages',
  description:
    'Patient WhatsApp messages and whether clinics may send each (Super Admin)',
  responseSchema: platformWhatsAppMessagesResponseSchema,
  tags: ['superadmin'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/superadmin-analytics/whatsapp-messages/{key}',
  description:
    'Turn one patient WhatsApp message on or off for every clinic (Super Admin)',
  params: whatsappMessageParamSchema,
  requestSchema: setWhatsAppMessageSchema,
  responseSchema: platformWhatsAppMessagesResponseSchema,
  tags: ['superadmin'],
});
