import { and, desc, eq, inArray } from 'drizzle-orm';
import { graceUntil as graceUntilOf } from '../../utils/subscriptionState.utils';
import { addOnPriceNow } from '../../models/addOnPrice.model';
import { FirstPlanService } from './firstPlan.service';
import { TrialOverrideService } from './trialOverride.service';
import { database } from '../../../../configurations/dbConnection';
import { AddOnModel, PlanAddOnLimitsModel } from '../../models/addon.model';
import { SubscriptionAddOnModel } from '../../models/ownerSubscription.model';
import { SubscriptionPlanModel } from '../../models/subscription.model';
import { SubscriptionPaymentModel } from '../../models/subscriptionPayment.model';
import type { PlanVersion } from '../../models/planVersion.model';
import {
  addOnLine,
  renewalSummary,
  type Cycle,
} from '../../utils/subscriptionOverview.utils';
import { providerIdForCycle } from '../../utils/billingCycle.utils';
import { LimitationService } from '../limitation.service';
import { OwnerSubscriptionService } from './ownerSubscription.service';
import { SubscriptionReadService } from './subscriptionRead.service';
import { PlansService } from './plans.service';
import { AddOnPricingService } from '../billing/addOnPricing.service';
import { InvoiceService } from '../billing/invoice.service';
import { SubscriptionService } from '../subscription.service';
import { TaxService } from '../billing/tax.service';

/** Rows the billing page shows before "View all invoices". */
const RECENT_INVOICES = 5;

const priceFor = (version: PlanVersion | null, cycle: Cycle) =>
  Number(
    (cycle === 'yearly' ? version?.yearlyPrice : version?.monthlyPrice) ?? 0
  );

/** The /my-subscription response, built from the new tables in the shape the billing screens read. */
export class SubscriptionOverviewService {
  /** Plans (with isActive, so a clinic on a hidden plan can renew it) and add-on prices, both cached. */
  static async catalog() {
    const [plans, addOns, tax] = await Promise.all([
      SubscriptionService.getPlans(),
      AddOnPricingService.publicCatalog(),
      TaxService.inForce(),
    ]);
    // tax.mode lets plan cards say "+ GST" or "incl. GST".
    return { plans, addOns, tax };
  }

  /** The clinic's own billing page data in one round trip; prices come from catalog(). */
  static async page(clinicId: string) {
    const [overview, addOnAvailability, history] = await Promise.all([
      SubscriptionOverviewService.get(clinicId),
      AddOnPricingService.availability(clinicId),
      InvoiceService.history(clinicId),
    ]);
    return {
      ...overview,
      addOnAvailability,
      recentInvoices: history.slice(0, RECENT_INVOICES),
      hasMoreInvoices: history.length > RECENT_INVOICES,
    };
  }

  /** Paid at Razorpay, bank confirmation still awaited (webhook or the daily payment check settles it). */
  private static async paymentProcessing(clinicId: string) {
    const [row] = await database
      .select({ id: SubscriptionPaymentModel.id })
      .from(SubscriptionPaymentModel)
      .where(
        and(
          eq(SubscriptionPaymentModel.ownerType, 'clinic'),
          eq(SubscriptionPaymentModel.ownerId, clinicId),
          eq(SubscriptionPaymentModel.status, 'pending')
        )
      )
      .limit(1);
    return !!row;
  }

