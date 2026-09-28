import crypto from 'crypto';
import { envConfig } from '../../../utils/envConfig';
import logger from '../../../utils/logger';

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
   * Outbound-only integration: we only log `failed` statuses so they're
   * visible instead of silently disappearing, same as the existing
   * catch-and-log pattern in sendAppointmentNotification.
   */
  static processDeliveryStatusPayload(body: unknown): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entries = (body as any)?.entry ?? [];
    for (const entry of entries) {
      const changes = entry?.changes ?? [];
      for (const change of changes) {
        const statuses = change?.value?.statuses ?? [];
        for (const status of statuses) {
          if (status.status === 'failed') {
            const errorDetail = status.errors?.[0]?.title || 'Unknown error';
            logger.error(
              `WhatsApp message ${status.id} to ${status.recipient_id} failed: ${errorDetail}`
            );
          }
        }
      }
    }
  }
}
