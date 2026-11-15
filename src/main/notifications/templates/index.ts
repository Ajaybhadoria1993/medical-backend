import * as lifecycle from './subscription/lifecycle';
import * as purchase from './subscription/purchase';
import { billingAlertTemplate } from './platform/billingAlert';
import { transferFailedTemplate } from './payment/transferFailed';
import {
  payoutActionNeededTemplate,
  payoutsReadyTemplate,
} from './payment/payoutStatus';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Render = (props: any) => string;

/** Every email the dispatcher can send, by the name a registry entry gives in `email.template`. */
export const EMAIL_TEMPLATES: Record<string, Render> = {
  'subscription.purchase': purchase.subscriptionPurchaseSuccessTemplate,
  'platform.billingAlert': billingAlertTemplate,
  'payment.transferFailed': transferFailedTemplate,
  'payment.payoutsReady': payoutsReadyTemplate,
  'payment.payoutActionNeeded': payoutActionNeededTemplate,
  'subscription.failure': purchase.subscriptionPurchaseFailureTemplate,
  'subscription.planChange': purchase.subscriptionPlanChangeTemplate,
  'subscription.planChangeReversed':
    purchase.subscriptionPlanChangeReversedTemplate,
  'subscription.addOnPurchase': purchase.addOnPurchaseSuccessTemplate,
  'subscription.addOnCancellation': purchase.addOnCancellationTemplate,
  'subscription.addOnReduction': purchase.addOnQuantityReductionTemplate,
  'subscription.trialEnding': lifecycle.trialEndingTemplate,
  'subscription.renewalReminder': lifecycle.renewalReminderTemplate,
  'subscription.expired': lifecycle.expiredTemplate,
  'subscription.changeApplied': lifecycle.changeAppliedTemplate,
  'subscription.priceChange': lifecycle.priceChangeTemplate,
  'subscription.planEnding': lifecycle.planEndingTemplate,
  'subscription.refundIssued': lifecycle.refundIssuedTemplate,
  'subscription.autoPayChanged': lifecycle.autoPayChangedTemplate,
  'subscription.planExtended': lifecycle.planExtendedTemplate,
  // Staff emails name the reader and their role, not the clinic owner.
  'subscription.accessScheduled': (p) =>
    purchase.accountAccessScheduledDeactivationTemplate({
      ...p,
      userName: p.recipientName,
      roleName: p.recipientRole,
    }),
  'subscription.accessKept': (p) =>
    purchase.accountAccessDowngradeReversedTemplate({
      ...p,
      userName: p.recipientName,
      roleName: p.recipientRole,
    }),
};

// Props come through Redis as JSON; templates format these as Dates.
const DATE_KEYS = new Set([
  'endsAt',
  'effectiveAt',
  'trialEndsAt',
  'expiresAt',
  'accessThrough',
  'expiredAt',
  'periodEnd',
  'endedAt',
  'from',
  'renewedUntil',
  'renewBy',
  'graceUntil',
]);

export function renderEmailTemplate(
  name: string,
  props: Record<string, unknown>
): string {
  const render = EMAIL_TEMPLATES[name];
  if (!render)
    throw new Error(`[Notifications] Unknown email template "${name}"`);
  const revived = Object.fromEntries(
    Object.entries(props).map(([k, v]) => [
      k,
      DATE_KEYS.has(k) && typeof v === 'string' ? new Date(v) : v,
    ])
  );
  return render(revived);
}
