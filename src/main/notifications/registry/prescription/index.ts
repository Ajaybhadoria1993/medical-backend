/**
 * Prescription events.
 *
 * Only the patient-facing "ready" event moves across here. Two others are
 * handled deliberately elsewhere:
 *
 * - `pdf_generation_started` is not registered at all. It tells the patient a
 *   file is being prepared, which they can neither act on nor care about, and
 *   the §3 relevance test says an event with no action should not be a
 *   notification. It is removed rather than migrated.
 * - `prescription.completed` -> receptionist is a new event, not an existing
 *   one, so it belongs to Phase 4 along with the queue advance it triggers.
 *
 * The old flow also emitted to an `appointment:<id>` socket room that nothing
 * ever joins, so that broadcast has been dead. Patients get the PDF through
 * their own user room, which is why nobody noticed.
 */

import { defineEvents } from '../defineEvents';
import { doctorOf } from '../appointment/messages';
import { formatSchedule } from '../appointment/schedule';
import type { RecipientDeps } from '../types';

export interface PrescriptionCtx extends Record<string, unknown> {
  appointmentId: string;
  clinicId?: string;
  patientId: string;
  reportId: string;
  pdfUrl?: string;
  doctorName?: string;
  clinicName?: string;
  when?: string;
}

/** The PDF-ready call site knows only ids; the push has to say whose
 *  prescription, from which visit. */
async function withVisit(
  ctx: PrescriptionCtx,
  { directory }: RecipientDeps
): Promise<Partial<PrescriptionCtx>> {
  const info = await directory.getAppointmentContext(ctx.appointmentId);
  if (!info) return {};
  return {
    doctorName: info.doctorName,
    clinicName: info.clinicName ?? undefined,
    when: formatSchedule(info),
  };
}

export const prescriptionEvents = defineEvents({
  'prescription.ready': {
    aliases: ['pdf_ready', 'prescription_pdf_ready'],
    label: 'Prescription Ready',
    description: 'When your prescription PDF is available.',
    category: 'prescription',
    priority: 'normal',
    kind: 'notification',
    configurable: true,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push'],
    // The PDF-ready call site knows the report and the appointment but not the
    // clinic. Null tenant is legal — it costs a filter, not a delivery.
    tenant: (ctx: PrescriptionCtx) =>
      ctx.clinicId ? { type: 'clinic' as const, id: ctx.clinicId } : null,
    enrich: withVisit,
    collapseKey: (ctx: PrescriptionCtx) => `prescription:${ctx.reportId}`,
    clickAction: (ctx: PrescriptionCtx) => ({
      route: '/appointment/:id',
      params: { id: ctx.appointmentId },
    }),
    audiences: [
      {
        key: 'patient',
        roles: ['Patient'],
        recipients: (ctx: PrescriptionCtx) => [ctx.patientId],
        message: {
          inApp: (ctx: PrescriptionCtx) => ({
            title: `Prescription from ${doctorOf(ctx)}`,
            body: `From your visit to ${ctx.clinicName || 'the clinic'}${
              ctx.when ? ` on ${ctx.when}` : ''
            }. Tap to view or download.`,
          }),
        },
      },
    ],
  },
});
