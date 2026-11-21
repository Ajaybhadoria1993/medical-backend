// src/utils/smsClient.ts
import { WhatsAppService } from '../main/notifications/services/whatsapp.service';
import {
  WhatsAppTemplateKey,
  WhatsAppTemplateMessage,
  WhatsAppTemplateParams,
} from '../main/notifications/types/whatsappTemplate.types';
import {
  buildTemplateBodyParams,
  buildTemplateUrlButtonParams,
  resolveTemplateHeaderImage,
  normalizeWhatsAppNumber,
  resolveTemplateName,
} from '../main/notifications/utils/whatsappTemplate.utils';
import { envConfig } from './envConfig';
import logger from './logger';

const WHATSAPP_LANGUAGE_CODE = process.env.WHATSAPP_LANGUAGE_CODE || 'en';

/**
 * Every business-initiated WhatsApp message goes through a pre-approved Meta
 * template with per-field placeholders — see docs/notifications/WHATSAPP_META_SETUP.md for the
 * template bodies and `whatsappTemplate.utils.ts` for the parameter order.
 *
 * There is deliberately no Direct Send fallback: Meta returns 200 + a message id
 * for Direct Send on a WABA that isn't enrolled in the beta but never delivers
 * the message, which turns every failure into a false "sent successfully" log.
 *
 * Gated by WHATSAPP_SENDING_ENABLED (defaults to off outside production).
 * Returns Meta's message id; undefined when sending is disabled, so nothing is recorded.
 */
export async function sendWhatsAppTemplate<K extends WhatsAppTemplateKey>(
  to: string,
  key: K,
  params: WhatsAppTemplateParams[K]
): Promise<string | undefined> {
  if (!envConfig.WHATSAPP_SENDING_ENABLED) {
    logger.warn(
      `WhatsApp sending disabled for this environment (WHATSAPP_SENDING_ENABLED=false) — skipping "${key}" to ${to}`
    );
    return undefined;
  }

  return WhatsAppService.sendTemplateMessage(
    normalizeWhatsAppNumber(to),
    resolveTemplateName(key),
    WHATSAPP_LANGUAGE_CODE,
    buildTemplateBodyParams(key, params),
    buildTemplateUrlButtonParams(key, params),
    resolveTemplateHeaderImage(key)
  );
}

/**
 * One-time verification codes (patient login and clinic phone verification)
 * go out on WhatsApp, through a Meta AUTHENTICATION
 * template with a "Copy code" button. Meta's API takes the code twice: as the
 * body's {{1}} and as the parameter of button 0.
 *
 * Not gated by WHATSAPP_SENDING_ENABLED: that switch stops staging from
 * messaging real patients, while an OTP only goes to the number that asked
 * for it, and OTP_BYPASS_ENABLED already decides whether one is sent at all.
 * Throws on failure, so callers can return 502 and discard the unsent code.
 */
export async function sendWhatsAppOtp(to: string, code: string): Promise<void> {
  await WhatsAppService.sendTemplateMessage(
    normalizeWhatsAppNumber(to),
    process.env.WHATSAPP_TEMPLATE_OTP || 'otp_verification',
    WHATSAPP_LANGUAGE_CODE,
    [code],
    [code]
  );
}

/** Patient-facing appointment messaging, WhatsApp only, queued through the retrying outbox; `body` is unused and kept for callers. */
export async function sendAppointmentNotification(
  mobile: string,
  body: string,
  whatsappEnabled: boolean,
  whatsappTemplate?: WhatsAppTemplateMessage,
  /** The clinic the message is counted against. */
  clinicId?: string
): Promise<void> {
  const promises = [];

  const formattedMobile = normalizeWhatsAppNumber(mobile);

  if (whatsappEnabled || envConfig.WHATSAPP_FORCE_ENABLED) {
    if (whatsappTemplate) {
      promises.push(
        // Dynamic import breaks the cycle: the outbox worker calls back into
        // sendWhatsAppTemplate below.
        import('../main/notifications/queues/whatsappOutbox.queue').then(
          ({ enqueueWhatsAppTemplate }) =>
            enqueueWhatsAppTemplate(formattedMobile, whatsappTemplate, {
              clinicId: clinicId ?? null,
            })
        )
      );
    } else {
      logger.error(
        `WhatsApp is enabled for ${formattedMobile} but no template was supplied — message not sent`
      );
    }
  }

  if (promises.length > 0) {
    await Promise.allSettled(promises);
  }
}
