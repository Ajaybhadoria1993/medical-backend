import { IST_TIMEZONE } from '../../../utils/istDateTime';
import {
  WhatsAppTemplateDefinition,
  WhatsAppTemplateKey,
  WhatsAppTemplateParams,
} from '../types/whatsappTemplate.types';

const MAX_PARAM_LENGTH = 1024;

export const WHATSAPP_TEMPLATES: {
  [K in WhatsAppTemplateKey]: WhatsAppTemplateDefinition<K>;
} = {
  appointmentBooked: {
    envVar: 'WHATSAPP_TEMPLATE_APPOINTMENT_BOOKED',
    defaultName: 'appointment_booked',
    toBodyParams: (p) => [
      p.patientName,
      p.doctorName,
      p.clinicName,
      p.date,
      p.timeOrToken,
    ],
  },
  appointmentReminder: {
    envVar: 'WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER',
    defaultName: 'appointment_reminder',
    toBodyParams: (p) => [
      p.patientName,
      p.doctorName,
      p.clinicName,
      p.date,
      p.timeOrToken,
    ],
  },
  appointmentRescheduled: {
    envVar: 'WHATSAPP_TEMPLATE_APPOINTMENT_RESCHEDULED',
    defaultName: 'appointment_rescheduled',
    toBodyParams: (p) => [
      p.patientName,
      p.doctorName,
      p.clinicName,
      p.date,
      p.timeOrToken,
    ],
  },
  appointmentNoShow: {
    envVar: 'WHATSAPP_TEMPLATE_APPOINTMENT_NO_SHOW',
    defaultName: 'appointment_no_show',
    toBodyParams: (p) => [
      p.patientName,
      p.doctorName,
      p.clinicName,
      p.actionTaken,
      p.reason,
    ],
  },
  appointmentCompleted: {
    envVar: 'WHATSAPP_TEMPLATE_APPOINTMENT_COMPLETED',
    defaultName: 'appointment_completed',
    toBodyParams: (p) => [p.patientName, p.doctorName, p.clinicName],
  },
  appointmentFollowUp: {
    envVar: 'WHATSAPP_TEMPLATE_APPOINTMENT_FOLLOWUP',
    defaultName: 'appointment_followup',
    toBodyParams: (p) => [
      p.patientName,
      p.doctorName,
      p.clinicName,
      p.followUpDate,
    ],
  },
  labReportReady: {
    envVar: 'WHATSAPP_TEMPLATE_LAB_REPORT_READY',
    defaultName: 'lab_report_ready',
    toBodyParams: (p) => [p.patientName, p.testName, p.labName, p.reportUrl],
  },
  labPaymentReceived: {
    envVar: 'WHATSAPP_TEMPLATE_LAB_PAYMENT_RECEIVED',
    defaultName: 'lab_payment_received',
    toBodyParams: (p) => [
      p.patientName,
      p.amount,
      p.testName,
      p.labName,
      p.invoiceNumber,
    ],
  },
  pharmacyInvoice: {
    envVar: 'WHATSAPP_TEMPLATE_PHARMACY_INVOICE',
    defaultName: 'pharmacy_invoice',
    toBodyParams: (p) => [p.customerName, p.pharmacyName, p.invoiceUrl],
  },
};

/**
 * Meta rejects template parameters that contain newlines, tabs or 4+ consecutive
 * spaces (error 132000) and rejects empty ones, so every value is flattened to a
 * single line before it reaches the Cloud API. This is why template params must
 * be individual fields rather than a pre-formatted multi-line message body.
 */
export function sanitizeTemplateParam(value: string): string {
  const flattened = value.replace(/\s+/g, ' ').trim();
  return (flattened || '-').slice(0, MAX_PARAM_LENGTH);
}

export function resolveTemplateName(key: WhatsAppTemplateKey): string {
  const definition = WHATSAPP_TEMPLATES[key];
  return process.env[definition.envVar] || definition.defaultName;
}

export function buildTemplateBodyParams<K extends WhatsAppTemplateKey>(
  key: K,
  params: WhatsAppTemplateParams[K]
): string[] {
  const definition = WHATSAPP_TEMPLATES[key] as WhatsAppTemplateDefinition<K>;
  return definition.toBodyParams(params).map(sanitizeTemplateParam);
}

export function normalizeWhatsAppNumber(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');

  if (mobile.trim().startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0'))
    return `+91${digits.slice(1)}`;

  return `+${digits}`;
}

export function formatAppointmentDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    timeZone: IST_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatAppointmentTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    timeZone: IST_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatTimeOrToken(date: Date, tokenNo?: number | null): string {
  return tokenNo
    ? `Token No: ${tokenNo}`
    : `Time: ${formatAppointmentTime(date)}`;
}
