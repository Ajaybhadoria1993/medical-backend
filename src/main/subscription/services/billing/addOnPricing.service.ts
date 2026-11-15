import { and, eq, inArray, sql } from 'drizzle-orm';
import { addOnPriceNow } from '../../models/addOnPrice.model';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { CacheKeys, getOrSetCache } from '../../../../utils/cache.util';
import { fromPaise, toPaise } from '../../../money';
import { AddOnModel, PlanAddOnLimitsModel } from '../../models/addon.model';
import { SubscriptionAddOnModel } from '../../models/ownerSubscription.model';
import type { PaymentLine } from '../../types/subscriptionPayment.types';
import type { CouponLine } from '../../utils/coupon.utils';
import {
  daysInPeriod,
  daysLeft,
  prorate,
  type Cycle,
} from '../../utils/planPricing.utils';
import { ofPlanVersion } from '../../utils/planVersionScope';
import { couponService } from '../coupon.service';
import { OwnerSubscriptionService } from '../core/ownerSubscription.service';
import { gstLabel, withTax } from '../../utils/invoiceTax.utils';
import { TaxService } from './tax.service';
import { FEATURE_KEYS, LimitationService } from '../limitation.service';
import { getPackForSale } from '../../../credits';

const rupees = (paise: number) => Number(fromPaise(paise));
const NEEDS_PAID = 'Add-ons need a paid plan.';

type Paid = {
  subscriptionId: string;
  planId: string;
  planVersionId: string;
  cycle: Cycle;
  periodStart: Date;
  periodEnd: Date;
};

/** Whether the clinic's plan lets it buy WhatsApp packs; set per plan by a Super Admin. */
export async function creditPacksAllowed(clinicId: string) {
  const plan = await LimitationService.getClinicActivePlan(clinicId);
  if (!plan) return true;
  const limit = await LimitationService.getPlanLimit(
    plan.planId,
    FEATURE_KEYS.WHATSAPP_CREDIT_PACKS,
    plan.planVersionId
  );
  // Plans made before this switch have no row; they keep selling packs until it is turned off.
  return !limit || limit.enabled;
}

/** Add-ons follow the plan period; a trial counts, priced monthly, and renews with it. Free has none. */
async function paidSubscription(clinicId: string, now: Date) {
  const current = await OwnerSubscriptionService.getCurrent(
    'clinic',
    clinicId,
    now
  );
  const sub = current?.subscription;
  if (
    !current?.state.isValid ||
    current.plan.kind !== 'paid' ||
    !sub ||
    (sub.billingCycle !== 'monthly' &&
      sub.billingCycle !== 'yearly' &&
      !sub.isTrial) ||
    !sub.currentPeriodEnd
  ) {
    return null;
  }
  return {
    subscriptionId: sub.id,
    planId: current.plan.id,
    planVersionId: current.version.id,
    cycle: sub.billingCycle === 'yearly' ? 'yearly' : 'monthly',
    periodStart: sub.currentPeriodStart,
    periodEnd: sub.currentPeriodEnd,
  } satisfies Paid;
}

/** Active add-ons with this plan's cap and what the clinic already has, in one query. */
async function catalog(paid: Paid | null, addOnIds?: string[]) {
  return database
    .select({
      addOn: AddOnModel,
      monthlyNow: addOnPriceNow('monthly'),
      yearlyNow: addOnPriceNow('yearly'),
      maxCap: PlanAddOnLimitsModel.maxCap,
      allowed: PlanAddOnLimitsModel.id,
      owned: SubscriptionAddOnModel.quantity,
    })
    .from(AddOnModel)
    .leftJoin(
      PlanAddOnLimitsModel,
      and(
        eq(PlanAddOnLimitsModel.addOnId, AddOnModel.id),
        paid
          ? ofPlanVersion(PlanAddOnLimitsModel, paid.planVersionId)
          : sql`false`
      )
    )
    .leftJoin(
      SubscriptionAddOnModel,
      and(
        eq(SubscriptionAddOnModel.addOnId, AddOnModel.id),
        paid
          ? eq(SubscriptionAddOnModel.subscriptionId, paid.subscriptionId)
          : sql`false`,
        eq(SubscriptionAddOnModel.status, 'active')
      )
    )
    .where(
      and(
        eq(AddOnModel.isActive, true),
        addOnIds ? inArray(AddOnModel.id, addOnIds) : undefined
      )
    )
    .orderBy(AddOnModel.name);
}

/** null when the plan allows it with no cap; 0 when it is not allowed or full. */
const roomLeft = (row: {
  allowed: string | null;
  maxCap: number | null;
  owned: number | null;
}) =>
  !row.allowed
    ? 0
    : row.maxCap === null
      ? null
      : Math.max(0, row.maxCap - (row.owned ?? 0));

