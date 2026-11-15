import type { PlatformWhatsAppMessage } from '../types/whatsappMessages.types';

/** Patient WhatsApp messages Super Admin can turn off for every clinic; owned by notifications. */
export interface WhatsAppMessagesPort {
  list(): Promise<PlatformWhatsAppMessage[]>;
  /** Null when `key` is not a message clinics send. */
  setEnabled(
    key: string,
    enabled: boolean,
    changedBy: string
  ): Promise<PlatformWhatsAppMessage[] | null>;
}
