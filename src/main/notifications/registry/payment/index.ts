/**
 * Payment events.
 *
 * The staff audience is new. Today only the patient is told a payment landed,
 * which is exactly the gap that lets a second receptionist believe a patient
 * still owes money and collect it twice. Reception sees the amount and who it
 * was for, and the notification opens the appointment's payment detail.
 *
 * Note this is only half of the fix — the other half is the realtime bus
 * updating the payment badge on screens nobody is looking away from. The
 * notification tells the person who needs to act; the bus stops the stale
 * number that caused the confusion in the first place.
 */

import { PERMISSION_KEYS } from '../../../permissions/utils/permission.constants';
import { defineEvents } from '../defineEvents';
import { doctorOf } from '../appointment/messages';
import { formatSchedule } from '../appointment/schedule';
import type { RecipientDeps } from '../types';

export interface PaymentCtx extends Record<string, unknown> {
  appointmentId: string;
  clinicId?: string;
  doctorId: string | null;
  patientId: string | null;
  /** Formatted for display, not a number — copy must not re-round a currency. */
  amount: string;
  patientName?: string;
  clinicName?: string;
  doctorName?: string;
  when?: string;
  performerUserId?: string | null;
}

/** The call site knows only ids and the amount; the copy says what was paid for. */
async function withAppointment(
  ctx: PaymentCtx,
  { directory }: RecipientDeps
): Promise<Partial<PaymentCtx>> {
  const info = await directory.getAppointmentContext(ctx.appointmentId);
  if (!info) return {};
  return {
    patientName: info.patientName,
    doctorName: info.doctorName,
    clinicName: info.clinicName ?? undefined,
    when: formatSchedule(info),
  };
}

async function paymentStaff(
  ctx: PaymentCtx,
  { directory }: RecipientDeps
): Promise<string[]> {
  if (!ctx.clinicId) return [];
  const staff = await directory.getStaffResponsibleForDoctor(
    ctx.clinicId,
    ctx.doctorId
  );
  return staff.map((s) => s.id).filter((id) => id !== ctx.performerUserId);
}

function paymentPatient(ctx: PaymentCtx): string[] {
  return ctx.patientId ? [ctx.patientId] : [];
}

export const paymentEvents = defineEvents({
  'payment.received': {
    aliases: ['payment_received'],
    label: 'Payment Received',
    description: 'When an invoice is paid.',
    category: 'payments',
    priority: 'normal',
    kind: 'notification',
    // Non-configurable: money moving is not something a clinic may opt out of
    // hearing about, and the patient's receipt is their record of it.
    configurable: false,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push'],
    // clinicId is optional at some call sites; a null tenant only costs the
    // per-clinic filter, and the staff audience is skipped without one because
    // a permission check needs a clinic to check against.
    tenant: (ctx: PaymentCtx) =>
      ctx.clinicId ? { type: 'clinic' as const, id: ctx.clinicId } : null,
    enrich: withAppointment,
    // Payment state for one appointment is one row, however many times it moves.
    collapseKey: (ctx: PaymentCtx) => `payment:${ctx.appointmentId}`,
    clickAction: (ctx: PaymentCtx) => ({
      route: '/appointment/:id',
      params: { id: ctx.appointmentId },
    }),
    audiences: [
      {
        key: 'staff',
        roles: ['Admin', 'Receptionist'],
        // Only people who handle money are told about it.
        requiredPermission: PERMISSION_KEYS.PAYMENT_MANAGE,
        recipients: paymentStaff,
        message: {
          inApp: (ctx: PaymentCtx) => ({
            title: `Payment received – ${ctx.patientName || 'patient'}`,
            body: `₹${ctx.amount} collected. No further collection needed.`,
          }),
        },
      },
      {
        key: 'patient',
        roles: ['Patient'],
        recipients: paymentPatient,
        message: {
          inApp: (ctx: PaymentCtx) => ({
            title: `Payment of ₹${ctx.amount} received`,
            body: `For your appointment with ${doctorOf(ctx)}${
              ctx.when ? ` on ${ctx.when}` : ''
            } at ${ctx.clinicName || 'the clinic'}. No further action is needed.`,
          }),
        },
      },
    ],
  },
});
