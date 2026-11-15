import { and, eq, gte } from 'drizzle-orm';
import { SubscriptionPaymentModel } from '../../models/subscriptionPayment.model';
import { addOnPriceNow } from '../../models/addOnPrice.model';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { fromPaise, toPaise } from '../../../money';
import { AddOnModel } from '../../models/addon.model';
import { SubscriptionAddOnModel } from '../../models/ownerSubscription.model';
import type { PlanVersion } from '../../models/planVersion.model';
import { SubscriptionPlanModel } from '../../models/subscription.model';
import type { PaymentLine } from '../../types/subscriptionPayment.types';
import {
  PRICING_REFUSALS,
  daysInPeriod,
  daysLeft,
  prorate,
  pricingCase,
  trialRenews,
  type Cycle,
} from '../../utils/planPricing.utils';
import { anchorDayOf, nextPeriodEnd } from '../../utils/renewalDate.utils';
import { couponService } from '../coupon.service';
import { OwnerSubscriptionService } from '../core/ownerSubscription.service';
import { PlansService } from '../core/plans.service';
import { AddOnChangeService } from '../core/addOnChange.service';
import { AutoPayLimitService } from './autoPayLimit.service';
import { capInUnits, limitResponse } from '../../utils/autoPay.utils';
import { applyTax, gstLabel, withTax } from '../../utils/invoiceTax.utils';
import { TaxService } from './tax.service';

// The highest single UPI AutoPay debit without extra authentication.
const MAX_UPI_LIMIT = 15000;

const priceOf = (version: PlanVersion, cycle: Cycle) =>
  cycle === 'yearly' ? version.yearlyPrice : version.monthlyPrice;

interface AddOnQuote {
  clinicAddOnId: string;
  addOnId: string;
  name: string;
  quantity: number;
  newCyclePrice: number;
  credit: number;
  prorationDays: number;
  proratedAmount: number;
  remainingDays: number;
  carriedForward: boolean;
  payable: number;
}

