import axios from 'axios';
import { envConfig } from '../../../utils/envConfig';
import logger from '../../../utils/logger';

export interface WhatsAppTemplateComponent {
  type: 'body';
  parameters: Array<{ type: 'text'; text: string }>;
}

/**
 * Bounded so a hung Meta connection can't stall the caller indefinitely —
 * axios has no default timeout, and some sends run inside a DB transaction.
 */
const REQUEST_TIMEOUT_MS = 10_000;

export class WhatsAppService {
  private static endpoint(): string {
    return `https://graph.facebook.com/${envConfig.WHATSAPP_API_VERSION}/${envConfig.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  }

  private static authHeaders() {
    return {
      Authorization: `Bearer ${envConfig.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Catches the most common "no message ever arrives" cause: missing/empty
   * env vars, which otherwise fail deep inside axios with a confusing
   * ".../undefined/messages" 401/404 instead of a clear config error.
   */
  private static assertConfigured(): void {
    const missing: string[] = [];
    if (!envConfig.WHATSAPP_PHONE_NUMBER_ID)
      missing.push('WHATSAPP_PHONE_NUMBER_ID');
    if (!envConfig.WHATSAPP_ACCESS_TOKEN) missing.push('WHATSAPP_ACCESS_TOKEN');

    if (missing.length > 0) {
      logger.error(
        `WhatsApp send skipped: missing required env var(s): ${missing.join(', ')}`
      );
      throw new Error(
        `WhatsApp is not configured — missing ${missing.join(', ')}`
      );
    }
  }

  /**
   * Sends a pre-approved template message via the Meta WhatsApp Business Cloud API.
   * Business-initiated messages must use an approved template — free-form text
   * is only permitted within an open 24h customer-service session, which this
   * outbound-only integration does not track.
   */
  static async sendTemplateMessage(
    to: string,
    templateName: string,
    languageCode: string,
    bodyParams: string[]
  ): Promise<void> {
    const components: WhatsAppTemplateComponent[] = bodyParams.length
      ? [
          {
            type: 'body',
            parameters: bodyParams.map((text) => ({ type: 'text', text })),
          },
        ]
      : [];

    const payload = {
      messaging_product: 'whatsapp',
      to: to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    };

    this.assertConfigured();

    try {
      const response = await axios.post(this.endpoint(), payload, {
        headers: this.authHeaders(),
        timeout: REQUEST_TIMEOUT_MS,
      });
      const messageId = response.data?.messages?.[0]?.id;
      logger.info(
        `WhatsApp template "${templateName}" sent to ${to} successfully — message id: ${messageId}`
      );
    } catch (err) {
      const details = axios.isAxiosError(err)
        ? JSON.stringify(err.response?.data)
        : (err as Error).message;
      logger.error(
        `Failed to send WhatsApp template "${templateName}" to ${to}: ${details}`
      );
      throw err;
    }
  }
}
