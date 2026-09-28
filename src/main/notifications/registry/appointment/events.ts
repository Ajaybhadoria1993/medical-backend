/**
 * Appointment events — policy, not copy. Recipients resolve through staff
 * scope rather than the old clinic-wide fan-out, which is user-visible and so
 * ships behind NOTIFY_STRICT_RECIPIENTS_APPOINTMENT.
 */

import { PERMISSION_KEYS } from '../../../permissions/utils/permission.constants';
import type { DirectoryPort } from '../../ports';
import { defineEvents } from '../defineEvents';
import { appointmentMessages, type AppointmentCopyCtx } from './messages';
import { formatSchedule } from './schedule';
import {
  appointmentPatient,
  appointmentStaff,
  appointmentStaffExcludingReception,
} from './recipients';

const STAFF_ROLES = ['Admin', 'Doctor', 'Receptionist'];
/** Status changes skip reception — see appointmentStaffExcludingReception. */
const STAFF_ROLES_NO_RECEPTION = ['Admin', 'Doctor'];
const PATIENT_ROLES = ['Patient'];

/** Every appointment notification opens the appointment it is about. */
const openAppointment = (ctx: AppointmentCopyCtx) => ({
  route: '/appointment/:id',
  params: { id: ctx.appointmentId },
});

const clinicTenant = (ctx: AppointmentCopyCtx) =>
  ({ type: 'clinic', id: ctx.clinicId }) as const;

/** Names resolved at delivery, so a late reminder renders the current doctor. */
const withParticipantNames = async (
  ctx: AppointmentCopyCtx,
  { directory }: { directory: DirectoryPort }
): Promise<Partial<AppointmentCopyCtx>> => {
  // Skip the lookup when the caller already supplied everything the copy reads.
  // Callers hold most of this at the point they fire the event, and their values
  // win the merge anyway, so querying would cost a join to discard the result.
  if (ctx.patientName && ctx.doctorName && ctx.clinicName && ctx.when) {
    return {};
  }

  const info = await directory.getAppointmentContext(ctx.appointmentId);
  if (!info) return {};
  return {
    patientName: info.patientName,
    doctorName: info.doctorName,
    clinicName: info.clinicName ?? undefined,
    when: formatSchedule(info),
  };
};

/** One appointment's whole life is one inbox row, not one per state change. */
const oneRowPerAppointment = (ctx: AppointmentCopyCtx) =>
  `appointment:${ctx.appointmentId}`;

const staffAudience = (
  message: (ctx: AppointmentCopyCtx) => { title: string; body: string }
) => ({
  key: 'staff',
  roles: STAFF_ROLES,
  requiredPermission: PERMISSION_KEYS.APPOINTMENT_VIEW,
  // The treating doctor always sees notifications about their own
  // appointment — same exemption the route itself grants Doctor
  // (see requirePermission(APPOINTMENT_VIEW, ['Receptionist'])).
  permissionExempt: (ctx: AppointmentCopyCtx) => [ctx.doctorId],
  recipients: appointmentStaff,
  message: { inApp: message },
});

/**
 * Same audience, minus reception. For status changes reception itself performs
 * (confirming, rescheduling), where an inbox row restates what they just did.
 * Cancellations and no-shows keep the full audience: reception has to act on
 * those.
 */
const staffAudienceExcludingReception = (
  message: (ctx: AppointmentCopyCtx) => { title: string; body: string }
) => ({
  ...staffAudience(message),
  roles: STAFF_ROLES_NO_RECEPTION,
  recipients: appointmentStaffExcludingReception,
});

/**
 * No required permission: a patient reading about their own appointment holds
 * no clinic permission at all, and filtering them through one would silently
 * drop every patient notification.
 */
const patientAudience = (
  message: (ctx: AppointmentCopyCtx) => { title: string; body: string }
) => ({
  key: 'patient',
  roles: PATIENT_ROLES,
  recipients: appointmentPatient,
  message: { inApp: message },
});

export const appointmentEvents = defineEvents({
  'appointment.created': {
    aliases: ['appointment_created'],
    label: 'Appointment Created',
    description: 'When a new appointment is booked.',
    category: 'appointments',
    priority: 'normal',
    kind: 'notification',
    configurable: true,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push'],
    tenant: clinicTenant,
    enrich: withParticipantNames,
    collapseKey: oneRowPerAppointment,
    clickAction: openAppointment,
    audiences: [
      staffAudience(appointmentMessages.staff.created),
      patientAudience(appointmentMessages.patient.created),
    ],
  },

  'appointment.rescheduled': {
    aliases: ['appointment_rescheduled', 'rescheduled'],
    label: 'Appointment Rescheduled',
    description: 'When an appointment time is updated.',
    category: 'appointments',
    priority: 'action_required',
    kind: 'notification',
    configurable: true,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push'],
    tenant: clinicTenant,
    enrich: withParticipantNames,
    collapseKey: oneRowPerAppointment,
    clickAction: openAppointment,
    audiences: [
      staffAudienceExcludingReception(appointmentMessages.staff.rescheduled),
      patientAudience(appointmentMessages.patient.rescheduled),
    ],
  },

  'appointment.confirmed': {
    aliases: ['appointment_confirmed'],
    label: 'Appointment Confirmed',
    description: 'When an appointment is confirmed.',
    category: 'appointments',
    priority: 'normal',
    kind: 'notification',
    configurable: true,
    // Off for staff by default: whoever confirmed it already knows, and the
    // clinic sees the state on the appointment itself. The patient is the one
    // party who genuinely learns something from a confirmation, so they keep
    // both channels. Staff can still opt back in.
    defaults: { inApp: false, push: false },
    roleDefaults: { Patient: { inApp: true, push: true } },
    channels: ['inApp', 'push'],
    tenant: clinicTenant,
    enrich: withParticipantNames,
    collapseKey: oneRowPerAppointment,
    clickAction: openAppointment,
    audiences: [
      staffAudienceExcludingReception(appointmentMessages.staff.confirmed),
      patientAudience(appointmentMessages.patient.confirmed),
    ],
  },

  'appointment.cancelled': {
    aliases: ['appointment_canceled'],
    label: 'Appointment Canceled',
    description: 'When an appointment is canceled.',
    category: 'appointments',
    priority: 'action_required',
    kind: 'notification',
    // Non-configurable: a cancellation frees a slot and strands a patient.
    // Nobody involved may opt out of hearing about it.
    configurable: false,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push'],
    tenant: clinicTenant,
    enrich: withParticipantNames,
    collapseKey: oneRowPerAppointment,
    clickAction: openAppointment,
    audiences: [
      staffAudience(appointmentMessages.staff.cancelled),
      patientAudience(appointmentMessages.patient.cancelled),
    ],
  },

  'appointment.no_show': {
    aliases: ['appointment_no_show'],
    label: 'Appointment No-Show',
    description: "When a patient doesn't show up.",
    category: 'appointments',
    priority: 'action_required',
    kind: 'notification',
    configurable: false,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push'],
    tenant: clinicTenant,
    enrich: withParticipantNames,
    collapseKey: oneRowPerAppointment,
    clickAction: openAppointment,
    // Staff only. The patient is told over SMS/WhatsApp by the no-show flow,
    // and telling them in-app that they failed to attend serves no purpose.
    audiences: [staffAudience(appointmentMessages.staff.noShow)],
  },
});
