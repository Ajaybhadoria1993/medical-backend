/**
 * Messages from the MediArogya team to a clinic owner (sent from the Super Admin
 * Action Center). Free text, so in-app + push only; WhatsApp/email need approved templates.
 * Not configurable: it is how the platform team reaches a clinic, like subscription alerts.
 */

import { defineEvents } from '../defineEvents';

export interface PlatformMessageCtx extends Record<string, unknown> {
  clinicId: string;
  ownerUserId: string;
  title: string;
  body: string;
}

/** The daily billing check found something (Q4: email only, to every Super Admin). */
export interface BillingAlertCtx extends Record<string, unknown> {
  differences: number;
  webhookQuiet: boolean;
  lastWebhookAt: string | null;
  autoPayFailed: number;
  pastDue: number;
  /** Razorpay events that ran out of retries in the last 7 days. */
  webhooksStuck: number;
  /** Background jobs that failed or missed a run, e.g. "Plan period end (missed)". */
  jobsNeedingLook: string[];
  /** Appointment payments the nightly check could not fix, e.g. "pay_X: money taken, no booking". */
  appointmentPayments: string[];
}

/** One Razorpay event gave up after every retry. */
export interface WebhookStuckCtx extends Record<string, unknown> {
  eventType: string;
  error: string;
}

export const platformEvents = defineEvents({
  'platform.webhook_stuck': {
    label: 'Razorpay event stuck',
    description:
      'When a Razorpay event could not be applied after every retry.',
    category: 'payments',
    priority: 'action_required',
    kind: 'notification',
    configurable: false,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push'],
    // No tenant: a platform event for Super Admins, who belong to no clinic.
    clickAction: () => ({ route: '/business/revenue?tab=checks' }),
    audiences: [
      {
        key: 'superadmins',
        roles: ['Super_Admin'],
        recipients: async (_ctx: WebhookStuckCtx, { directory }) =>
          (await directory.getSuperAdmins()).map((a) => a.id),
        message: {
          inApp: (ctx: WebhookStuckCtx) => ({
            title: `Razorpay event stuck: ${ctx.eventType || 'unknown type'}`,
            body: `It failed after every retry: ${String(ctx.error ?? 'no reason given').slice(0, 140)}. Open Billing Checks to retry it.`,
          }),
        },
      },
    ],
  },

  'platform.billing_alert': {
    label: 'Billing needs a look',
    description:
      'When the daily check finds Razorpay differences, a quiet webhook or many failed AutoPay charges.',
    category: 'payments',
    priority: 'action_required',
    kind: 'notification',
    configurable: false,
    defaults: { inApp: false, push: false },
    channels: ['email'],
    // No tenant: a platform event for Super Admins, who belong to no clinic.
    clickAction: () => ({ route: '/business/revenue' }),
    audiences: [
      {
        key: 'superadmins',
        roles: ['Super_Admin'],
        recipients: async (_ctx: BillingAlertCtx, { directory }) =>
          (await directory.getSuperAdmins()).map((a) => a.id),
        message: {
          email: (ctx: BillingAlertCtx) => ({
            subject: `MediArogya billing needs a look — ${[ctx.differences && `${ctx.differences} difference(s)`, ctx.webhookQuiet && 'webhook quiet', ctx.autoPayFailed && `${ctx.autoPayFailed} AutoPay failures`, ctx.webhooksStuck && `${ctx.webhooksStuck} webhook(s) stuck`, ctx.jobsNeedingLook.length && `${ctx.jobsNeedingLook.length} job(s) need a look`, ctx.appointmentPayments?.length && `${ctx.appointmentPayments.length} appointment payment(s) need a look`].filter(Boolean).join(', ')}`,
            template: 'platform.billingAlert',
            props: { ...ctx },
          }),
        },
      },
    ],
  },

  'platform.message': {
    label: 'Message from MediArogya',
    description: 'When the MediArogya team sends you a message.',
    category: 'system',
    priority: 'normal',
    kind: 'notification',
    configurable: false,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push'],
    tenant: (ctx: PlatformMessageCtx) => ({
      type: 'clinic' as const,
      id: ctx.clinicId,
    }),
    clickAction: () => ({ route: '/dashboard' }),
    audiences: [
      {
        key: 'owner',
        roles: ['Admin'],
        recipients: (ctx: PlatformMessageCtx) => [ctx.ownerUserId],
        message: {
          inApp: (ctx: PlatformMessageCtx) => ({
            title: ctx.title,
            body: ctx.body,
          }),
        },
      },
    ],
  },
});
