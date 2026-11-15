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

/** A Route transfer to the clinic failed or was reversed (step 10, Q8). */
export interface TransferFailedCtx extends Record<string, unknown> {
  appointmentId: string;
  clinicId: string;
  transferId: string;
  amount: string;
  reversed: boolean;
  reason: string | null;
  patientName?: string;
  when?: string;
}

const transferFailedEmail = (ctx: TransferFailedCtx) => ({
  subject: `Payout of ₹${ctx.amount} ${ctx.reversed ? 'was reversed' : 'failed'}`,
  template: 'payment.transferFailed',
  props: { ...ctx },
});

const transferFailedInApp = (ctx: TransferFailedCtx) => ({
  title: `Payout of ₹${ctx.amount} ${ctx.reversed ? 'reversed' : 'failed'}`,
  body: `${ctx.patientName ? `For ${ctx.patientName}'s visit. ` : ''}Reason: ${ctx.reason || 'not given'}. Our team has been told.`,
});

/** The clinic's payout account just became ready to receive online money. */
export interface PayoutsReadyCtx extends Record<string, unknown> {
  clinicId: string;
}

/** Razorpay needs a change, rejected, suspended or locked the clinic's payout account. */
export interface PayoutActionNeededCtx extends Record<string, unknown> {
  clinicId: string;
  reason: string | null;
  suspended: boolean;
}

const payoutActionInApp = (ctx: PayoutActionNeededCtx) => ({
  title: ctx.suspended ? 'Payouts are paused' : 'Payout account needs a change',
  body: `${ctx.reason || 'Razorpay needs a change'}. Open the payout account to fix it.`,
});

export const paymentEvents = defineEvents({
  'payment.payouts_ready': {
    label: 'Payouts Ready',
    description: 'When Razorpay finishes checking the payout account.',
    category: 'payments',
    priority: 'normal',
    kind: 'notification',
    configurable: false,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push', 'email'],
    tenant: (ctx: PayoutsReadyCtx) => ({
      type: 'clinic' as const,
      id: ctx.clinicId,
    }),
    clickAction: () => ({ route: '/finance?tab=payouts' }),
    audiences: [
      {
        key: 'admins',
        roles: ['Admin'],
        recipients: async (ctx: PayoutsReadyCtx, { directory }) =>
          (await directory.getStaffByRole(ctx.clinicId, ['Admin'])).map(
            (u) => u.id
          ),
        message: {
          inApp: () => ({
            title: 'Payouts are ready',
            body: 'Razorpay checked your bank account. Online booking money now reaches it automatically.',
          }),
          email: (ctx: PayoutsReadyCtx) => ({
            subject: 'Payouts are ready',
            template: 'payment.payoutsReady',
            props: { ...ctx },
          }),
        },
      },
    ],
  },

  'payment.payout_action_needed': {
    label: 'Payout Account Needs A Change',
    description:
      'When Razorpay needs a change, rejects, pauses or locks the payout account.',
    category: 'payments',
    priority: 'action_required',
    kind: 'notification',
    // Money that can't reach the clinic is never something to opt out of.
    configurable: false,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push', 'email'],
    tenant: (ctx: PayoutActionNeededCtx) => ({
      type: 'clinic' as const,
      id: ctx.clinicId,
    }),
    clickAction: () => ({ route: '/link-clinic-account' }),
    audiences: [
      {
        key: 'admins',
        roles: ['Admin'],
        recipients: async (ctx: PayoutActionNeededCtx, { directory }) =>
          (await directory.getStaffByRole(ctx.clinicId, ['Admin'])).map(
            (u) => u.id
          ),
        message: {
          inApp: payoutActionInApp,
          email: (ctx: PayoutActionNeededCtx) => ({
            subject: ctx.suspended
              ? 'Payouts are paused'
              : 'Your payout account needs a change',
            template: 'payment.payoutActionNeeded',
            props: { ...ctx },
          }),
        },
      },
      {
        // The team hears at once; the payout_blocked follow-up is where they work it.
        key: 'superadmins',
        roles: ['Super_Admin'],
        recipients: async (_ctx: PayoutActionNeededCtx, { directory }) =>
          (await directory.getSuperAdmins()).map((a) => a.id),
        message: {
          inApp: (ctx: PayoutActionNeededCtx) => ({
            title: ctx.suspended
              ? "A clinic's payouts are paused"
              : "A clinic's payout account needs a change",
            body: `${ctx.reason || 'Razorpay needs a change'}. See Follow-ups → Payout blocked.`,
          }),
        },
      },
    ],
  },

  'payment.transfer_failed': {
    label: 'Payout Failed',
    description:
      'When money from an online payment does not reach the clinic bank.',
    category: 'payments',
    priority: 'action_required',
    kind: 'notification',
    // Money not arriving is never something to opt out of.
    configurable: false,
    defaults: { inApp: true, push: false },
    channels: ['inApp', 'email'],
    tenant: (ctx: TransferFailedCtx) => ({
      type: 'clinic' as const,
      id: ctx.clinicId,
    }),
    enrich: async (ctx: TransferFailedCtx, deps) => {
      const info = await deps.directory.getAppointmentContext(
        ctx.appointmentId
      );
      return info
        ? { patientName: info.patientName, when: formatSchedule(info) }
        : {};
    },
    clickAction: () => ({ route: '/finance?tab=payouts' }),
    audiences: [
      {
        key: 'admins',
        roles: ['Admin'],
        recipients: async (ctx: TransferFailedCtx, { directory }) =>
          (await directory.getStaffByRole(ctx.clinicId, ['Admin'])).map(
            (u) => u.id
          ),
        message: {
          inApp: transferFailedInApp,
          email: transferFailedEmail,
        },
      },
      {
        key: 'superadmins',
        roles: ['Super_Admin'],
        recipients: async (_ctx: TransferFailedCtx, { directory }) =>
          (await directory.getSuperAdmins()).map((a) => a.id),
        message: { inApp: transferFailedInApp, email: transferFailedEmail },
      },
    ],
  },

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