/** The one price for add-ons: /quote shows it and the purchase charges it. */
export class AddOnPricingService {
  /** Names and prices of every active add-on: the same for all clinics, so cached once. */
  static async publicCatalog() {
    return getOrSetCache(CacheKeys.addOnCatalog, 10 * 60, async () => {
      const rows = await database
        .select({
          id: AddOnModel.id,
          name: AddOnModel.name,
          description: AddOnModel.description,
          featureKey: AddOnModel.featureKey,
          currency: AddOnModel.currency,
          monthlyPrice: addOnPriceNow('monthly'),
          yearlyPrice: addOnPriceNow('yearly'),
        })
        .from(AddOnModel)
        .where(eq(AddOnModel.isActive, true))
        .orderBy(AddOnModel.name);
      return rows.map((a) => ({
        ...a,
        monthlyPrice: Number(a.monthlyPrice),
        yearlyPrice: Number(a.yearlyPrice),
      }));
    });
  }

  /** The clinic's side of each add-on: how many it owns, how many more it may buy, and why not. */
  static async availability(clinicId: string, now = new Date()) {
    const rows = await AddOnPricingService.available(clinicId, now);
    return rows.map((r) => ({
      id: r.id,
      maxQuantity: r.maxQuantity,
      billingCycles: r.billingCycles,
      blockedReason: r.blockedReason,
    }));
  }

  static async available(clinicId: string, now = new Date()) {
    const paid = await paidSubscription(clinicId, now);
    const rows = await catalog(paid);
    return rows.map((r) => {
      const price = paid
        ? paid.cycle === 'yearly'
          ? r.yearlyNow
          : r.monthlyNow
        : null;
      const room = roomLeft(r);
      const blockedReason = !paid
        ? NEEDS_PAID
        : !r.allowed
          ? 'Not available on your plan.'
          : price === null
            ? `Not sold ${paid.cycle}.`
            : room === 0
              ? 'You have the most your plan allows.'
              : null;
      return {
        id: r.addOn.id,
        name: r.addOn.name,
        description: r.addOn.description,
        featureKey: r.addOn.featureKey,
        currency: r.addOn.currency,
        monthlyPrice: r.monthlyNow === null ? null : Number(r.monthlyNow),
        yearlyPrice: r.yearlyNow === null ? null : Number(r.yearlyNow),
        billingCycles: paid ? [paid.cycle] : [],
        owned: r.owned ?? 0,
        maxQuantity: blockedReason ? 0 : room,
        blockedReason,
      };
    });
  }

