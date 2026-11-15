/** Subscription events. Not configurable: a muted renewal reminder means staff accounts switch off without warning.
 *  Priority rises as the deadline nears. */

import { defineEvents } from '../defineEvents';
import type {
  EmailMessage,
  NotificationChannel,
  RecipientDeps,
} from '../types';

export interface SubscriptionCtx extends Record<string, unknown> {
  clinicId: string;
  clinicName: string;
  adminUserId: string;
  planName: string;
  totalAmount: string;
  daysRemaining: number;
}

export const subscriptionEvents = defineEvents({
  'subscription.expiring': {
    aliases: ['subscription-renewal'],
    label: 'Subscription Expiring',
    description: 'When your plan is close to expiry.',
    category: 'system',
    priority: 'action_required',
    kind: 'notification',
    configurable: false,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push'],
    tenant: (ctx: SubscriptionCtx) => ({
      type: 'clinic' as const,
      id: ctx.clinicId,
    }),
    // One row for the whole renewal window: each day's reminder replaces the last instead of stacking.
    collapseKey: (ctx: SubscriptionCtx) => `subscription:${ctx.clinicId}`,
    clickAction: () => ({ route: '/subscription' }),
    audiences: [
      {
        key: 'admin',
        roles: ['Admin'],
        recipients: (ctx: SubscriptionCtx) => [ctx.adminUserId],
        message: {
          inApp: (ctx: SubscriptionCtx) => ({
            title: 'Subscription expiring soon',
            body:
              ctx.daysRemaining <= 1
                ? `Your ${ctx.planName} plan (₹${ctx.totalAmount}) for ${ctx.clinicName} expires tomorrow. Renew now to keep your staff accounts active.`
                : `Your ${ctx.planName} plan (₹${ctx.totalAmount}) for ${ctx.clinicName} expires in ${ctx.daysRemaining} days. Renew to avoid staff deactivation.`,
          }),
        },
      },
    ],
  },
});

/** What every billing email carries; the rest of the ctx is the template's own fields. */
export interface BillingEmailCtx extends Record<string, unknown> {
  clinicId: string;
}

const rupees = (v: unknown) => `₹${Number(v ?? 0).toFixed(2)}`;

/** A billing email to the clinic's owner: not configurable, email only, links to the subscription page. */
function billingEmail<Ctx extends BillingEmailCtx>(
  label: string,
  description: string,
  priority: 'action_required' | 'normal',
  email: (ctx: Ctx) => EmailMessage
) {
  return {
    label,
    description,
    category: 'payments' as const,
    priority,
    kind: 'notification' as const,
    configurable: false,
    defaults: { inApp: false, push: false },
    channels: ['email'] as NotificationChannel[],
    tenant: (ctx: Ctx) => ({ type: 'clinic' as const, id: ctx.clinicId }),
    clickAction: () => ({ route: '/subscription' }),
    audiences: [
      {
        key: 'owner',
        roles: ['Admin'],
        recipients: async (ctx: Ctx, { directory }: RecipientDeps) => {
          const clinic = await directory.getClinic(ctx.clinicId);
          return clinic ? [clinic.ownerUserId] : [];
        },
        message: { email },
      },
    ],
  };
}

/** An email to the staff whose own access changes; recipients are the users the clinic picked. */
function staffAccessEmail<Ctx extends BillingEmailCtx & { userIds: string[] }>(
  label: string,
  description: string,
  email: (ctx: Ctx) => EmailMessage
) {
  const base = billingEmail<Ctx>(label, description, 'action_required', email);
  return {
    ...base,
    category: 'staff' as const,
    clickAction: () => ({ route: '/dashboard' }),
    audiences: [
      {
        key: 'staff',
        roles: ['Doctor', 'Receptionist', 'Pharmacist'],
        recipients: (ctx: Ctx) => ctx.userIds,
        message: { email },
      },
    ],
  };
}

const invoice = (ctx: { clinicId: string; invoiceId?: string | null }) =>
  ctx.invoiceId
    ? [{ kind: 'invoice' as const, ownerId: ctx.clinicId, id: ctx.invoiceId }]
    : [];

type AccessCtx = BillingEmailCtx & {
  userIds: string[];
  changeSummary: string;
  effectiveAt: string | Date;
};

