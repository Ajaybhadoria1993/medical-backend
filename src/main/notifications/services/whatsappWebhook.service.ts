import crypto from 'crypto';
import { envConfig } from '../../../utils/envConfig';
import logger from '../../../utils/logger';
import { recordDeliveryStatus } from '../../credits';

export class WhatsAppWebhookService {
  /**
   * Validates Meta's one-time webhook verification handshake.
   * Returns the challenge to echo back if valid, otherwise null.
   */
  static verifyHandshake(
    mode: unknown,
    token: unknown,
    challenge: unknown
  ): string | null {
    if (
      mode === 'subscribe' &&
      token === envConfig.WHATSAPP_WEBHOOK_VERIFY_TOKEN
    ) {
      return String(challenge);
    }
    return null;
  }

  /**
   * Verifies the X-Hub-Signature-256 header against the raw request body,
   * rejecting spoofed webhook calls before any payload is trusted.
   */
  static verifySignature(
    rawBody: Buffer | undefined,
    signature: string | undefined
  ): boolean {
    if (!rawBody || !signature || !signature.startsWith('sha256=')) {
      return false;
    }

    const appSecret = envConfig.WHATSAPP_APP_SECRET;
    if (!appSecret) return false;

    const expected = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

    const provided = signature.replace('sha256=', '');
    return (
      expected.length === provided.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
    );
  }

  /**
   * Processes delivery-status/error callbacks (sent/delivered/read/failed).
   * Logs failures and hands every status to the credits module for cost and
   * give-backs. Not awaited: Meta retries anything that is not a fast 200.
   */
  static processDeliveryStatusPayload(body: unknown): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entries = (body as any)?.entry ?? [];
    for (const entry of entries) {
      const changes = entry?.changes ?? [];
      for (const change of changes) {
        const statuses = change?.value?.statuses ?? [];
        for (const status of statuses) {
          if (typeof status?.id !== 'string') continue;

          if (status.status === 'failed') {
            const errorDetail = status.errors?.[0]?.title || 'Unknown error';
            // No recipient_id: it is the patient's phone number (BE §11).
            logger.error(
              `WhatsApp message ${status.id} failed: ${errorDetail}`
            );
          }

          const billable = status.pricing?.billable;
          void recordDeliveryStatus({
            messageId: status.id,
            status: String(status.status),
            billable: typeof billable === 'boolean' ? billable : undefined,
          });
        }
      }
    }
  }
}
