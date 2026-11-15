import type { WhatsAppTemplateKey } from './whatsappTemplate.types';

/** Only messages turned off are stored; a missing key means the message is on. */
export type WhatsAppMessageOverrides = Partial<
  Record<WhatsAppTemplateKey, boolean>
>;

export type WhatsAppMessageOwnerType = 'clinic' | 'lab' | 'pharmacy';
