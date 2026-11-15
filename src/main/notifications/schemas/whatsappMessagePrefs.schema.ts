import { z } from 'zod';
import { CLINIC_WHATSAPP_MESSAGE_KEYS } from '../utils/whatsappMessagePrefs.utils';

// Partial: messages Super Admin turned off are hidden from the clinic, so they aren't sent.
export const saveWhatsAppMessagesSchema = z
  .object({
    messages: z.partialRecord(
      z.enum(CLINIC_WHATSAPP_MESSAGE_KEYS),
      z.boolean()
    ),
  })
  .strict();

export type SaveWhatsAppMessagesBody = z.infer<
  typeof saveWhatsAppMessagesSchema
>;

export const whatsAppMessagesResponseSchema = z.object({
  messages: z.array(
    z.object({
      key: z.enum(CLINIC_WHATSAPP_MESSAGE_KEYS),
      label: z.string(),
      enabled: z.boolean(),
    })
  ),
});
