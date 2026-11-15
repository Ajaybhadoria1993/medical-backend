import { IST_TIMEZONE } from '../../../utils/istDateTime';
import {
  WhatsAppTemplateDefinition,
  WhatsAppTemplateKey,
  WhatsAppTemplateParams,
} from '../types/whatsappTemplate.types';

const MAX_PARAM_LENGTH = 1024;

// The *_utility_v1 bodies already say "Dr. {{n}}" and "Token No.: {{n}}".
const bareDoctor = (name: string) => name.replace(/^dr\.?\s+/i, '');
const bareToken = (timeOrToken: string) =>
  timeOrToken.replace(/^Token No:\s*/, '');

export const WHATSAPP_TEMPLATES: {
  [K in WhatsAppTemplateKey]: WhatsAppTemplateDefinition<K>;
} = {
  appointmentBooked: {
    envVar: 'WHATSAPP_TEMPLATE_APPOINTMENT_BOOKED',
    defaultName: 'appointment_booked_utility_v1',
    headerImageEnvVar: 'WHATSAPP_APPOINTMENT_BOOKED_HEADER_IMAGE_URL',
    toBodyParams: (p) => [
      p.patientName,
      bareDoctor(p.doctorName),
      p.clinicName,
      p.date,
      bareToken(p.timeOrToken),
    ],
    // Button 0 "Track Token Status"; button 1 "Download App" is a static URL.
    toUrlButtonParams: (p) => [`${p.appointmentId}?type=livequeue`],
  },
  appointmentReminder: {
    envVar: 'WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER',
    defaultName: 'appointment_reminder_utility_v1',
    headerImageEnvVar: 'WHATSAPP_APPOINTMENT_REMINDER_HEADER_IMAGE_URL',
    toBodyParams: (p) => [
      p.patientName,
      bareDoctor(p.doctorName),
      p.clinicName,
      p.date,
      bareToken(p.timeOrToken),
    ],
    // Button 0 "Track Token Status".
    toUrlButtonParams: (p) => [`${p.appointmentId}?type=livequeue`],
  },
  appointmentCancelled: {
    envVar: 'WHATSAPP_TEMPLATE_APPOINTMENT_CANCELLED',
    defaultName: 'appointment_cancelled_utility_v1',
    headerImageEnvVar: 'WHATSAPP_APPOINTMENT_CANCELLED_HEADER_IMAGE_URL',
    toBodyParams: (p) => [
      p.patientName,
      bareDoctor(p.doctorName),
      p.clinicName,
      p.date,
      bareToken(p.timeOrToken),
    ],
    // Button 0 "Reschedule Appointment"; button 1 "Open MediArogya" is static.
    toUrlButtonParams: (p) => [p.appointmentId],
  },
  consultationStarted: {
    envVar: 'WHATSAPP_TEMPLATE_CONSULTATION_STARTED',
    defaultName: 'consultation_started_utility_v1',
    headerImageEnvVar: 'WHATSAPP_CONSULTATION_STARTED_HEADER_IMAGE_URL',
    // Its one button, "Open MediArogya", is static.
    toBodyParams: (p) => [
      p.patientName,
      bareDoctor(p.doctorName),
      p.clinicName,
    ],
  },
  doctorRunningLate: {
    envVar: 'WHATSAPP_TEMPLATE_DOCTOR_RUNNING_LATE',
    defaultName: 'doctor_running_late_utility_v1',
    headerImageEnvVar: 'WHATSAPP_DOCTOR_RUNNING_LATE_HEADER_IMAGE_URL',
    toBodyParams: (p) => [
      p.patientName,
      bareDoctor(p.doctorName),
      p.clinicName,
      bareToken(p.timeOrToken),
    ],
    // Button 0 "Track Token Status".
    toUrlButtonParams: (p) => [`${p.appointmentId}?type=livequeue`],
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
    defaultName: 'appointment_completed_utility_v1',
    headerImageEnvVar: 'WHATSAPP_APPOINTMENT_COMPLETED_HEADER_IMAGE_URL',
    toBodyParams: (p) => [
      p.patientName,
      bareDoctor(p.doctorName),
      p.clinicName,
    ],
    // Button 0 "View Prescription" (…/patient/appointments/{{1}}); button 1 is static.
    toUrlButtonParams: (p) => [`${p.appointmentId}/pdf`],
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

export function buildTemplateUrlButtonParams<K extends WhatsAppTemplateKey>(
  key: K,
  params: WhatsAppTemplateParams[K]
): string[] {
  const definition = WHATSAPP_TEMPLATES[key] as WhatsAppTemplateDefinition<K>;
  return (definition.toUrlButtonParams?.(params) ?? []).map(
    sanitizeTemplateParam
  );
}

export function resolveTemplateHeaderImage(
  key: WhatsAppTemplateKey
): string | undefined {
  const envVar = WHATSAPP_TEMPLATES[key].headerImageEnvVar;
  return envVar ? process.env[envVar] || undefined : undefined;
}

/** Header-image env vars that are unset; Meta rejects every send of those templates (132012). */
export function missingTemplateHeaderImages(): string[] {
  return Object.values(WHATSAPP_TEMPLATES)
    .map((d) => d.headerImageEnvVar)
    .filter((v): v is string => !!v && !process.env[v]);
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
