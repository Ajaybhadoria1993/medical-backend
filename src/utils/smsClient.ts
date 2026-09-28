// src/utils/smsClient.ts
import { SnsNotificationService } from '../main/notifications/services/sns.service';
import { WhatsAppService } from '../main/notifications/services/whatsapp.service';
import {
  WhatsAppTemplateKey,
  WhatsAppTemplateMessage,
  WhatsAppTemplateParams,
} from '../main/notifications/types/whatsappTemplate.types';
import {
  buildTemplateBodyParams,
  normalizeWhatsAppNumber,
  resolveTemplateName,
} from '../main/notifications/utils/whatsappTemplate.utils';
import { envConfig } from './envConfig';
import logger from './logger';

const WHATSAPP_LANGUAGE_CODE = process.env.WHATSAPP_LANGUAGE_CODE || 'en';

export async function sendSMS(to: string, body: string): Promise<void> {
  const formattedTo = to.startsWith('+') ? to : `+${to}`;

  // Apply DLT compliance routing only for Indian numbers (+91)
  if (formattedTo.startsWith('+91')) {
    let templateId: string | undefined;
    if (body.includes('admin verification code')) {
      templateId = envConfig.DLT_TEMPLATE_ADMIN_MOBILE_VERIFICATION;
    } else if (body.includes('verification code')) {
      templateId = envConfig.DLT_TEMPLATE_PATIENT_MOBILE_VERIFICATION;
    }

    await SnsNotificationService.sendTransactionalSms(
      formattedTo,
      body,
      templateId
    );
    return;
  }

  // Non-Indian international numbers routed to AWS SNS without DLT template ID
  await SnsNotificationService.sendTransactionalSms(formattedTo, body);
}

/**
 * Every business-initiated WhatsApp message goes through a pre-approved Meta
 * template with per-field placeholders — see docs/WHATSAPP_META_SETUP.md for the
 * template bodies and `whatsappTemplate.utils.ts` for the parameter order.
 *
 * There is deliberately no Direct Send fallback: Meta returns 200 + a message id
 * for Direct Send on a WABA that isn't enrolled in the beta but never delivers
 * the message, which turns every failure into a false "sent successfully" log.
 *
 * Gated by WHATSAPP_SENDING_ENABLED (defaults to off outside production).
 */
export async function sendWhatsAppTemplate<K extends WhatsAppTemplateKey>(
  to: string,
  key: K,
  params: WhatsAppTemplateParams[K]
): Promise<void> {
  if (!envConfig.WHATSAPP_SENDING_ENABLED) {
    logger.warn(
      `WhatsApp sending disabled for this environment (WHATSAPP_SENDING_ENABLED=false) — skipping "${key}" to ${to}`
    );
    return;
  }

  await WhatsAppService.sendTemplateMessage(
    normalizeWhatsAppNumber(to),
    resolveTemplateName(key),
    WHATSAPP_LANGUAGE_CODE,
    buildTemplateBodyParams(key, params)
  );
}

/**
 * Patient-facing appointment messaging. WhatsApp only.
 *
 * SMS was removed from this path deliberately. Only four DLT template ids exist
 * and all four are mobile verification (patient and admin, each with a resend);
 * appointment text went out through `sendSMS` with no template id at all. DLT
 * registration is mandatory for Indian A2P SMS, so those messages were an
 * unregistered send path rather than a working channel — and the failure was
 * swallowed by a catch-and-log, so nothing surfaced.
 *
 * WhatsApp carries this instead, through nine approved templates and the
 * outbox, which retries. If appointment SMS is wanted later, register the DLT
 * templates first; the send is the easy half.
 *
 * `body` is retained for the WhatsApp fallback log and future SMS reinstatement.
 */
export async function sendAppointmentNotification(
  mobile: string,
  body: string,
  whatsappEnabled: boolean,
  whatsappTemplate?: WhatsAppTemplateMessage
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
            enqueueWhatsAppTemplate(formattedMobile, whatsappTemplate)
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