  static async quote(input: {
    clinicId: string;
    addOns: { addOnId: string; quantity: number }[];
    /** A WhatsApp pack bought in the same order: one-time, never pro-rated. */
    creditPackId?: string;
    couponCode?: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const ids = input.addOns.map((a) => a.addOnId);
    if (new Set(ids).size !== ids.length) {
      throw new HttpError(400, 'Each add-on can be listed only once.');
    }
    if (!ids.length && !input.creditPackId) {
      throw new HttpError(400, 'Choose an add-on or a WhatsApp pack.');
    }
    const found = await paidSubscription(input.clinicId, now);
    if (ids.length && !found) throw new HttpError(409, NEEDS_PAID);
    // In the grace days there are no days left to price an add-on on.
    if (ids.length && found!.periodEnd.getTime() <= now.getTime()) {
      throw new HttpError(
        409,
        'Your renewal is due. Renew your plan first, then add add-ons.'
      );
    }
    // Only read below when add-ons are in the order, which needs a paid plan.
    const paid = found!;
    // A renewal already sent to the bank was priced without this add-on, so next period is charged now too.
    const renewal = ids.length
      ? await OwnerSubscriptionService.renewalPending(
          paid.subscriptionId,
          paid.periodEnd
        )
      : null;
    const coverEnd = renewal?.periodEnd ?? paid.periodEnd;

    const rows = new Map(
      ids.length ? (await catalog(paid, ids)).map((r) => [r.addOn.id, r]) : []
    );
    const left = ids.length ? daysLeft(now, paid.periodEnd) : 0;
    const period = ids.length
      ? daysInPeriod(paid.periodStart, paid.periodEnd)
      : 0;
    const items: PaymentLine[] = [];
    const addOns = input.addOns.map(({ addOnId, quantity }) => {
      const row = rows.get(addOnId);
      if (!row) throw new HttpError(400, 'This add-on is not available.');
      const name = row.addOn.name;
      const room = roomLeft(row);
      if (room !== null && quantity > room) {
        throw new HttpError(
          400,
          room === 0
            ? `${name} is not available on your plan, or you already have the most it allows.`
            : `You can add ${room} more ${name} on your plan.`
        );
      }
      const unit = paid.cycle === 'yearly' ? row.yearlyNow : row.monthlyNow;
      if (unit === null)
        throw new HttpError(400, `${name} is not sold ${paid.cycle}.`);
      const fullPaise = toPaise(unit) * quantity;
      const amountPaise =
        prorate(fullPaise, left, period) + (renewal ? fullPaise : 0);
      const days = daysLeft(now, coverEnd);
      items.push({
        kind: 'addon',
        description: renewal
          ? `${name} × ${quantity} (this and next month)`
          : `${name} × ${quantity}`,
        amountPaise,
        addOnId,
        quantity,
        billingCycle: paid.cycle,
        days,
        unitPaise: toPaise(unit),
        periodStart: now.toISOString(),
        periodEnd: coverEnd.toISOString(),
        ...(renewal ? { nextPeriodPaise: fullPaise } : {}),
      });
      return {
        id: addOnId,
        name,
        featureKey: row.addOn.featureKey,
        quantity,
        billingCycle: paid.cycle,
        fullPrice: rupees(fullPaise),
        proRatedPrice: rupees(amountPaise),
        remainingDays: days,
        includesNextPeriod: !!renewal,
      };
    });

    let creditPack: { id: string; credits: number; price: number } | null =
      null;
    if (input.creditPackId) {
      if (!(await creditPacksAllowed(input.clinicId))) {
        throw new HttpError(
          403,
          'WhatsApp packs are not available on your plan.'
        );
      }
      const pack = await getPackForSale(input.creditPackId);
      const amountPaise = toPaise(pack.priceInr);
      items.push({
        kind: 'credits',
        description: `${pack.creditType === 'whatsapp' ? 'WhatsApp messages' : 'Credits'} × ${pack.credits.toLocaleString('en-IN')}`,
        amountPaise,
        packId: pack.id,
        creditType: pack.creditType,
        credits: pack.credits,
        quantity: 1,
      });
      creditPack = {
        id: pack.id,
        credits: pack.credits,
        price: rupees(amountPaise),
      };
    }

    const subtotalPaise = items.reduce((s, l) => s + l.amountPaise, 0);
    let discountPaise = 0;
    let couponId: number | null = null;
    const couponCode = input.couponCode?.trim().toUpperCase() || null;
    if (couponCode && subtotalPaise > 0) {
      const lines: CouponLine[] = items.map((l) => ({
        kind: l.kind === 'credits' ? 'credits' : 'addon',
        addOnId: l.addOnId,
        amountPaise: l.amountPaise,
      }));
      const result = await couponService.validateCoupon({
        code: couponCode,
        clinicId: input.clinicId,
        orderValue: rupees(subtotalPaise),
        lines,
        billingCycle: found?.cycle,
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
          description: `Coupon ${couponCode}`,
          amountPaise: -discountPaise,
          couponCode,
        });
      }
    }

    const tax = await TaxService.inForce(now);
    // CGST + SGST or IGST is looked up only when GST is shown on top.
    const split =
      tax.mode === 'exclusive'
        ? await TaxService.splitFor(input.clinicId)
        : null;
    const taxed = withTax(subtotalPaise - discountPaise, tax, split);
    if (taxed.line) items.push(taxed.line);

    return {
      subscriptionId: found?.subscriptionId ?? null,
      cycle: found?.cycle ?? null,
      periodStart: now,
      periodEnd: found?.periodEnd ?? null,
      items,
      addOns,
      creditPack,
      subtotalPaise,
      discountPaise,
      couponId,
      couponCode: couponId ? couponCode : null,
      amountPaise: taxed.totalPaise,
      tax,
      split,
      taxPaise: taxed.taxPaise,
    };
  }

  /** The /addons/quote response the checkout screen already reads. */
  static toResponse(q: Awaited<ReturnType<typeof AddOnPricingService.quote>>) {
    return {
      currency: 'INR',
      addOns: q.addOns,
      creditPack: q.creditPack,
      fullPrice: q.addOns.reduce((s, a) => s + a.fullPrice, 0),
      subtotal: rupees(q.subtotalPaise),
      discountAmount: rupees(q.discountPaise),
      // Shown only when GST is added on top; inclusive GST is already in the prices.
      gst:
        q.tax.mode === 'exclusive'
          ? {
              ratePercent: q.tax.rateBp / 100,
              amount: rupees(q.taxPaise),
              label: gstLabel(q.tax, q.split),
            }
          : null,
      totalPayable: rupees(q.amountPaise),
      discount: q.couponId
        ? {
            couponCode: q.couponCode!,
            couponId: q.couponId,
            discountAmount: rupees(q.discountPaise),
          }
        : null,
    };
  }
}
