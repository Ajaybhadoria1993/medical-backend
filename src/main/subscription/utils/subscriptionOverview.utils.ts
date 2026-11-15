import { formatISTDate } from '../../../utils/istDateTime';
import { capAddOnRenewalQuantity } from './addOnQuantity.utils';
import type { GstSplit, TaxSetting } from '../types/tax.types';
import type { PaymentLines } from '../types/subscriptionPayment.types';
import { applyTax, gstLabel } from './invoiceTax.utils';

export type Cycle = 'monthly' | 'yearly';

export interface AddOnRow {
  id: string;
  addOnName: string;
  featureKey: string;
  quantity: number;
  scheduledQuantity: number | null;
  unitValue: number;
  monthlyPrice: string;
  yearlyPrice: string;
}

export interface AddOnLine {
  id: string;
  addOnName: string;
  featureKey: string;
  totalQuantity: number;
  renewalQuantity: number;
  billingCycle: Cycle;
  totalPrice: number;
  recurringPrice: number;
  cancelAtPeriodEnd: boolean;
}

/** A scheduled plan's cap decides how many units renew; a missing cap means none (`capAddOnRenewalQuantity`). */
export function addOnLine(
  row: AddOnRow,
  ctx: {
    cycle: Cycle;
    periodEnd: Date | null;
    scheduled: { isFree: boolean; changeAt: Date | null } | null;
    maxCap?: number | null;
  }
): AddOnLine {
  const asked = row.scheduledQuantity ?? row.quantity;
  const renewalQuantity = !ctx.scheduled
    ? asked
    : ctx.scheduled.isFree
      ? 0
      : capAddOnRenewalQuantity(asked, row.unitValue, ctx.maxCap);
  const unitPrice = Number(
    ctx.cycle === 'yearly' ? row.yearlyPrice : row.monthlyPrice
  );
  return {
    id: row.id,
    addOnName: row.addOnName,
    featureKey: row.featureKey,
    totalQuantity: row.quantity,
    renewalQuantity,
    billingCycle: ctx.cycle,
    totalPrice: unitPrice * row.quantity,
    recurringPrice: unitPrice * renewalQuantity,
    cancelAtPeriodEnd: row.quantity > 0 && renewalQuantity === 0,
  };
}

export function renewalSummary(input: {
  planName: string;
  planAmount: number;
  cycle: Cycle;
  nextChargeDate: Date | null;
  cancelAtPeriodEnd: boolean;
  scheduledPlanName: string | null;
  scheduledPlanChangeAt: Date | null;
  addOns: AddOnLine[];
  /** AutoPay is on, so the renewal is charged without the clinic paying. */
  autoPayOn?: boolean;
  /** GST in force on the charge date; exclusive GST adds a line. */
  tax?: TaxSetting;
  /** CGST + SGST or IGST, for the line's wording. */
  split?: GstSplit | null;
  /** Set in the grace days: the last day the clinic keeps access without paying. */
  graceUntil?: Date | null;
  /** The AutoPay order already sent: its amount wins over today's prices and GST. */
  scheduled?: { amountPaise: number; lines: PaymentLines } | null;
}) {
  const name = input.planName.toLowerCase().endsWith('plan')
    ? input.planName
    : `${input.planName} Plan`;
  const breakdown: {
    type: 'plan' | 'addon' | 'tax';
    label: string;
    name: string;
    featureKey?: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }[] = [
    {
      type: 'plan',
      label: 'Plan Amount',
      name,
      quantity: 1,
      unitPrice: input.planAmount,
      amount: input.planAmount,
    },
    ...input.addOns
      .filter((a) => a.renewalQuantity > 0)
      .map((a) => ({
        type: 'addon' as const,
        label:
          a.renewalQuantity > 1
            ? `${a.addOnName} ×${a.renewalQuantity}`
            : a.addOnName,
        name: a.addOnName,
        featureKey: a.featureKey,
        quantity: a.renewalQuantity,
        unitPrice: a.recurringPrice / a.renewalQuantity,
        amount: a.recurringPrice,
      })),
  ];
  const net = breakdown.reduce((s, b) => s + b.amount, 0);
  if (input.tax?.mode === 'exclusive') {
    const gst = applyTax(Math.round(net * 100), input.tax).taxPaise / 100;
    if (gst > 0)
      breakdown.push({
        type: 'tax',
        label: gstLabel(input.tax, input.split ?? null),
        name: 'GST',
        quantity: 1,
        unitPrice: gst,
        amount: gst,
      });
  }
  if (input.scheduled) {
    // Renewal orders hold only plan, add-on and tax lines.
    breakdown.splice(
      0,
      breakdown.length,
      ...input.scheduled.lines.items
        .filter((l) => ['plan', 'addon', 'tax'].includes(l.kind))
        .map((l) => ({
          type: l.kind as 'plan' | 'addon' | 'tax',
          label: l.kind === 'plan' ? 'Plan Amount' : l.description,
          name: l.description,
          quantity: l.quantity ?? 1,
          unitPrice: l.amountPaise / 100 / (l.quantity ?? 1),
          amount: l.amountPaise / 100,
        }))
    );
  }
  const totalAmount = input.scheduled
    ? input.scheduled.amountPaise / 100
    : Math.round(breakdown.reduce((s, b) => s + b.amount, 0) * 100) / 100;
  const dateStr = input.nextChargeDate
    ? formatISTDate(input.nextChargeDate)
    : '';
  const amount = `₹${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(totalAmount) ? 0 : 2, maximumFractionDigits: 2 })}`;
  const graceStr = input.graceUntil ? formatISTDate(input.graceUntil) : '';
  // In the grace days the date has passed: say it is due and until when access lasts, never "a few days before" a past date.
  const notice = input.cancelAtPeriodEnd
    ? `Subscription is scheduled for cancellation. Plan will expire on ${dateStr}.`
    : input.graceUntil
      ? input.autoPayOn
        ? `Your renewal of ${amount} is due. AutoPay will try to charge it; if it does not go through, pay by ${graceStr} to keep your plan.`
        : `Your renewal of ${amount} is due. Everything keeps working until ${graceStr}; pay by then to keep your plan.`
      : input.autoPayOn && input.scheduled
        ? `Your bank has been notified: ${amount} will be charged by AutoPay before ${dateStr}. Price or GST changes made now apply from the next renewal.`
        : input.autoPayOn
          ? `AutoPay is on — ${amount} will be charged a few days before ${dateStr}. Your bank notifies you first.`
          : `AutoPay is off — you'll need to renew manually (${amount}) before ${dateStr} to keep access.`;

  return {
    nextChargeDate: input.nextChargeDate,
    billingCycle: input.cycle,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    scheduledPlanName: input.scheduledPlanName,
    scheduledPlanChangeAt: input.scheduledPlanChangeAt,
    totalAmount,
    currency: 'INR',
    breakdown,
    notice,
    autoRenew: Boolean(input.autoPayOn) && !input.cancelAtPeriodEnd,
  };
}
