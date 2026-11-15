import type { WhatsAppTemplateKey } from '../types/whatsappTemplate.types';

/** Patient messages a clinic Admin may switch off; lab and pharmacy wait for their split. */
export const CLINIC_WHATSAPP_MESSAGES = [
  { key: 'appointmentBooked', label: 'Booking Confirmation' },
  { key: 'appointmentReminder', label: 'Reminders' },
  { key: 'appointmentCompleted', label: 'Feedback After Visit' },
  { key: 'appointmentFollowUp', label: 'Follow-Up' },
  { key: 'appointmentCancelled', label: 'Appointment Cancelled' },
  { key: 'consultationStarted', label: 'Consultation Started' },
] as const satisfies readonly { key: WhatsAppTemplateKey; label: string }[];

export type ClinicWhatsAppMessageKey =
  (typeof CLINIC_WHATSAPP_MESSAGES)[number]['key'];

export const CLINIC_WHATSAPP_MESSAGE_KEYS = CLINIC_WHATSAPP_MESSAGES.map(
  (m) => m.key
) as [ClinicWhatsAppMessageKey, ...ClinicWhatsAppMessageKey[]];

export function isClinicWhatsAppMessage(
  key: string
): key is ClinicWhatsAppMessageKey {
  return (CLINIC_WHATSAPP_MESSAGE_KEYS as readonly string[]).includes(key);
}
