/**
 * Queue events. No patient audience — the patient is standing in front of the
 * person being notified.
 */

import { PERMISSION_KEYS } from '../../../permissions/utils/permission.constants';
import type { DirectoryPort } from '../../ports';
import { defineEvents } from '../defineEvents';
import type { AppointmentCopyCtx } from './messages';
import { appointmentStaff, type AppointmentCtx } from './recipients';

const clinicTenant = (ctx: AppointmentCtx) =>
  ({ type: 'clinic', id: ctx.clinicId }) as const;

const withParticipantNames = async (
  ctx: AppointmentCopyCtx,
  { directory }: { directory: DirectoryPort }
): Promise<Partial<AppointmentCopyCtx>> => {
  const info = await directory.getAppointmentContext(ctx.appointmentId);
  if (!info) return {};
  return {
    patientName: info.patientName,
    doctorName: info.doctorName,
    clinicName: info.clinicName ?? undefined,
  };
};

export const queueEvents = defineEvents({
  'consultation.completed': {
    label: 'Consultation Completed',
    description: 'When a doctor finishes a consultation.',
    category: 'appointments',
    /*
     * `normal`, not `action_required`. Finishing a consultation is something
     * reception should know about, but it is not itself a task: the work that
     * follows (payment, a follow-up booking) is tracked on the appointment,
     * not here. As `action_required` every completed consultation took a
     * permanent slot in the triage tab and never left it, because priority is
     * a property of the event type rather than of this one occurrence — so the
     * tab filled with rows for work that had long since been done and staff
     * stopped trusting the count.
     */
    priority: 'normal',
    kind: 'notification',
    configurable: true,
    // Off by default: the patient physically walks back to the desk, so this
    // was one inbox row per consultation telling reception something they were
    // about to see anyway. Still available for clinics whose desk is out of
    // sight of the consultation rooms — they can turn it back on.
    defaults: { inApp: false, push: false },
    channels: ['inApp'],
    tenant: clinicTenant,
    enrich: withParticipantNames,
    clickAction: (ctx: AppointmentCopyCtx) => ({
      route: '/appointment/:id',
      params: { id: ctx.appointmentId },
    }),
    audiences: [
      {
        key: 'staff',
        // Reception is the point of this event: the patient is about to walk
        // back out to the desk for payment, follow-up or a next appointment.
        // The doctor who just finished is excluded as the performer.
        roles: ['Admin', 'Receptionist'],
        requiredPermission: PERMISSION_KEYS.APPOINTMENT_VIEW,
        recipients: appointmentStaff,
        message: {
          inApp: (p: AppointmentCopyCtx) => ({
            title: `Consultation done – ${p.patientName}`,
            body: `${p.doctorName} has finished. The patient is on their way back to the desk.`,
          }),
        },
      },
    ],
  },
});