  static async get(clinicId: string, now: Date = new Date()) {
    const current = await OwnerSubscriptionService.getCurrent(
      'clinic',
      clinicId,
      now
    );
    const [usage, paymentProcessing, trialRequestedAt, clinicTrialDays] =
      await Promise.all([
        SubscriptionOverviewService.usage(clinicId),
        SubscriptionOverviewService.paymentProcessing(clinicId),
        // A trial asked for before approval; approval starts it.
        FirstPlanService.trialRequestedAt(clinicId),
        // Set by Super Admin for this clinic; null means the trial plan's days.
        TrialOverrideService.daysFor(clinicId),
      ]);
    if (!current) {
      return {
        subscription: null,
        hasActive: false,
        trialRequestedAt,
        clinicTrialDays,
        paymentProcessing,
        addOns: [],
        usage,
        upcomingRenewal: null,
      };
    }

    const { subscription: sub, plan, version, state } = current;
    const isPaidPlan = state.isValid && plan.kind === 'paid';
    // A trial or manual grant has no cycle of its own; it is priced as monthly.
    const cycle: Cycle = sub.billingCycle === 'yearly' ? 'yearly' : 'monthly';

    const [payment] = await database
      .select({
        amountPaise: SubscriptionPaymentModel.amountPaise,
        providerPaymentId: SubscriptionPaymentModel.providerPaymentId,
        paymentMethod: SubscriptionPaymentModel.paymentMethod,
      })
      .from(SubscriptionPaymentModel)
      .where(
        and(
          eq(SubscriptionPaymentModel.ownerType, 'clinic'),
          eq(SubscriptionPaymentModel.ownerId, clinicId),
          eq(SubscriptionPaymentModel.status, 'captured'),
          inArray(SubscriptionPaymentModel.kind, [
            'plan_purchase',
            'plan_change',
            'renewal',
          ])
        )
      )
      .orderBy(desc(SubscriptionPaymentModel.paidAt))
      .limit(1);

    const scheduledPlan = sub.scheduledPlanId
      ? ((
          await database
            .select()
            .from(SubscriptionPlanModel)
            .where(eq(SubscriptionPlanModel.id, sub.scheduledPlanId))
            .limit(1)
        )[0] ?? null)
      : null;
    const scheduledVersion = scheduledPlan
      ? await PlansService.currentVersion(scheduledPlan.id, now)
      : null;
    const renewalCycle: Cycle =
      sub.scheduledBillingCycle === 'yearly' ? 'yearly' : cycle;

    const addOns = isPaidPlan
      ? await SubscriptionOverviewService.addOns(
          sub.id,
          sub.currentPeriodEnd,
          // Price add-ons on the cycle they renew on, the same as the plan.
          renewalCycle,
          scheduledPlan && scheduledVersion
            ? {
                isFree: scheduledPlan.kind === 'free',
                versionId: scheduledVersion.id,
                changeAt: sub.scheduledChangeAt,
              }
            : null
        )
      : [];

    const providerSubscriptionId =
      plan.kind === 'free'
        ? 'default-free'
        : sub.billingCycle === 'none'
          ? 'manual'
          : providerIdForCycle(cycle, plan.slug);

    const graceUntil = graceUntilOf(state, sub.currentPeriodEnd, now);

    // The GST in force on the charge day, so a scheduled change shows before it starts.
    const renewalTax = isPaidPlan
      ? await TaxService.inForce(sub.currentPeriodEnd ?? new Date())
      : undefined;
    const renewalSplit =
      renewalTax?.mode === 'exclusive'
        ? await TaxService.splitFor(clinicId)
        : null;

    return {
      subscription: {
        id: sub.id,
        planId: plan.id,
        planName: plan.name,
        planSlug: plan.slug,
        isTrialPlan: plan.isTrialPlan,
        price: payment ? (payment.amountPaise / 100).toFixed(2) : '0.00',
        startsAt: sub.currentPeriodStart,
        expiresAt: sub.currentPeriodEnd,
        paymentMode: payment?.paymentMethod ?? null,
        paymentStatus: paymentProcessing ? 'pending' : 'success',
        providerSubscriptionId,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        // Set when a Super Admin ends the plan: after this date the clinic renews on the replacement.
        planEndsAt: plan.endsAt,
        replacementPlanId: plan.replacementPlanId,
        scheduledPlanId: sub.scheduledPlanId,
        scheduledPlanChangeAt: sub.scheduledChangeAt,
        isTrial: sub.isTrial,
        // past_due after a failed AutoPay charge; the billing page asks the clinic to pay.
        status: sub.status,
        graceUntil,
        // The one access decision (subscriptionState); screens show this, never re-derive it.
        state: state.state,
      },
      hasActive: state.isValid,
      // A renewal is with the bank: changes made now apply from the period after it.
      renewalProcessing:
        !!sub.currentPeriodEnd &&
        !!(await OwnerSubscriptionService.renewalPending(
          sub.id,
          sub.currentPeriodEnd
        )),
      trialRequestedAt,
      clinicTrialDays,
      paymentProcessing,
      addOns,
      usage,
      upcomingRenewal: isPaidPlan
        ? renewalSummary({
            planName: scheduledPlan?.name ?? plan.name,
            planAmount:
              scheduledPlan?.kind === 'free'
                ? 0
                : priceFor(scheduledVersion ?? version, renewalCycle),
            cycle: renewalCycle,
            nextChargeDate: sub.currentPeriodEnd,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            scheduledPlanName: scheduledPlan?.name ?? null,
            scheduledPlanChangeAt: sub.scheduledChangeAt,
            addOns,
            autoPayOn: await SubscriptionReadService.autoPayOn(clinicId),
            tax: renewalTax,
            split: renewalSplit,
            graceUntil,
            scheduled: sub.currentPeriodEnd
              ? await OwnerSubscriptionService.scheduledRenewal(
                  sub.id,
                  sub.currentPeriodEnd
                )
              : null,
          })
        : null,
    };
  }