/** The one price for a plan: /quote shows it and checkout charges it, so the two can never differ. */
export class PlanPricingService {
  static async quote(input: {
    clinicId: string;
    planId: string;
    cycle: Cycle;
    couponCode?: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const [plan] = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(
        and(
          eq(SubscriptionPlanModel.id, input.planId),
          eq(SubscriptionPlanModel.ownerType, 'clinic'),
          eq(SubscriptionPlanModel.kind, 'paid')
        )
      )
      .limit(1);
    const version = plan && (await PlansService.currentVersion(plan.id, now));
    if (!plan || !version) throw new HttpError(400, 'Invalid plan');

    const current = await OwnerSubscriptionService.getCurrent(
      'clinic',
      input.clinicId,
      now
    );
    // A plan taken off sale stays renewable for the clinics already on it, until it ends.
    if (!plan.isActive && current?.plan.id !== plan.id) {
      throw new HttpError(400, `${plan.name} is no longer sold.`);
    }
    if (plan.endsAt && plan.endsAt <= now) {
      throw new HttpError(
        400,
        `${plan.name} has ended. Choose another plan to continue.`
      );
    }
    const price = priceOf(version, input.cycle);
    if (price === null) {
      throw new HttpError(400, `${plan.name} is not sold ${input.cycle}.`);
    }
    const pricePaise = toPaise(price);
    const sub = current?.subscription;
    const currentCycle: Cycle =
      sub?.billingCycle === 'yearly' ? 'yearly' : 'monthly';
    const currentPrice = current
      ? priceOf(current.version, currentCycle)
      : null;
    const paid =
      !!current?.state.isValid &&
      current.plan.kind === 'paid' &&
      !sub!.isTrial &&
      sub!.billingCycle !== 'none' &&
      !!sub!.currentPeriodEnd;
    // A trial renews on its end date like a paid plan, but only into the same plan monthly (no credit for free days).
    const trialRenewal =
      !!current?.state.isValid &&
      !!sub?.isTrial &&
      !!sub.currentPeriodEnd &&
      trialRenews({
        samePlan: current.plan.id === plan.id,
        cycle: input.cycle,
        daysLeft: daysLeft(now, sub.currentPeriodEnd),
      });
    const decided = trialRenewal
      ? { case: 'renewal' as const }
      : pricingCase(
          paid && current
            ? {
                paid: true,
                planId: current.plan.id,
                cycle: currentCycle,
                pricePaise: toPaise(currentPrice ?? 0),
                downgradeScheduled: !!sub!.scheduledPlanId,
                renewalDue: sub!.currentPeriodEnd!.getTime() < now.getTime(),
                daysLeft: daysLeft(now, sub!.currentPeriodEnd!),
                scheduled:
                  sub!.scheduledPlanId &&
                  (sub!.scheduledBillingCycle === 'monthly' ||
                    sub!.scheduledBillingCycle === 'yearly')
                    ? {
                        planId: sub!.scheduledPlanId,
                        cycle: sub!.scheduledBillingCycle,
                      }
                    : null,
              }
            : null,
          { planId: plan.id, cycle: input.cycle, pricePaise }
        );
    if ('refuse' in decided) {
      throw new HttpError(409, PRICING_REFUSALS[decided.refuse]);
    }
    const pricing = decided.case;
    if (pricing === 'renewal' && input.couponCode) {
      throw new HttpError(400, 'A coupon cannot be used on a renewal.');
    }

    const addOnRows =
      (paid || trialRenewal) &&
      sub &&
      (pricing === 'renewal' ||
        pricing === 'to_yearly' ||
        pricing === 'upgrade')
        ? await database
            .select({
              id: SubscriptionAddOnModel.id,
              addOnId: SubscriptionAddOnModel.addOnId,
              quantity: SubscriptionAddOnModel.quantity,
              scheduledQuantity: SubscriptionAddOnModel.scheduledQuantity,
              name: AddOnModel.name,
              unitValue: AddOnModel.unitValue,
              monthlyPrice: addOnPriceNow('monthly'),
              yearlyPrice: addOnPriceNow('yearly'),
            })
            .from(SubscriptionAddOnModel)
            .innerJoin(
              AddOnModel,
              eq(AddOnModel.id, SubscriptionAddOnModel.addOnId)
            )
            .where(
              and(
                eq(SubscriptionAddOnModel.subscriptionId, sub.id),
                eq(SubscriptionAddOnModel.status, 'active')
              )
            )
        : [];
    // Renewing onto the scheduled plan: add-ons it doesn't allow are dropped, others capped.
    const switching =
      pricing === 'renewal' && !!current && current.plan.id !== plan.id;
    const switchDrops: string[] = [];
    if (switching) {
      const caps = await AddOnChangeService.capsForVersion(version.id);
      for (let i = addOnRows.length - 1; i >= 0; i--) {
        const r = addOnRows[i]!;
        const cap = caps.get(r.addOnId);
        const want = r.scheduledQuantity ?? r.quantity;
        const allowed =
          cap === undefined
            ? 0
            : cap === null
              ? want
              : Math.min(want, capInUnits(cap, r.unitValue));
        if (allowed <= 0) {
          switchDrops.push(r.name);
          addOnRows.splice(i, 1);
        } else if (allowed < want) {
          addOnRows[i] = { ...r, scheduledQuantity: allowed };
        }
      }
    }
    const unit = (row: (typeof addOnRows)[number], cycle: Cycle) =>
      toPaise(cycle === 'yearly' ? row.yearlyPrice : row.monthlyPrice);

    const items: PaymentLine[] = [];
    const addOns: AddOnQuote[] = [];
    let periodStart: Date = now;
    let periodEnd: Date;
    let left = 0;
    let creditPaise = 0;
    let addOnPaise = 0;
    let addOnCreditPaise = 0;
    const planLine = (amountPaise: number, extra: Partial<PaymentLine> = {}) =>
      items.push({
        kind: 'plan',
        description: `${plan.name} (${input.cycle})`,
        amountPaise,
        planVersionId: version.id,
        billingCycle: input.cycle,
        quantity: 1,
        ...extra,
      });

    if (pricing === 'purchase') {
      periodEnd = nextPeriodEnd(now, input.cycle, anchorDayOf(now));
      planLine(pricePaise);
    } else if (pricing === 'renewal') {
      periodStart = sub!.currentPeriodEnd!;
      periodEnd = nextPeriodEnd(
        periodStart,
        input.cycle,
        sub!.billingAnchorDay ?? anchorDayOf(periodStart)
      );
      planLine(pricePaise, {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      });
      for (const row of addOnRows) {
        const quantity = row.scheduledQuantity ?? row.quantity;
        if (quantity <= 0) continue;
        const amount = unit(row, input.cycle) * quantity;
        addOnPaise += amount;
        items.push({
          kind: 'addon',
          description: row.name,
          amountPaise: amount,
          addOnId: row.addOnId,
          quantity,
          billingCycle: input.cycle,
        });
        addOns.push(
          PlanPricingService.addOnQuote(row, quantity, amount, 0, 0, false)
        );
      }
      // Add-ons bought while an earlier try was pending already paid for this period.
      const prepaid = await PlanPricingService.prepaidAddOns(
        sub!.id,
        periodStart,
        periodEnd
      );
      if (prepaid > 0) {
        items.push({
          kind: 'proration_credit',
          description: 'Add-ons already paid for this period',
          amountPaise: -Math.min(prepaid, addOnPaise),
        });
      }
    } else {
      // Upgrade and monthly → yearly both credit what is left of the current period.
      const end = sub!.currentPeriodEnd!;
      left = daysLeft(now, end);
      const period = daysInPeriod(sub!.currentPeriodStart, end);
      creditPaise = prorate(toPaise(currentPrice ?? 0), left, period);
      if (pricing === 'upgrade') {
        periodEnd = end;
        planLine(prorate(pricePaise, left, period), { days: left });
        for (const row of addOnRows) {
          addOns.push(
            PlanPricingService.addOnQuote(row, row.quantity, 0, 0, left, true)
          );
        }
      } else {
        periodEnd = nextPeriodEnd(now, 'yearly', anchorDayOf(now));
        planLine(pricePaise);
        for (const row of addOnRows) {
          const amount = unit(row, 'yearly') * row.quantity;
          const credit = prorate(
            unit(row, 'monthly') * row.quantity,
            left,
            period
          );
          addOnPaise += amount;
          addOnCreditPaise += credit;
          items.push({
            kind: 'addon',
            description: row.name,
            amountPaise: amount,
            addOnId: row.addOnId,
            quantity: row.quantity,
            billingCycle: 'yearly',
          });
          addOns.push(
            PlanPricingService.addOnQuote(
              row,
              row.quantity,
              amount,
              credit,
              left,
              false
            )
          );
        }
      }
      items.push({
        kind: 'proration_credit',
        description: `Unused days of ${current!.plan.name}`,
        amountPaise: -(creditPaise + addOnCreditPaise),
        days: left,
      });
    }

    const subtotalPaise = items.reduce((s, l) => s + l.amountPaise, 0);
    let discountPaise = 0;
    let couponId: number | null = null;
    if (input.couponCode) {
      const planAmount = items.find((l) => l.kind === 'plan')!.amountPaise;
      const result = await couponService.validateCoupon({
        code: input.couponCode,
        clinicId: input.clinicId,
        orderValue: Number(fromPaise(planAmount)),
        planId: plan.id,
        billingCycle: input.cycle,
      });
      if (!result.valid) {
        throw new HttpError(
          400,
          result.message || 'This coupon cannot be used.'
        );
      }
      discountPaise = Math.min(subtotalPaise, toPaise(result.discountAmount));
      couponId = result.coupon?.id ?? null;
      if (discountPaise > 0) {
        items.push({
          kind: 'coupon',
          description: `Coupon ${input.couponCode.toUpperCase()}`,
          amountPaise: -discountPaise,
          couponCode: input.couponCode.toUpperCase(),
        });
      }
    }

    // GST in force today; a renewal is quoted again on its own charge day.
    const tax = await TaxService.inForce(now);
    // CGST + SGST or IGST is looked up only when GST is shown on top.
    const split =
      tax.mode === 'exclusive'
        ? await TaxService.splitFor(input.clinicId)
        : null;
    const taxed = withTax(subtotalPaise - discountPaise, tax, split);
    if (taxed.line) items.push(taxed.line);

    const futureRenewalNetPaise =
      pricePaise +
      addOnRows.reduce(
        (s, row) =>
          s + unit(row, input.cycle) * (row.scheduledQuantity ?? row.quantity),
        0
      );

    const futureRenewalPaise = applyTax(futureRenewalNetPaise, tax).totalPaise;

    // What AutoPay would be approved for on this plan (monthly only).
    const autoPayLimit =
      input.cycle === 'monthly'
        ? AutoPayLimitService.forRenewal(futureRenewalPaise)
        : null;

    return {
      case: pricing,
      autoPayLimit,
      kind: (pricing === 'purchase'
        ? 'plan_purchase'
        : pricing === 'renewal'
          ? 'renewal'
          : 'plan_change') as 'plan_purchase' | 'renewal' | 'plan_change',
      plan,
      version,
      cycle: input.cycle,
      subscriptionId: paid || trialRenewal ? sub!.id : null,
      items,
      pricePaise,
      creditPaise,
      addOnPaise,
      addOnCreditPaise,
      subtotalPaise: subtotalPaise,
      discountPaise,
      couponId,
      couponCode: couponId ? input.couponCode!.toUpperCase() : null,
      amountPaise: taxed.totalPaise,
      tax,
      split,
      taxPaise: taxed.taxPaise,
      prorationDays: left,
      periodStart,
      periodEnd,
      futureRenewalPaise,
      addOns,
      switchDrops,
      current: current
        ? {
            planName: current.plan.name,
            billingCycle: currentCycle,
            expiresAt: sub!.currentPeriodEnd,
          }
        : null,
    };
  }

  /** Next-period add-on money paid in captured purchases whose cover ends with this period. */
  private static async prepaidAddOns(
    subscriptionId: string,
    periodStart: Date,
    periodEnd: Date
  ) {
    const rows = await database
      .select({ lines: SubscriptionPaymentModel.lines })
      .from(SubscriptionPaymentModel)
      .where(
        and(
          eq(SubscriptionPaymentModel.subscriptionId, subscriptionId),
          eq(SubscriptionPaymentModel.kind, 'addon_purchase'),
          eq(SubscriptionPaymentModel.status, 'captured'),
          // Paid ahead only in the few days before this period, so older purchases are never read.
          gte(
            SubscriptionPaymentModel.createdAt,
            new Date(periodStart.getTime() - 7 * 24 * 60 * 60 * 1000)
          )
        )
      );
    const end = periodEnd.toISOString();
    return rows
      .flatMap((r) => r.lines.items)
      .filter((l) => l.kind === 'addon' && l.periodEnd === end)
      .reduce((s, l) => s + (l.nextPeriodPaise ?? 0), 0);
  }

  private static addOnQuote(
    row: { id: string; addOnId: string; name: string },
    quantity: number,
    amountPaise: number,
    creditPaise: number,
    left: number,
    carriedForward: boolean
  ): AddOnQuote {
    const rupees = (p: number) => Number(fromPaise(p));
    return {
      clinicAddOnId: row.id,
      addOnId: row.addOnId,
      name: row.name,
      quantity,
      newCyclePrice: rupees(amountPaise),
      credit: rupees(creditPaise),
      prorationDays: left,
      proratedAmount: rupees(amountPaise),
      remainingDays: left,
      carriedForward,
      payable: rupees(amountPaise - creditPaise),
    };
  }

  /** The PlanQuote shape the billing screens read; amounts in rupees. */
  static toResponse(q: Awaited<ReturnType<typeof PlanPricingService.quote>>) {
    const r = (paise: number) => Number(fromPaise(paise));
    const monthly = q.version.monthlyPrice;
    const yearly = q.version.yearlyPrice;
    const yearlySavings =
      q.cycle === 'yearly' && monthly !== null && yearly !== null
        ? Math.max(0, Number(monthly) * 12 - Number(yearly))
        : 0;
    return {
      plan: {
        id: q.plan.id,
        name: q.plan.name,
        slug: q.plan.slug,
        billingCycle: q.cycle,
      },
      currency: 'INR',
      basePrice: r(q.pricePaise),
      periodPrice: r(q.pricePaise),
      yearlySavings,
      prorationCredit: r(q.creditPaise),
      prorationDays: q.prorationDays,
      addOns: q.addOns,
      addOnTotal: r(q.addOnPaise),
      addOnCredit: r(q.addOnCreditPaise),
      carriedForwardAddOnValue: 0,
      couponCode: q.couponCode,
      couponId: q.couponId,
      couponDiscount: r(q.discountPaise),
      subtotal: r(q.subtotalPaise),
      totalPayable: r(q.amountPaise),
      // Shown only when GST is added on top; inclusive GST is already in the prices.
      gst:
        q.tax.mode === 'exclusive'
          ? {
              ratePercent: q.tax.rateBp / 100,
              amount: r(q.taxPaise),
              label: gstLabel(q.tax, q.split),
            }
          : null,
      expiresAt: q.periodEnd.toISOString(),
      preservesBillingPeriod: q.case === 'upgrade',
      isCycleChange: q.case === 'to_yearly',
      isRenewal: q.case === 'renewal',
      futureRenewalAmount: r(q.futureRenewalPaise),
      // Add-ons the scheduled plan doesn't allow; they end with the switch.
      switchDrops: q.switchDrops,
      upiAutoPayEligible: r(q.futureRenewalPaise) <= MAX_UPI_LIMIT,
      maxUpiLimit: MAX_UPI_LIMIT,
      // The AutoPay limit checkout sends to Razorpay, with what it is made of; monthly plans only.
      ...(q.autoPayLimit
        ? limitResponse(q.autoPayLimit)
        : { autoPayLimit: null }),
      currentSubscription: q.current
        ? {
            planName: q.current.planName,
            billingCycle: q.current.billingCycle,
            expiresAt: q.current.expiresAt?.toISOString() ?? null,
          }
        : null,
    };
  }
}
