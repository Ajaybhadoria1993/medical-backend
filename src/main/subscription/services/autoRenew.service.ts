import { and, eq, gte, isNull, or } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { HttpError } from '../../../middlewear/errorHandler';
import { razorpayInstance } from '../../../utils/razorpay';
import { envConfig } from '../../../utils/envConfig';
import logger from '../../../utils/logger';
import {
  ClinicSubscriptionModel,
  SubscriptionPlanModel,
} from '../models/subscription.model';
import { AddOnModel, ClinicAddOnModel } from '../models/addon.model';
import {
  billingCycleFromProviderId,
  isYearlyProviderId,
  planPriceForCycle,
  providerIdForCycle,
} from '../utils/billingCycle.utils';
import { SubscriptionActivityService } from './subscriptionActivity.service';

/** Minimal shape of a Razorpay Subscription response (SDK types incomplete). */
interface RazorpaySubscriptionResponse {
  id: string;
  short_url: string;
  status: string;
}

/**
 * Auto-Renewal Service
 *
 * Manages Razorpay recurring subscriptions for automatic billing.
 *
 * Flow:
 * 1. Clinic enables auto-pay → creates a Razorpay subscription plan + subscription
 * 2. Razorpay charges automatically before each period ends
 * 3. Webhook (subscription.charged) extends the clinic's subscription
 * 4. Clinic disables auto-pay → cancels Razorpay subscription
 */
export class AutoRenewService {
  /**
   * Sum the per-cycle price of all active, non-cancelled, non-expired add-ons
   * for a clinic, using the master AddOnModel price that matches the
   * subscription's billing cycle (so add-ons renew at their true recurring
   * rate — NOT the pro-rated first-purchase price).
   *
   * Returns the total in rupees.
   */
  static async computeAddOnRecurringTotal(
    clinicId: string,
    isYearly: boolean
  ): Promise<number> {
    const now = new Date();
    const rows = await database
      .select({
        quantity: ClinicAddOnModel.quantity,
        monthlyPrice: AddOnModel.monthlyPrice,
        yearlyPrice: AddOnModel.yearlyPrice,
      })
      .from(ClinicAddOnModel)
      .innerJoin(AddOnModel, eq(ClinicAddOnModel.addOnId, AddOnModel.id))
      .where(
        and(
          eq(ClinicAddOnModel.clinicId, clinicId),
          eq(ClinicAddOnModel.isActive, true),
          // Skip add-ons the user scheduled for removal — they won't renew.
          eq(ClinicAddOnModel.cancelAtPeriodEnd, false),
          or(
            isNull(ClinicAddOnModel.expiresAt),
            gte(ClinicAddOnModel.expiresAt, now)
          )
        )
      );

    return rows.reduce((sum, r) => {
      const unit = isYearly ? Number(r.yearlyPrice) : Number(r.monthlyPrice);
      return sum + unit * (r.quantity ?? 1);
    }, 0);
  }

  /**
   * Compute the full recurring amount (base plan + active add-ons) in paise.
   */
  static async computeRecurringAmountPaise(
    clinicId: string,
    planPrice: number,
    isYearly: boolean
  ): Promise<number> {
    const base = planPriceForCycle(planPrice, isYearly ? 'yearly' : 'monthly');
    const addOnTotal = await this.computeAddOnRecurringTotal(
      clinicId,
      isYearly
    );
    return Math.round((base + addOnTotal) * 100);
  }