  private static async usage(clinicId: string) {
    const [doctors, staff, storage] = await Promise.all([
      LimitationService.checkDoctorLimit(clinicId),
      LimitationService.checkStaffLimit(clinicId),
      LimitationService.checkStorageLimit(clinicId, 0),
    ]);
    const pick = (c: typeof doctors) => ({
      current: c.currentUsage,
      limit: c.limit,
      isUnlimited: c.isUnlimited,
      remaining: c.remaining,
    });
    return {
      doctors: pick(doctors),
      staff: pick(staff),
      storage: {
        ...pick(storage),
        usedMB: storage.usedMB,
        limitMB: storage.limitMB,
        remainingMB: storage.remainingMB,
        unit: 'MB',
      },
    };
  }

  private static async addOns(
    subscriptionId: string,
    periodEnd: Date | null,
    cycle: Cycle,
    scheduled: {
      isFree: boolean;
      versionId: string;
      changeAt: Date | null;
    } | null
  ) {
    const rows = await database
      .select({
        id: SubscriptionAddOnModel.id,
        addOnId: SubscriptionAddOnModel.addOnId,
        quantity: SubscriptionAddOnModel.quantity,
        scheduledQuantity: SubscriptionAddOnModel.scheduledQuantity,
        addOnName: AddOnModel.name,
        featureKey: AddOnModel.featureKey,
        unitValue: AddOnModel.unitValue,
        monthlyPrice: addOnPriceNow('monthly'),
        yearlyPrice: addOnPriceNow('yearly'),
      })
      .from(SubscriptionAddOnModel)
      .innerJoin(AddOnModel, eq(AddOnModel.id, SubscriptionAddOnModel.addOnId))
      .where(
        and(
          eq(SubscriptionAddOnModel.subscriptionId, subscriptionId),
          eq(SubscriptionAddOnModel.status, 'active')
        )
      );

    const caps = scheduled
      ? new Map(
          (
            await database
              .select({
                addOnId: PlanAddOnLimitsModel.addOnId,
                maxCap: PlanAddOnLimitsModel.maxCap,
              })
              .from(PlanAddOnLimitsModel)
              .where(
                eq(PlanAddOnLimitsModel.planVersionId, scheduled.versionId)
              )
          ).map((l) => [l.addOnId, l.maxCap])
        )
      : null;

    return rows.map((r) =>
      addOnLine(r, {
        cycle,
        periodEnd,
        scheduled,
        maxCap: caps?.get(r.addOnId),
      })
    );
  }
}
