// src/main/notifications/routes/v1/whatsappWebhook.route.ts
import { Router } from 'express';
import { docsRegistry } from '../../../../utils/docsRegistry';
import {
  verifyWhatsappWebhookHandler,
  receiveWhatsappWebhookHandler,
} from '../../controllers/whatsappWebhook.controller';

const router = Router();

router.get('/', verifyWhatsappWebhookHandler);
router.post('/', receiveWhatsappWebhookHandler);

export default router;

// ─── API Docs ─────────────────────────────────────────────────────────────────

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/notifications/whatsapp-webhook',
  description:
    "Meta's webhook verification handshake (hub.mode/hub.verify_token/hub.challenge)",
  tags: ['notifications', 'whatsapp'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/notifications/whatsapp-webhook',
  description:
    'Receives WhatsApp delivery-status callbacks (sent/delivered/read/failed) from Meta',
  tags: ['notifications', 'whatsapp'],
});
