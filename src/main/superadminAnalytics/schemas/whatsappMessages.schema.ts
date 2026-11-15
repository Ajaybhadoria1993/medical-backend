import { z } from 'zod';

// The key is checked against the notifications list by the adapter (404 when unknown).
export const whatsappMessageParamSchema = z.object({
  key: z.string().trim().min(1).max(64),
});

export const setWhatsAppMessageSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export type SetWhatsAppMessageBody = z.infer<typeof setWhatsAppMessageSchema>;

export const platformWhatsAppMessagesResponseSchema = z.object({
  messages: z.array(
    z.object({ key: z.string(), label: z.string(), enabled: z.boolean() })
  ),
});