export const subscriptionEmailEvents = defineEvents({
  'subscription.staff_access_scheduled': staffAccessEmail(
    'Your access is changing',
    'The clinic scheduled a plan or add-on change that switches off this account.',
    (c: AccessCtx) => ({
      subject: 'Your clinic scheduled an account access change',
      template: 'subscription.accessScheduled',
      props: {
        changeSummary: c.changeSummary,
        effectiveAt: c.effectiveAt,
        reminder: false,
      },
    })
  ),
  'subscription.staff_access_ending': staffAccessEmail(
    'Your access ends soon',
    '3 days before the account is switched off.',
    (c: AccessCtx) => ({
      subject: 'Reminder: your access ends in 3 days',
      template: 'subscription.accessScheduled',
      props: {
        changeSummary: c.changeSummary,
        effectiveAt: c.effectiveAt,
        reminder: true,
      },
    })
  ),
  'subscription.staff_access_kept': staffAccessEmail(
    'Your access continues',
    'The scheduled change was withdrawn, so this account stays on.',
    (
      c: BillingEmailCtx & {
        userIds: string[];
        currentPlanName: string;
        cancelledPlanName: string;
        effectiveAt: string | Date | null;
      }
    ) => ({
      subject: 'Your account access will continue',
      template: 'subscription.accessKept',
      props: {
        currentPlanName: c.currentPlanName,
        cancelledPlanName: c.cancelledPlanName,
        effectiveAt: c.effectiveAt,
      },
    })
  ),
  'subscription.payment_receipt': billingEmail(
    'Payment receipt',
    'A plan purchase, renewal or change was paid; the GST invoice is attached.',
    'normal',
    (
      c: BillingEmailCtx & {
        planName: string;
        amount: string;
        transactionId: string;
        billingCycle?: string;
        invoiceId?: string | null;
      }
    ) => ({
      subject: `MediArogya Subscription Purchase Successful — ${c.planName}`,
      template: 'subscription.purchase',
      props: {
        planName: c.planName,
        amount: rupees(c.amount),
        transactionId: c.transactionId,
        paid: true,
        billingCycle: c.billingCycle,
      },
      attachments: invoice(c),
    })
  ),
  'subscription.addon_receipt': billingEmail(
    'Add-on receipt',
    'An add-on was paid; the GST invoice is attached.',
    'normal',
    (
      c: BillingEmailCtx & {
        transactionId: string;
        invoiceId?: string | null;
        totalAmount: number;
        items: {
          name: string;
          quantity: number;
          billingCycle: string;
          amount: number;
        }[];
      }
    ) => ({
      subject: c.items.every((i) => i.billingCycle === 'one-time')
        ? `MediArogya WhatsApp Messages Added — ${c.items[0]?.name || 'Messages'}`
        : c.items.length > 1
          ? `MediArogya Add-ons Activated — ${c.items.length} Add-ons`
          : `MediArogya Add-on Activated — ${c.items[0]?.name || 'Add-on'}`,
      template: 'subscription.addOnPurchase',
      props: {
        items: c.items.map((i) => ({ ...i, amount: rupees(i.amount) })),
        totalAmount: rupees(c.totalAmount),
        transactionId: c.transactionId,
      },
      attachments: invoice(c),
    })
  ),
  'subscription.payment_failed': billingEmail(
    'Payment failed',
    'A payment did not go through, or the payment window was closed.',
    'action_required',
    (
      c: BillingEmailCtx & {
        itemName: string;
        amount?: number | null;
        reason?: string | null;
        droppedCheckout?: boolean;
        itemType?: 'subscription' | 'addon';
        /** An AutoPay renewal: when it is tried again (null = no more tries) and access ends. */
        autoPay?: { retryOn: string | null; accessUntil: string };
      }
    ) => {
      const what = c.itemType === 'addon' ? 'Add-on' : 'Subscription';
      return {
        subject: c.droppedCheckout
          ? `MediArogya ${what} Checkout Incomplete — ${c.itemName}`
          : `MediArogya ${what} Payment Failed — ${c.itemName}`,
        template: 'subscription.failure',
        props: {
          itemName: c.itemName,
          amount: c.amount == null ? null : rupees(c.amount),
          reason: c.reason || '',
          droppedCheckout: Boolean(c.droppedCheckout),
          itemType: c.itemType,
          autoPay: c.autoPay,
        },
      };
    }
  ),
  'subscription.trial_started': billingEmail(
    'Free trial started',
    'The clinic started its free trial.',
    'normal',
    (
      c: BillingEmailCtx & {
        planName: string;
        trialDays: number;
        trialEndsAt: string | Date;
      }
    ) => ({
      subject: `MediArogya Free Trial Activated — ${c.planName}`,
      template: 'subscription.purchase',
      props: {
        planName: c.planName,
        amount: rupees(0),
        transactionId: '',
        paid: false,
        trialDays: c.trialDays,
        trialEndsAt: c.trialEndsAt,
      },
    })
  ),
  'subscription.change_scheduled': billingEmail(
    'Plan change scheduled',
    'A downgrade or cycle change was scheduled for the period end.',
    'normal',
    (
      c: BillingEmailCtx & {
        planName: string;
        effectiveAt: string | Date;
        scheduled: boolean;
      }
    ) => {
      const { clinicId: _clinicId, ...props } = c;
      return {
        subject: c.scheduled
          ? `MediArogya Subscription Plan Change Scheduled — ${c.planName}`
          : `MediArogya Subscription Plan Change — ${c.planName}`,
        template: 'subscription.planChange',
        props,
      };
    }
  ),
  'subscription.change_undone': billingEmail(
    'Scheduled change undone',
    'A scheduled plan change was withdrawn.',
    'normal',
    (
      c: BillingEmailCtx & {
        currentPlanName: string;
        cancelledPlanName: string;
      }
    ) => ({
      subject: `MediArogya Scheduled Plan Change Cancelled — ${c.cancelledPlanName}`,
      template: 'subscription.planChangeReversed',
      props: {
        currentPlanName: c.currentPlanName,
        cancelledPlanName: c.cancelledPlanName,
      },
    })
  ),
  'subscription.addon_removal_scheduled': billingEmail(
    'Add-on removal scheduled',
    'An add-on ends at the period end.',
    'normal',
    (
      c: BillingEmailCtx & {
        addOnName: string;
        effectiveAt: string | Date;
        scheduled: boolean;
        quantity?: number;
      }
    ) => ({
      subject: `MediArogya ${c.scheduled ? 'Add-on Renewal Cancellation Scheduled' : 'Add-on Cancellation Confirmed'} — ${c.addOnName}`,
      template: 'subscription.addOnCancellation',
      props: {
        addOnName: c.addOnName,
        effectiveAt: c.effectiveAt,
        scheduled: c.scheduled,
        quantity: c.quantity,
      },
    })
  ),
  'subscription.addon_reduction_scheduled': billingEmail(
    'Add-on reduction scheduled',
    'An add-on goes down at the period end.',
    'normal',
    (
      c: BillingEmailCtx & {
        addOnName: string;
        previousQuantity: number;
        newQuantity: number;
        effectiveAt: string | Date;
      }
    ) => ({
      subject: `MediArogya Add-on Quantity Reduction Scheduled — ${c.addOnName}`,
      template: 'subscription.addOnReduction',
      props: {
        addOnName: c.addOnName,
        previousQuantity: c.previousQuantity,
        newQuantity: c.newQuantity,
        effectiveAt: c.effectiveAt,
      },
    })
  ),
  'subscription.trial_ending': billingEmail(
    'Free trial ending',
    '3 days and 1 day before the trial ends.',
    'action_required',
    (
      c: BillingEmailCtx & {
        planName: string;
        trialEndsAt: string | Date;
        daysLeft: number;
      }
    ) => ({
      subject: `Your free trial ends ${c.daysLeft <= 1 ? 'tomorrow' : `in ${c.daysLeft} days`}`,
      template: 'subscription.trialEnding',
      props: {
        planName: c.planName,
        trialEndsAt: c.trialEndsAt,
        daysLeft: c.daysLeft,
      },
    })
  ),
  'subscription.renewal_reminder': billingEmail(
    'Renewal reminder',
    '7, 3 and 1 days before a plan renews, and on the first and last grace day if it is unpaid.',
    'action_required',
    (
      c: BillingEmailCtx & {
        planName: string;
        billingCycle: string;
        periodEnd: string | Date;
        amount: string;
        daysLeft: number;
        /** In the grace days: the last day of access. */
        graceUntil?: string | Date | null;
      }
    ) => ({
      subject: c.graceUntil
        ? `Payment due: renew ${c.planName} to keep access`
        : `Renew ${c.planName} ${c.daysLeft <= 1 ? 'tomorrow' : `in ${c.daysLeft} days`}`,
      template: 'subscription.renewalReminder',
      props: {
        planName: c.planName,
        billingCycle: c.billingCycle,
        periodEnd: c.periodEnd,
        amount: c.amount,
        daysLeft: c.daysLeft,
        graceUntil: c.graceUntil ?? null,
      },
    })
  ),
  'subscription.expired': billingEmail(
    'Plan ended',
    'The plan ended and the clinic moved to the Free plan.',
    'action_required',
    (
      c: BillingEmailCtx & {
        planName: string;
        endedAt: string | Date;
        cancelled: boolean;
      }
    ) => ({
      subject: `${c.planName} has ended`,
      template: 'subscription.expired',
      props: {
        planName: c.planName,
        endedAt: c.endedAt,
        cancelled: c.cancelled,
      },
    })
  ),
  'subscription.change_applied': billingEmail(
    'Scheduled changes applied',
    'Scheduled add-on changes took effect at renewal.',
    'normal',
    (c: BillingEmailCtx & { summary: string; effectiveAt: string | Date }) => ({
      subject: 'Your scheduled add-on changes are now in effect',
      template: 'subscription.changeApplied',
      props: { summary: c.summary, effectiveAt: c.effectiveAt },
    })
  ),
  'subscription.plan_ending': billingEmail(
    'Plan ending',
    'A Super Admin ended the plan; the clinic renews on the replacement after the end date.',
    'normal',
    (
      c: BillingEmailCtx & {
        planName: string;
        endsAt: string | Date;
        replacementName: string | null;
      }
    ) => ({
      subject: `${c.planName} is ending`,
      template: 'subscription.planEnding',
      props: {
        planName: c.planName,
        endsAt: c.endsAt,
        replacementName: c.replacementName,
      },
    })
  ),
  'subscription.refund_issued': billingEmail(
    'Refund issued',
    'A payment was refunded; the credit note is attached.',
    'normal',
    (
      c: BillingEmailCtx & {
        amount: string;
        itemName: string;
        invoiceNumber: string | null;
        creditNoteId: string | null;
        creditNoteNumber: string | null;
        endedItem: string | null;
      }
    ) => ({
      subject: `MediArogya Refund Issued — ${c.itemName}`,
      template: 'subscription.refundIssued',
      props: {
        amount: c.amount,
        itemName: c.itemName,
        invoiceNumber: c.invoiceNumber,
        creditNoteNumber: c.creditNoteNumber,
        endedItem: c.endedItem,
      },
      // The credit note downloads through the invoice route by its own id.
      attachments: invoice({ clinicId: c.clinicId, invoiceId: c.creditNoteId }),
    })
  ),
  'subscription.autopay_changed': billingEmail(
    'AutoPay turned on or off',
    'AutoPay was approved, or turned off by the clinic, the MediArogya team or the bank.',
    'normal',
    (
      c: BillingEmailCtx & {
        on: boolean;
        maxAmount: string | null;
        reason: string | null;
        renewBy: string | Date | null;
      }
    ) => ({
      subject: c.on
        ? 'MediArogya AutoPay Is On'
        : 'MediArogya AutoPay Is Off',
      template: 'subscription.autoPayChanged',
      props: {
        on: c.on,
        maxAmount: c.maxAmount,
        reason: c.reason,
        renewBy: c.renewBy,
      },
    })
  ),
  'subscription.plan_extended': billingEmail(
    'Plan extended',
    'The MediArogya team added days to the plan at no charge.',
    'normal',
    (
      c: BillingEmailCtx & {
        planName: string;
        days: number;
        endsAt: string | Date;
      }
    ) => ({
      subject: `MediArogya Plan Extended — ${c.planName}`,
      template: 'subscription.planExtended',
      props: { planName: c.planName, days: c.days, endsAt: c.endsAt },
    })
  ),
  'subscription.price_change': billingEmail(
    'Price change at renewal',
    'A new plan version raises the price at the next renewal.',
    'normal',
    (
      c: BillingEmailCtx & {
        planName: string;
        billingCycle: string;
        oldPrice: string;
        newPrice: string;
        from: string | Date;
      }
    ) => ({
      subject: `${c.planName} price change at your next renewal`,
      template: 'subscription.priceChange',
      props: {
        planName: c.planName,
        billingCycle: c.billingCycle,
        oldPrice: c.oldPrice,
        newPrice: c.newPrice,
        from: c.from,
      },
    })
  ),
});