  /**
   * Enable auto-renewal for a clinic's active subscription.
   * Creates a Razorpay subscription that auto-charges at each billing cycle.
   *
   * Returns a short_url for the customer to authorize the payment mandate.
   */
  static async enableAutoRenew(clinicId: string) {
    // Get the active subscription
    const [subscription] = await database
      .select({
        id: ClinicSubscriptionModel.id,
        planId: ClinicSubscriptionModel.planId,
        expiresAt: ClinicSubscriptionModel.expiresAt,
        providerSubscriptionId: ClinicSubscriptionModel.providerSubscriptionId,
        autoRenew: ClinicSubscriptionModel.autoRenew,
        razorpaySubscriptionId: ClinicSubscriptionModel.razorpaySubscriptionId,
      })
      .from(ClinicSubscriptionModel)
      .where(
        and(
          eq(ClinicSubscriptionModel.clinicId, clinicId),
          eq(ClinicSubscriptionModel.active, true)
        )
      )
      .limit(1);

    if (!subscription) {
      throw new HttpError(404, 'No active subscription found');
    }

    if (subscription.autoRenew && subscription.razorpaySubscriptionId) {
      throw new HttpError(400, 'Auto-renewal is already enabled');
    }

    // Get plan details
    const [plan] = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, subscription.planId))
      .limit(1);

    if (!plan || plan.slug === 'solo' || plan.slug === 'Free') {
      throw new HttpError(
        400,
        'Auto-renewal is not available for the Free plan'
      );
    }

    // Determine billing cycle from providerSubscriptionId
    const isYearly = isYearlyProviderId(subscription.providerSubscriptionId);
    const periodUnit = isYearly ? 'yearly' : 'monthly';
    const interval = 1;

    // Calculate recurring amount in paise: base plan + active add-ons.
    // This ensures add-ons are billed on every auto-renewal cycle.
    const addOnTotal = await this.computeAddOnRecurringTotal(
      clinicId,
      isYearly
    );
    const baseAmount = planPriceForCycle(plan.price, periodUnit);
    const amount = Math.round((baseAmount + addOnTotal) * 100);

    // Descriptive item name shown on the Razorpay authorization page.
    const itemName =
      addOnTotal > 0 ? `${plan.name} Plan + Add-ons` : `${plan.name} Plan`;

    try {
      // Create a Razorpay Plan (if not already existing — idempotent by naming)
      const razorpayPlanId = await this.getOrCreateRazorpayPlan(
        plan.id,
        itemName,
        amount,
        periodUnit,
        interval
      );

      // Create a Razorpay Subscription
      // Set start_at to the current subscription's expiry so the first
      // auto-charge happens only at the next renewal — NOT immediately.
      const startAt = subscription.expiresAt
        ? Math.floor(new Date(subscription.expiresAt).getTime() / 1000)
        : undefined;

      // Clean up any stale pending mandate from a previous, un-authorized
      // attempt so we don't leave orphaned Razorpay subscriptions.
      if (subscription.razorpaySubscriptionId) {
        try {
          await razorpayInstance.subscriptions.cancel(
            subscription.razorpaySubscriptionId,
            false // immediate — the old one was never authorized
          );
        } catch {
          // ignore — it may already be cancelled/expired
        }
      }

      const razorpaySub = (await razorpayInstance.subscriptions.create({
        plan_id: razorpayPlanId,
        total_count: isYearly ? 10 : 120, // max billing cycles
        quantity: 1,
        ...(startAt ? { start_at: startAt } : {}),
        notes: {
          clinicId,
          planId: plan.id,
          billingCycle: periodUnit,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)) as unknown as RazorpaySubscriptionResponse;

      // Store the mandate reference but keep AutoPay DISABLED until the
      // customer authorizes it. The `subscription.authenticated` webhook
      // flips autoRenew=true once the mandate is confirmed by Razorpay.
      // This prevents the UI showing "AutoPay enabled" when the user
      // closed the authorization page without completing it.
      await database
        .update(ClinicSubscriptionModel)
        .set({
          autoRenew: false,
          razorpaySubscriptionId: razorpaySub.id,
          cancelAtPeriodEnd: false, // re-enable renewal if it was cancelled
          cancelledAt: null,
          cancellationReason: null,
          updatedAt: new Date(),
        })
        .where(eq(ClinicSubscriptionModel.id, subscription.id));

      // Logged as "requested", not "enabled" — the mandate is still
      // unauthorized at this point. The matching 'autopay_authorized' row is
      // written by the subscription.authenticated webhook.
      await SubscriptionActivityService.record({
        clinicId,
        type: 'autopay_enabled',
        title: 'AutoPay setup started',
        description:
          'Waiting for you to authorize the payment mandate with your bank.',
        metadata: {
          subscriptionId: subscription.id,
          razorpaySubscriptionId: razorpaySub.id,
          status: razorpaySub.status,
        },
      });

      // Invalidate cache
      await redisClient.del(`clinic_plan:${clinicId}`);
      await redisClient.del(`clinic_active_subscription:${clinicId}`);

      return {
        enabled: false,
        pendingAuthorization: true,
        razorpaySubscriptionId: razorpaySub.id,
        shortUrl: razorpaySub.short_url, // Customer authorizes here
        status: razorpaySub.status,
        keyId: envConfig.RAZORPAY_KEY_ID,
      };
    } catch (error: any) {
      logger.error('Failed to enable auto-renewal:', {
        statusCode: error?.statusCode,
        error: error?.error,
        message: error?.message,
        body: error?.body,
      });
      if (error instanceof HttpError) throw error;
      const description =
        error?.error?.description ||
        error?.message ||
        (error?.statusCode
          ? `Razorpay returned HTTP ${error.statusCode}`
          : 'Unknown error');
      throw new HttpError(500, `Failed to enable auto-renewal: ${description}`);
    }
  }

  /**
   * Subscribe to a paid plan WITH AutoPay in one flow.
   *
   * Quotes the purchase (including proration credit from active subscription,
   * add-ons, or coupons) to determine the initial prorated total.
   * Sets up a Razorpay Subscription for the full recurring amount starting at the
   * end of the initial period, and attaches an upfront charge for the initial period.
   *
   * Returns the hosted `shortUrl` for the customer to pay + authorize.
   */
  static async subscribeWithAutoPay(
    clinicId: string,
    planId: string,
    billingCycle: 'monthly' | 'yearly',
    couponCode?: string | null
  ) {
    const [plan] = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, planId))
      .limit(1);

    if (!plan) throw new HttpError(400, 'Invalid plan');
    if (plan.slug === 'solo' || plan.slug === 'Free') {
      throw new HttpError(400, 'AutoPay is not available for the Free plan');
    }

    const periodUnit = billingCycle === 'yearly' ? 'yearly' : 'monthly';

    // 1. Calculate the initial quote for this purchase (proration credit + add-ons + coupon)
    const { PricingService } = await import('./pricing.service');
    const quote = await PricingService.quotePlanPurchase({
      clinicId,
      planId,
      billingCycle: periodUnit,
      couponCode,
      commitCoupon: false,
    });

    const initialAmountPaise = Math.round(quote.totalPayable * 100);

    // 2. Compute recurring full plan price + active recurring add-ons
    const recurringAmountPaise = await this.computeRecurringAmountPaise(
      clinicId,
      Number(plan.price),
      periodUnit === 'yearly'
    );

    const addOnTotal = await this.computeAddOnRecurringTotal(
      clinicId,
      periodUnit === 'yearly'
    );
    const itemName =
      addOnTotal > 0 ? `${plan.name} Plan + Add-ons` : `${plan.name} Plan`;

    try {
      const razorpayPlanId = await this.getOrCreateRazorpayPlan(
        plan.id,
        itemName,
        recurringAmountPaise,
        periodUnit,
        1
      );

      let startAt: number | undefined = undefined;
      const addonsPayload: Array<{
        item: { name: string; amount: number; currency: string };
      }> = [];

      // If initial charge is prorated/discounted or differs from standard recurring charge:
      if (
        quote.prorationCredit > 0 ||
        quote.couponDiscount > 0 ||
        initialAmountPaise !== recurringAmountPaise
      ) {
        if (initialAmountPaise > 0) {
          addonsPayload.push({
            item: {
              name: `${plan.name} Plan (Initial Period)`,
              amount: initialAmountPaise,
              currency: 'INR',
            },
          });
        }
        if (quote.expiresAt) {
          startAt = Math.floor(new Date(quote.expiresAt).getTime() / 1000);
        }
      }

      const createPayload: any = {
        plan_id: razorpayPlanId,
        total_count: periodUnit === 'yearly' ? 10 : 120,
        quantity: 1,
        customer_notify: 1,
        ...(startAt ? { start_at: startAt } : {}),
        ...(addonsPayload.length > 0 ? { addons: addonsPayload } : {}),
        notes: {
          clinicId,
          planId: plan.id,
          billingCycle: periodUnit,
          purpose: 'initial-subscribe',
          initialAmount: String(quote.totalPayable),
          ...(quote.prorationCredit > 0
            ? { prorationCredit: String(quote.prorationCredit) }
            : {}),
          ...(quote.couponCode ? { couponCode: quote.couponCode } : {}),
          ...(quote.couponDiscount > 0
            ? { discountAmount: String(quote.couponDiscount) }
            : {}),
          ...(quote.couponId ? { couponId: String(quote.couponId) } : {}),
        },
      };

      // 1. Create the Razorpay subscription mandate FIRST before committing DB changes
      const razorpaySub = (await razorpayInstance.subscriptions.create(
        createPayload
      )) as unknown as RazorpaySubscriptionResponse;

      // Track pending AutoPay subscription in Redis so status polls and my-subscription
      // can immediately activate the upgraded plan as soon as Razorpay authorization completes.
      await redisClient.setex(
        `pending_autopay_subscription:${clinicId}`,
        86400,
        razorpaySub.id
      );

      // 2. If initial amount is completely covered by credit/coupon (0 payable), activate initial period directly
      // now that Razorpay subscription creation succeeded.
      if (initialAmountPaise <= 0) {
        try {
          const { SubscriptionService } =
            await import('./subscription.service');
          const sub = await SubscriptionService.subscribeClinic({
            clinicId,
            planId,
            provider: quote.couponId ? 'coupon' : 'credit',
            providerSubscriptionId: providerIdForCycle(periodUnit),
            paymentMode: quote.couponId ? 'coupon' : 'credit',
            paymentStatus: 'success',
            price: '0',
            discountAmount: quote.couponDiscount,
          });

          await PricingService.realignAddOnsToPeriod({
            clinicId,
            expiresAt: sub?.expiresAt ? new Date(sub.expiresAt) : null,
            billingCycle: periodUnit,
          });

          if (quote.couponId && quote.couponCode) {
            const { couponService } = await import('./coupon.service');
            await couponService.recordUsage({
              couponId: quote.couponId,
              clinicId,
              planId,
              orderValue: quote.subtotal,
              discountAmount: quote.couponDiscount,
              finalAmount: 0,
              billingCycle: periodUnit,
            });
          }

          if (sub?.id) {
            await database
              .update(ClinicSubscriptionModel)
              .set({
                razorpaySubscriptionId: razorpaySub.id,
                updatedAt: new Date(),
              })
              .where(eq(ClinicSubscriptionModel.id, sub.id));
          }
        } catch (dbError) {
          try {
            await razorpayInstance.subscriptions.cancel(razorpaySub.id, false);
          } catch (cancelErr) {
            logger.error(
              'Failed to cancel Razorpay subscription after DB failure:',
              cancelErr
            );
          }
          throw dbError;
        }
      }

      return {
        subscriptionId: razorpaySub.id,
        shortUrl: razorpaySub.short_url,
        status: razorpaySub.status,
        amount: quote.totalPayable,
        planId: plan.id,
        billingCycle: periodUnit,
        keyId: envConfig.RAZORPAY_KEY_ID,
        quote,
      };
    } catch (error: any) {
      logger.error('Failed to create AutoPay subscription:', error);
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        `Failed to start AutoPay subscription: ${error?.error?.description || error.message || 'Unknown error'}`
      );
    }
  }

  /**
   * Disable auto-renewal. Cancels the Razorpay subscription.
   * The current plan remains active until expiresAt.
   */
  static async disableAutoRenew(clinicId: string) {
    const [subscription] = await database
      .select({
        id: ClinicSubscriptionModel.id,
        autoRenew: ClinicSubscriptionModel.autoRenew,
        razorpaySubscriptionId: ClinicSubscriptionModel.razorpaySubscriptionId,
      })
      .from(ClinicSubscriptionModel)
      .where(
        and(
          eq(ClinicSubscriptionModel.clinicId, clinicId),
          eq(ClinicSubscriptionModel.active, true)
        )
      )
      .limit(1);

    if (!subscription) {
      throw new HttpError(404, 'No active subscription found');
    }

    // Allow disabling when AutoPay is enabled OR when a mandate is pending
    // authorization (razorpaySubscriptionId set but autoRenew still false).
    if (!subscription.autoRenew && !subscription.razorpaySubscriptionId) {
      throw new HttpError(400, 'Auto-renewal is not enabled');
    }

    // Cancel the Razorpay subscription. The cancel mode depends on state:
    // - `active` (a billing cycle is running) → cancel_at_cycle_end=true so
    //   the current paid period completes.
    // - `created` / `authenticated` / `pending` (billing hasn't started —
    //   e.g. start_at is still in the future) → cancel immediately, because
    //   Razorpay rejects cycle-end cancellation with "no billing cycle is
    //   going on".
    if (subscription.razorpaySubscriptionId) {
      try {
        let cancelAtCycleEnd = true;
        try {
          const rzpSub = await razorpayInstance.subscriptions.fetch(
            subscription.razorpaySubscriptionId
          );
          cancelAtCycleEnd = rzpSub?.status === 'active';
        } catch {
          // If we can't fetch status, default to immediate cancel —
          // it's the safer choice for un-started mandates.
          cancelAtCycleEnd = false;
        }

        await razorpayInstance.subscriptions.cancel(
          subscription.razorpaySubscriptionId,
          cancelAtCycleEnd
        );
      } catch (error: any) {
        const detail =
          error?.error?.description ||
          error?.message ||
          (typeof error === 'object' ? JSON.stringify(error) : String(error));
        // If it's already cancelled/completed, that's fine — otherwise
        // retry once with immediate cancellation as a fallback.
        logger.warn(
          `Cycle-end cancel failed for ${subscription.razorpaySubscriptionId}: ${detail}. Retrying immediate cancel.`
        );
        try {
          await razorpayInstance.subscriptions.cancel(
            subscription.razorpaySubscriptionId,
            false
          );
        } catch (retryErr: any) {
          logger.error(
            `Failed to cancel Razorpay subscription ${subscription.razorpaySubscriptionId}: ${retryErr?.error?.description || retryErr?.message || 'unknown'}. Proceeding to disable locally.`
          );
          // Continue — update our DB regardless so the user isn't stuck.
        }
      }
    }

    // Update our record
    await database
      .update(ClinicSubscriptionModel)
      .set({
        autoRenew: false,
        razorpaySubscriptionId: null,
        updatedAt: new Date(),
      })
      .where(eq(ClinicSubscriptionModel.id, subscription.id));

    await SubscriptionActivityService.record({
      clinicId,
      type: 'autopay_disabled',
      title: 'AutoPay turned off',
      description:
        'Your payment mandate was cancelled. Renewals now need to be paid manually.',
      metadata: {
        subscriptionId: subscription.id,
        razorpaySubscriptionId: subscription.razorpaySubscriptionId,
      },
    });

    // Invalidate cache
    await redisClient.del(`clinic_plan:${clinicId}`);
    await redisClient.del(`clinic_active_subscription:${clinicId}`);

    return { enabled: false };
  }

  /**
   * Re-sync the Razorpay recurring amount to match the current base plan +
   * active add-ons. Call this whenever add-ons change (add / remove / qty /
   * schedule-cancel) while AutoPay is enabled.
   *
   * The change is scheduled at `cycle_end` so the customer is never
   * double-charged mid-cycle — the new total takes effect on the next renewal.
   *
   * Best-effort: never throws, so add-on operations don't fail if Razorpay
   * is briefly unavailable. Returns whether a sync was applied.
   */
  static async syncAutoRenewAmount(clinicId: string): Promise<boolean> {
    try {
      const [subscription] = await database
        .select({
          id: ClinicSubscriptionModel.id,
          planId: ClinicSubscriptionModel.planId,
          autoRenew: ClinicSubscriptionModel.autoRenew,
          providerSubscriptionId:
            ClinicSubscriptionModel.providerSubscriptionId,
          razorpaySubscriptionId:
            ClinicSubscriptionModel.razorpaySubscriptionId,
        })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.clinicId, clinicId),
            eq(ClinicSubscriptionModel.active, true)
          )
        )
        .limit(1);

      // Nothing to sync if AutoPay is off or no Razorpay mandate exists.
      if (
        !subscription ||
        !subscription.autoRenew ||
        !subscription.razorpaySubscriptionId
      ) {
        return false;
      }

      const [plan] = await database
        .select()
        .from(SubscriptionPlanModel)
        .where(eq(SubscriptionPlanModel.id, subscription.planId))
        .limit(1);

      if (!plan || plan.slug === 'solo' || plan.slug === 'Free') return false;

      const isYearly = isYearlyProviderId(subscription.providerSubscriptionId);
      const periodUnit = isYearly ? 'yearly' : 'monthly';

      const addOnTotal = await this.computeAddOnRecurringTotal(
        clinicId,
        isYearly
      );
      const baseAmount = planPriceForCycle(plan.price, periodUnit);
      const newAmount = Math.round((baseAmount + addOnTotal) * 100);
      const itemName =
        addOnTotal > 0 ? `${plan.name} Plan + Add-ons` : `${plan.name} Plan`;

      // Razorpay only allows a plan change on subscriptions that are
      // already `active` or `authenticated`. If the mandate hasn't been
      // authorized yet (`created`) — or the subscription is paused/
      // halted/cancelled — a plan update will be rejected. Skip
      // gracefully; the amount will be correct once it becomes active.
      let currentStatus: string | undefined;
      try {
        const rzpSub = await razorpayInstance.subscriptions.fetch(
          subscription.razorpaySubscriptionId
        );
        currentStatus = rzpSub?.status;
      } catch (fetchErr: any) {
        logger.warn(
          `syncAutoRenewAmount: could not fetch Razorpay subscription ${subscription.razorpaySubscriptionId} for clinic ${clinicId}: ${fetchErr?.error?.description || fetchErr?.message || 'unknown'}`
        );
        return false;
      }

      if (currentStatus !== 'active' && currentStatus !== 'authenticated') {
        logger.info(
          `syncAutoRenewAmount: skipping — Razorpay subscription for clinic ${clinicId} is in '${currentStatus}' state (mandate not active yet).`
        );
        return false;
      }

      // Create (or reuse) the Razorpay plan for the new total amount.
      const newRazorpayPlanId = await this.getOrCreateRazorpayPlan(
        plan.id,
        itemName,
        newAmount,
        periodUnit,
        1
      );

      // Schedule the plan change for the next cycle (no mid-cycle charge).
      await razorpayInstance.subscriptions.update(
        subscription.razorpaySubscriptionId,
        {
          plan_id: newRazorpayPlanId,
          schedule_change_at: 'cycle_end',
          // Keep existing remaining count; Razorpay preserves it.
        } as unknown as Record<string, unknown>
      );

      logger.info(
        `AutoPay amount synced for clinic ${clinicId}: new recurring ₹${(newAmount / 100).toFixed(2)} (effective next cycle).`
      );

      await redisClient.del(`clinic_active_subscription:${clinicId}`);
      return true;
    } catch (error: any) {
      // Best-effort: log the full Razorpay error but don't break the
      // add-on operation.
      const detail =
        error?.error?.description ||
        error?.message ||
        (typeof error === 'object' ? JSON.stringify(error) : String(error));
      logger.error(
        `Failed to sync AutoPay amount for clinic ${clinicId}: ${detail}`
      );
      return false;
    }
  }

  /**
   * Get auto-renewal status for a clinic
   */
  static async getAutoRenewStatus(clinicId: string) {
    const [subscription] = await database
      .select({
        id: ClinicSubscriptionModel.id,
        autoRenew: ClinicSubscriptionModel.autoRenew,
        razorpaySubscriptionId: ClinicSubscriptionModel.razorpaySubscriptionId,
        expiresAt: ClinicSubscriptionModel.expiresAt,
        cancelAtPeriodEnd: ClinicSubscriptionModel.cancelAtPeriodEnd,
      })
      .from(ClinicSubscriptionModel)
      .where(
        and(
          eq(ClinicSubscriptionModel.clinicId, clinicId),
          eq(ClinicSubscriptionModel.active, true)
        )
      )
      .limit(1);

    if (!subscription) {
      return {
        autoRenew: false,
        canEnable: false,
        reason: 'No active subscription',
      };
    }

    // Check plan type
    const [sub] = await database
      .select({
        slug: SubscriptionPlanModel.slug,
        planId: ClinicSubscriptionModel.planId,
        providerSubscriptionId: ClinicSubscriptionModel.providerSubscriptionId,
      })
      .from(ClinicSubscriptionModel)
      .innerJoin(
        SubscriptionPlanModel,
        eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
      )
      .where(
        and(
          eq(ClinicSubscriptionModel.clinicId, clinicId),
          eq(ClinicSubscriptionModel.active, true)
        )
      )
      .limit(1);

    const isFreePlan = sub?.slug === 'solo' || sub?.slug === 'Free';

    // Self-heal: check Redis pending_autopay_subscription key FIRST, then active sub's razorpaySubscriptionId.
    const redisPendingSubId = await redisClient.get(
      `pending_autopay_subscription:${clinicId}`
    );
    const pendingSubId =
      redisPendingSubId || subscription.razorpaySubscriptionId;

    let autoRenew = subscription.autoRenew;
    let pendingAuthorization = !subscription.autoRenew && !!pendingSubId;

    if (pendingSubId) {
      try {
        const razorpaySub = (await razorpayInstance.subscriptions.fetch(
          pendingSubId
        )) as unknown as { status: string; notes?: any };

        if (['authenticated', 'active'].includes(razorpaySub.status)) {
          const notes = razorpaySub.notes ?? {};
          const targetProviderSubId = providerIdForCycle(notes.billingCycle);
          const isPlanOrCycleChange =
            (notes.planId && String(notes.planId) !== String(sub?.planId)) ||
            (notes.billingCycle &&
              targetProviderSubId !== sub?.providerSubscriptionId) ||
            !!redisPendingSubId;

          if (isPlanOrCycleChange) {
            await this.activateInitialAutoPaySubscription(pendingSubId);
            autoRenew = true;
            pendingAuthorization = false;
          } else {
            await database
              .update(ClinicSubscriptionModel)
              .set({ autoRenew: true, updatedAt: new Date() })
              .where(eq(ClinicSubscriptionModel.id, subscription.id));
            await redisClient.del(`clinic_active_subscription:${clinicId}`);
            await redisClient.del(`clinic_plan:${clinicId}`);
            autoRenew = true;
            pendingAuthorization = false;
          }
          logger.info(
            `AutoPay reconciled for clinic ${clinicId} via status poll (razorpay status=${razorpaySub.status}).`
          );
        }
      } catch (error: any) {
        logger.warn(
          'Failed to reconcile pending AutoPay mandate with Razorpay',
          {
            clinicId,
            razorpaySubscriptionId: pendingSubId,
            error: error?.message || error,
          }
        );
        if (
          error?.statusCode === 400 ||
          error?.error?.code === 'BAD_REQUEST_ERROR'
        ) {
          if (
            subscription.razorpaySubscriptionId === pendingSubId &&
            subscription.id
          ) {
            await database
              .update(ClinicSubscriptionModel)
              .set({
                razorpaySubscriptionId: null,
                autoRenew: false,
                updatedAt: new Date(),
              })
              .where(eq(ClinicSubscriptionModel.id, subscription.id));
          }
          if (redisPendingSubId === pendingSubId) {
            await redisClient.del(`pending_autopay_subscription:${clinicId}`);
          }
        }
      }
    }

    return {
      autoRenew,
      pendingAuthorization,
      razorpaySubscriptionId: subscription.razorpaySubscriptionId,
      expiresAt: subscription.expiresAt,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      canEnable: !isFreePlan && !subscription.cancelAtPeriodEnd,
      reason: isFreePlan
        ? 'Free plan does not require auto-renewal'
        : subscription.cancelAtPeriodEnd
          ? 'Cannot enable auto-renewal when cancellation is scheduled'
          : undefined,
    };
  }

  /**
   * Activate a clinic's plan on the FIRST charge of a subscribe-with-AutoPay
   * flow. Reads the mandate's notes (clinicId, planId, billingCycle) and
   * creates the active subscription with AutoPay enabled.
   *
   * Idempotent: if a subscription for this paymentId already exists, does
   * nothing.
   */
  static async activateInitialAutoPaySubscription(
    razorpaySubscriptionId: string,
    paymentId?: string
  ) {
    let notes: {
      clinicId?: string;
      planId?: string;
      billingCycle?: string;
      initialAmount?: string;
      couponCode?: string;
      discountAmount?: string;
      couponId?: string;
    } = {};
    try {
      const rzpSub = await razorpayInstance.subscriptions.fetch(
        razorpaySubscriptionId
      );
      notes = (rzpSub?.notes as typeof notes) || {};
    } catch (err: any) {
      logger.error(
        `activateInitialAutoPaySubscription: cannot fetch ${razorpaySubscriptionId}: ${err?.error?.description || err?.message || 'unknown'}`
      );
      throw new HttpError(
        500,
        `Failed to fetch AutoPay subscription from provider: ${err?.error?.description || err?.message || 'unknown'}`
      );
    }

    const {
      clinicId,
      planId,
      billingCycle,
      initialAmount,
      couponCode,
      discountAmount,
      couponId,
    } = notes;
    if (!clinicId || !planId) {
      logger.warn(
        `activateInitialAutoPaySubscription: missing clinicId/planId in notes for ${razorpaySubscriptionId}`
      );
      throw new HttpError(
        400,
        `Subscription metadata missing required clinicId or planId for ${razorpaySubscriptionId}`
      );
    }

    const providerSubscriptionId = providerIdForCycle(billingCycle);

    // Skip if this Razorpay subscription ID is already linked to an active subscription FOR THIS PLAN AND CYCLE
    const alreadyLinked = await database
      .select({ id: ClinicSubscriptionModel.id })
      .from(ClinicSubscriptionModel)
      .where(
        and(
          eq(
            ClinicSubscriptionModel.razorpaySubscriptionId,
            razorpaySubscriptionId
          ),
          eq(ClinicSubscriptionModel.planId, planId),
          eq(
            ClinicSubscriptionModel.providerSubscriptionId,
            providerSubscriptionId
          ),
          eq(ClinicSubscriptionModel.active, true)
        )
      )
      .limit(1);
    if (alreadyLinked.length > 0) return;

    // Idempotency — skip if this payment was already processed for this plan.
    if (paymentId) {
      const existing = await database
        .select({ id: ClinicSubscriptionModel.id })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.transactionId, paymentId),
            eq(ClinicSubscriptionModel.planId, planId)
          )
        )
        .limit(1);
      if (existing.length > 0) return;
    }

    const { SubscriptionService } = await import('./subscription.service');
    const sub = await SubscriptionService.subscribeClinic({
      clinicId,
      planId,
      provider: 'razorpay',
      providerSubscriptionId,
      paymentMode: 'razorpay',
      transactionId: paymentId,
      paymentStatus: 'success',
      price: initialAmount != null ? String(initialAmount) : undefined,
      discountAmount:
        discountAmount != null ? String(discountAmount) : undefined,
    });

    // Realign active add-ons to match the new subscription period
    const { PricingService } = await import('./pricing.service');
    await PricingService.realignAddOnsToPeriod({
      clinicId,
      expiresAt: sub?.expiresAt ? new Date(sub.expiresAt) : null,
      billingCycle: billingCycleFromProviderId(providerSubscriptionId),
    });

    // Record coupon usage if coupon was used
    if (couponId && couponCode && discountAmount) {
      try {
        const { couponService } = await import('./coupon.service');
        await couponService.recordUsage({
          couponId: Number(couponId),
          clinicId,
          planId,
          orderValue: Number(initialAmount || 0) + Number(discountAmount || 0),
          discountAmount: Number(discountAmount),
          finalAmount: Number(initialAmount || 0),
          razorpayPaymentId: paymentId,
          billingCycle: billingCycleFromProviderId(providerSubscriptionId),
        });
      } catch (couponErr) {
        logger.error(
          `activateInitialAutoPaySubscription: failed to record coupon usage for clinic ${clinicId}:`,
          couponErr
        );
      }
    }

    // Link the mandate + enable AutoPay on the newly active subscription.
    await database
      .update(ClinicSubscriptionModel)
      .set({
        autoRenew: true,
        razorpaySubscriptionId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ClinicSubscriptionModel.clinicId, clinicId),
          eq(ClinicSubscriptionModel.active, true)
        )
      );

    await redisClient.del(`clinic_active_subscription:${clinicId}`);
    await redisClient.del(`clinic_plan:${clinicId}`);
    await redisClient.del(`clinic_limits_overview:${clinicId}`);
    await redisClient.del(`pending_autopay_subscription:${clinicId}`);

    logger.info(
      `Initial AutoPay subscription activated for clinic ${clinicId} (${providerSubscriptionId}).`
    );
  }

  /**
   * Handle Razorpay subscription.charged webhook.
   * Extends the clinic's subscription by the billing cycle period.
   */
  static async handleSubscriptionCharged(
    razorpaySubscriptionId: string,
    paymentId: string
  ) {
    // Find the clinic subscription by Razorpay subscription ID
    const [subscription] = await database
      .select()
      .from(ClinicSubscriptionModel)
      .where(
        eq(
          ClinicSubscriptionModel.razorpaySubscriptionId,
          razorpaySubscriptionId
        )
      )
      .limit(1);

    if (!subscription) {
      // No local subscription is linked to this Razorpay subscription yet.
      // This is the FIRST charge of a "subscribe-with-AutoPay" flow —
      // activate the clinic's plan now, from the mandate's notes.
      await this.activateInitialAutoPaySubscription(
        razorpaySubscriptionId,
        paymentId
      );
      return;
    }

    // Razorpay retries this event on any non-2xx or timeout. Without this check
    // each retry would grant another free billing cycle.
    if (subscription.transactionId === paymentId) {
      logger.info(
        `subscription.charged for ${razorpaySubscriptionId} already applied (payment ${paymentId}) — skipping.`
      );
      return;
    }

    // Extend expiry based on billing cycle
    const isYearly = isYearlyProviderId(subscription.providerSubscriptionId);
    const currentExpiry = subscription.expiresAt
      ? new Date(subscription.expiresAt)
      : new Date();
    const newExpiry = new Date(currentExpiry);

    if (isYearly) {
      newExpiry.setFullYear(newExpiry.getFullYear() + 1);
    } else {
      newExpiry.setDate(newExpiry.getDate() + 30);
    }

    // Update the subscription. Also ensure autoRenew is true — a successful
    // recurring charge implies the mandate is authorized and active (safety
    // net in case the `subscription.authenticated` webhook was missed).
    await database
      .update(ClinicSubscriptionModel)
      .set({
        expiresAt: newExpiry,
        transactionId: paymentId,
        paymentStatus: 'success',
        autoRenew: true,
        updatedAt: new Date(),
      })
      .where(eq(ClinicSubscriptionModel.id, subscription.id));

    // Auto-renew active add-ons: extend their expiry to match new subscription expiry
    const { ClinicAddOnModel } = await import('../models/addon.model');
    const { and: andOp } = await import('drizzle-orm');

    // Renew add-ons that are NOT scheduled for cancellation
    await database
      .update(ClinicAddOnModel)
      .set({
        expiresAt: newExpiry,
        updatedAt: new Date(),
      })
      .where(
        andOp(
          eq(ClinicAddOnModel.clinicId, subscription.clinicId),
          eq(ClinicAddOnModel.isActive, true),
          eq(ClinicAddOnModel.cancelAtPeriodEnd, false)
        )
      );

    // Deactivate add-ons that were scheduled for cancellation (and archive scheduled users)
    const { AddOnService } = await import('./addon.service');
    await AddOnService.processExpiredAddOnsForClinic(subscription.clinicId);

    // Invalidate cache
    await redisClient.del(`clinic_plan:${subscription.clinicId}`);
    await redisClient.del(
      `clinic_active_subscription:${subscription.clinicId}`
    );
    await redisClient.del(`clinic_limits_overview:${subscription.clinicId}`);
    await redisClient.del(`clinic_addons:${subscription.clinicId}`);
    await redisClient.del(`clinic_limits:${subscription.clinicId}`);

    logger.info(
      `Auto-renewal charged for clinic ${subscription.clinicId}. New expiry: ${newExpiry.toISOString()}. Active add-ons renewed.`
    );
  }

  /**
   * Get or create a Razorpay Plan for recurring billing.
   * Uses Redis to cache plan IDs.
   */
  private static async getOrCreateRazorpayPlan(
    planId: string,
    planName: string,
    amountInPaise: number,
    period: string,
    interval: number
  ): Promise<string> {
    // Amount is part of the key: a plan+add-on total change must map to a
    // NEW Razorpay plan (Razorpay plan amounts are immutable once created).
    const cacheKey = `razorpay_plan:${planId}:${period}:${amountInPaise}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) return cached;

    try {
      const razorpayPlan: any = await razorpayInstance.plans.create({
        period: period as 'daily' | 'weekly' | 'monthly' | 'yearly',
        interval,
        item: {
          name: `${planName} (${period})`,
          amount: amountInPaise,
          currency: 'INR',
        },
        notes: { internalPlanId: planId },
      });

      // Cache for 30 days
      await redisClient.setex(cacheKey, 86400 * 30, razorpayPlan.id);

      return razorpayPlan.id;
    } catch (error: any) {
      logger.error('Failed to create Razorpay plan:', {
        statusCode: error?.statusCode,
        error: error?.error,
        message: error?.message,
        body: error?.body,
        planId,
        period,
        amountInPaise,
      });
      const description =
        error?.error?.description ||
        error?.message ||
        (error?.statusCode
          ? `Razorpay returned HTTP ${error.statusCode}`
          : 'Unknown error');
      throw new HttpError(
        500,
        `Failed to configure recurring payment plan: ${description}`
      );
    }
  }
}
