import { fromPaise } from '../../money';
import type {
  SubscriptionInvoice,
  SubscriptionPayment,
} from '../models/subscriptionPayment.model';

const rupees = (paise: number) => Number(fromPaise(paise));

/** Every part of the bill by name: "CareHub + Additional Doctor", "Add-ons: Additional Staff × 9". */
export function itemName(payment: SubscriptionPayment) {
  const clean = (d: string) =>
    d.replace(/ \((monthly|yearly)\)$/, '').replace(/ × 1$/, '');
  const items = payment.lines.items;
  const plan = items.find((l) => l.kind === 'plan');
  const addOns = items
    .filter((l) => l.kind === 'addon')
    .map((l) => clean(l.description));
  const credits = items
    .filter((l) => l.kind === 'credits')
    .map((l) => l.description);
  if (!plan && !credits.length) {
    return addOns.length ? `Add-ons: ${addOns.join(', ')}` : 'Subscription';
  }
  return [
    ...(plan ? [clean(plan.description)] : []),
    ...addOns,
    ...credits,
  ].join(' + ');
}

/** One billing-history row in the shape the Subscription page already reads. */
export function toHistoryItem(
  payment: SubscriptionPayment,
  invoice: SubscriptionInvoice | null
) {
  const plan = payment.lines.items.find((l) => l.kind === 'plan');
  // An add-on-only payment has no plan line: name it after its add-ons, not "Subscription".
  const addOns = payment.lines.items.filter((l) => l.kind === 'addon');
  // The line text already carries "× n"; drop a lone "× 1" and the cycle the column shows anyway.
  const addOnNames = addOns
    .map((l) =>
      l.description.replace(/ \((monthly|yearly)\)$/, '').replace(/ × 1$/, '')
    )
    .join(', ');
  const paidAt = payment.paidAt ?? payment.createdAt;
  return {
    id: invoice?.id ?? payment.id,
    invoiceNumber: invoice?.invoiceNumber ?? null,
    planName: itemName(payment),
    planDescription: plan?.description ?? (addOnNames || undefined),
    billingCycle: plan?.billingCycle ?? addOns[0]?.billingCycle ?? null,
    price: rupees(payment.amountPaise),
    currency: payment.currency,
    startsAt: (payment.periodStart ?? paidAt).toISOString(),
    expiresAt: payment.periodEnd?.toISOString() ?? null,
    createdAt: paidAt.toISOString(),
    paymentMode:
      payment.paymentMethod ?? (payment.amountPaise === 0 ? 'free' : 'online'),
    paymentStatus: payment.status === 'refunded' ? 'refunded' : 'success',
    transactionId: payment.providerPaymentId ?? undefined,
  };
}
