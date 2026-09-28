import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { WhatsAppWebhookService } from '../services/whatsappWebhook.service';

/**
 * GET /api/v1/notifications/whatsapp-webhook
 * Meta's one-time webhook verification handshake. Must echo back the raw
 * `hub.challenge` value as plain text (not the standard JSON envelope) —
 * this is a required exception to the sendOk/HttpError convention, same as
 * the Razorpay webhook, since the response contract is dictated by Meta.
 */
export const verifyWhatsappWebhookHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const challenge = WhatsAppWebhookService.verifyHandshake(
      req.query['hub.mode'],
      req.query['hub.verify_token'],
      req.query['hub.challenge']
    );

    if (challenge === null) {
      throw new HttpError(403, 'Invalid WhatsApp webhook verification token');
    }

    res.status(200).send(challenge);
  }
);

/**
 * POST /api/v1/notifications/whatsapp-webhook
 * Delivery-status/error callbacks from Meta (sent/delivered/read/failed).
 */
export const receiveWhatsappWebhookHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;

    if (!WhatsAppWebhookService.verifySignature(rawBody, signature)) {
      throw new HttpError(401, 'Invalid WhatsApp webhook signature');
    }

    WhatsAppWebhookService.processDeliveryStatusPayload(req.body);

    return sendOk(res, 'WhatsApp webhook processed');
  }
);
