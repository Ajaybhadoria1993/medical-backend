import type { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { envConfig } from '../../../utils/envConfig';
import { verifyWebhookSignature } from '../../../utils/razorpay';
import { sendOk } from '../../../utils/response.utils';
import { RazorpayWebhookRouter } from '../services/razorpayWebhookRouter.service';

/** Every Razorpay webhook URL: checks the signature against either dashboard secret, then routes. */
export const razorpayWebhookController = asyncHandler(
  async (req: Request, res: Response) => {
    const signature = req.get('x-razorpay-signature');
    // Razorpay signs the exact raw bytes; re-stringifying is only a local-testing fallback.
    const stashed = (req as unknown as { rawBody?: Buffer }).rawBody;
    const raw = stashed
      ? stashed.toString('utf8')
      : Buffer.isBuffer(req.body)
        ? req.body.toString('utf8')
        : JSON.stringify(req.body);
    // Two dashboard webhooks (subscription, app) sign with their own secret until merged into one.
    const secrets = [
      envConfig.RAZORPAY_WEBHOOK_SECRET,
      envConfig.RAZORPAY_WEBHOOK_APP_SECRET,
    ].filter(Boolean);
    if (
      !signature ||
      !secrets.some((s) => verifyWebhookSignature(raw, signature, s))
    )
      throw new HttpError(400, 'Invalid signature');

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'Invalid JSON body');
    }
    await RazorpayWebhookRouter.route(body, req.get('x-razorpay-event-id'));
    return sendOk(res, 'Received', { received: true });
  }
);
