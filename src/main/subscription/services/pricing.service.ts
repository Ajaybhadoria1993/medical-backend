import { and, desc, eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  ClinicSubscriptionModel,
  SubscriptionPlanModel,
} from '../models/subscription.model';
import { AddOnModel, ClinicAddOnModel } from '../models/addon.model';
import {
  BillingCycle,
  CYCLE_DAYS,
  billingCycleFromProviderId,
  planPriceForCycle,
  unusedSubscriptionValue,
  yearlySavings,
} from '../utils/billingCycle.utils';
import { couponService } from './coupon.service';

/**
 * A fully priced plan purchase, broken into the lines the clinic is shown.
 *
 * `totalPayable` is the single number the order is created for. The UI renders
 * these fields rather than recomputing anything, which is what keeps the quoted
 * price and the charged price from drifting apart.
 */
export interface PlanQuote {
  plan: {
    id: string;
    name: string;
    slug: string;
    billingCycle: BillingCycle;
  };
  currency: string;
  /** List price for the selected cycle, before any credit or coupon. */
  basePrice: number;
  /** Saving versus twelve monthly instalments; 0 on a monthly quote. */
  yearlySavings: number;
  /** Unused value carried over from the subscription being replaced. */
  prorationCredit: number;
  prorationDays: number;
  /**
   * Active add-ons carried onto the new cycle. Add-ons are always aligned to
   * the plan's renewal date, so a cycle change has to re-buy them for the new
   * period — otherwise they would expire partway through a year already paid
   * for. Each line is the new period's cost less credit for its unused days.
   */
  addOns: {
    clinicAddOnId: string;
    addOnId: string;
    name: string;
    quantity: number;
    /** Full price of this add-on for the new cycle. */
    newCyclePrice: number;
    /** Credit for the days left on its current period. */
    credit: number;
    /** newCyclePrice − credit, floored at 0. */
    payable: number;
  }[];
  addOnTotal: number;
  addOnCredit: number;
  couponCode: string | null;
  couponId: number | null;
  couponDiscount: number;
  /** basePrice − prorationCredit, floored at 0. */
  subtotal: number;
  /** What the clinic actually pays now. */
  totalPayable: number;
  /** Period end if this quote is purchased. */
  expiresAt: string;
  /** Whether this is a cycle switch on the plan the clinic already holds. */
  isCycleChange: boolean;
  currentSubscription: {
    planName: string | null;
    billingCycle: BillingCycle;
    expiresAt: string | null;
  } | null;
}

export class PricingService {
  /**
   * Carry active add-ons onto a newly-started plan period.
   *
   * Add-ons are sold aligned to the plan's renewal date, so once the plan's
   * period changes theirs has to follow — otherwise a yearly plan keeps add-ons
   * that expire on the old monthly date, and the clinic quietly loses seats
   * partway through a year it has paid for. The prices here are the ones the
   * clinic was quoted and charged in the same order.
   */
  static async realignAddOnsToPeriod({
    clinicId,
    expiresAt,
    billingCycle,
  }: {
    clinicId: string;
    expiresAt: Date | null;
    billingCycle: BillingCycle;
  }): Promise<void> {
    if (!expiresAt) return;

    // Same selection the quote priced, so the rows updated here are the rows
    // the clinic was charged for.
    const rows = await database
      .select({
        id: ClinicAddOnModel.id,
        quantity: ClinicAddOnModel.quantity,
        monthlyPrice: AddOnModel.monthlyPrice,
      })
      .from(ClinicAddOnModel)
      .innerJoin(AddOnModel, eq(AddOnModel.id, ClinicAddOnModel.addOnId))
      .where(
        and(
          eq(ClinicAddOnModel.clinicId, clinicId),
          eq(ClinicAddOnModel.isActive, true),
          eq(ClinicAddOnModel.cancelAtPeriodEnd, false)
        )
      );

    for (const row of rows) {
      await database
        .update(ClinicAddOnModel)
        .set({
          billingCycle,
          startsAt: new Date(),
          expiresAt,
          price: String(
            planPriceForCycle(row.monthlyPrice, billingCycle) * row.quantity
          ),
          updatedAt: new Date(),
        })
        .where(eq(ClinicAddOnModel.id, row.id));
    }
  }

  /**
   * Price a plan purchase for a clinic.
   *
   * `commitCoupon` distinguishes the two callers: a quote only validates the
   * coupon, while the real checkout applies it (which records usage). Both take
   * the same path otherwise, so the preview cannot disagree with the charge.
   */
  static async quotePlanPurchase({
    clinicId,
    planId,
    billingCycle,
    couponCode,
    commitCoupon = false,
    now = new Date(),
  }: {
    clinicId: string;
    planId: string;
    billingCycle: BillingCycle;
    couponCode?: string | null;
    commitCoupon?: boolean;
    now?: Date;
  }): Promise<PlanQuote> {
    const [plan] = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, planId))
      .limit(1);

    if (!plan) {
      throw new HttpError(404, 'Plan not found');
    }

    const basePrice = planPriceForCycle(plan.price, billingCycle);

    const [current] = await database
      .select({
        planId: ClinicSubscriptionModel.planId,
        price: ClinicSubscriptionModel.price,
        startsAt: ClinicSubscriptionModel.startsAt,
        expiresAt: ClinicSubscriptionModel.expiresAt,
        providerSubscriptionId: ClinicSubscriptionModel.providerSubscriptionId,
        planName: SubscriptionPlanModel.name,
      })
      .from(ClinicSubscriptionModel)
      .leftJoin(
        SubscriptionPlanModel,
        eq(SubscriptionPlanModel.id, ClinicSubscriptionModel.planId)
      )
      .where(
        and(
          eq(ClinicSubscriptionModel.clinicId, clinicId),
          eq(ClinicSubscriptionModel.active, true)
        )
      )
      .orderBy(desc(ClinicSubscriptionModel.createdAt))
      .limit(1);

    const currentCycle = billingCycleFromProviderId(
      current?.providerSubscriptionId
    );

    // Replacing a paid subscription mid-period forfeits the days already paid
    // for unless they are credited back here.
    const { credit, remainingDays } = current
      ? unusedSubscriptionValue({
          pricePaid: current.price,
          startsAt: current.startsAt,
          expiresAt: current.expiresAt,
          now,
        })
      : { credit: 0, remainingDays: 0 };

    // Never credit more than the new plan costs — a credit larger than the
    // purchase would otherwise read as the clinic being owed money, which this
    // flow has no way to pay out.
    const prorationCredit = Math.min(credit, basePrice);

    // Add-ons ride along with the plan's period. Re-buying them here is what
    // keeps them alive for the whole of the new cycle; leaving them alone would
    // let them lapse on the old plan's expiry date.
    const addOnLines: PlanQuote['addOns'] = [];
    let addOnTotal = 0;
    let addOnCredit = 0;

    if (current) {
      const rows = await database
        .select({
          clinicAddOnId: ClinicAddOnModel.id,
          addOnId: ClinicAddOnModel.addOnId,
          name: AddOnModel.name,
          quantity: ClinicAddOnModel.quantity,
          monthlyPrice: AddOnModel.monthlyPrice,
          pricePaid: ClinicAddOnModel.price,
          startsAt: ClinicAddOnModel.startsAt,
          expiresAt: ClinicAddOnModel.expiresAt,
        })
        .from(ClinicAddOnModel)
        .innerJoin(AddOnModel, eq(AddOnModel.id, ClinicAddOnModel.addOnId))
        .where(
          and(
            eq(ClinicAddOnModel.clinicId, clinicId),
            eq(ClinicAddOnModel.isActive, true),
            // Add-ons the clinic already asked to drop shouldn't be re-bought.
            eq(ClinicAddOnModel.cancelAtPeriodEnd, false)
          )
        );

      for (const row of rows) {
        const newCyclePrice =
          planPriceForCycle(row.monthlyPrice, billingCycle) * row.quantity;

        const { credit: addOnUnused } = unusedSubscriptionValue({
          pricePaid: row.pricePaid,
          startsAt: row.startsAt,
          expiresAt: row.expiresAt,
          now,
        });

        const lineCredit = Math.min(addOnUnused, newCyclePrice);
        const payable = Math.max(0, newCyclePrice - lineCredit);

        addOnLines.push({
          clinicAddOnId: row.clinicAddOnId,
          addOnId: row.addOnId,
          name: row.name,
          quantity: row.quantity,
          newCyclePrice,
          credit: lineCredit,
          payable,
        });

        addOnTotal += payable;
        addOnCredit += lineCredit;
      }
    }

    const subtotal = Math.max(0, basePrice - prorationCredit) + addOnTotal;

    let couponDiscount = 0;
    let couponId: number | null = null;
    let resolvedCode: string | null = null;

    if (couponCode && subtotal > 0) {
      // The coupon applies to what is actually owed after the credit, not to
      // the list price.
      const result = commitCoupon
        ? await couponService.applyCoupon({
            code: couponCode,
            clinicId,
            orderValue: subtotal,
            planId,
            billingCycle,
          })
        : null;

      if (commitCoupon) {
        if (!result?.success || !result.data) {
          throw new HttpError(400, result?.error || 'Invalid coupon code');
        }
        couponDiscount = result.data.discountAmount;
        couponId = result.data.couponId;
        resolvedCode = result.data.couponCode;
      } else {
        const validation = await couponService.validateCoupon({
          code: couponCode,
          clinicId,
          orderValue: subtotal,
          planId,
          billingCycle,
        });

        if (validation.valid) {
          couponDiscount = validation.discountAmount ?? 0;
          couponId = validation.coupon?.id ?? null;
          couponCode = validation.coupon?.code ?? couponCode;
          resolvedCode = couponCode;
        }
      }
    }

    const totalPayable = Math.max(0, subtotal - couponDiscount);

    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + CYCLE_DAYS[billingCycle]);

    return {
      plan: {
        id: plan.id,
        name: plan.name,
        slug: plan.slug,
        billingCycle,
      },
      currency: plan.currency || 'INR',
      basePrice,
      yearlySavings: yearlySavings(plan.price, billingCycle),
      prorationCredit,
      prorationDays: prorationCredit > 0 ? remainingDays : 0,
      addOns: addOnLines,
      addOnTotal,
      addOnCredit,
      couponCode: resolvedCode,
      couponId,
      couponDiscount,
      subtotal,
      totalPayable,
      expiresAt: expiresAt.toISOString(),
      isCycleChange:
        !!current && current.planId === planId && currentCycle !== billingCycle,
      currentSubscription: current
        ? {
            planName: current.planName ?? null,
            billingCycle: currentCycle,
            expiresAt: current.expiresAt
              ? new Date(current.expiresAt).toISOString()
              : null,
          }
        : null,
    };
  }
}
