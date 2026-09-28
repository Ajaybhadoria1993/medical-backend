// src/main/subscription/services/subscription.service.ts
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  SubscriptionPlanModel,
  ClinicSubscriptionModel,
} from '../models/subscription.model';
import { PlanFeaturesModel } from '../models/planFeatures.model';
import { AddOnModel, ClinicAddOnModel } from '../models/addon.model';
import {
  and,
  eq,
  asc,
  desc,
  inArray,
  isNotNull,
  lte,
  sql,
  or,
} from 'drizzle-orm';
import handlebars from 'handlebars';
import { htmlToPdfBuffer } from '../../../utils/browserPdf';
import { subscriptionInvoiceTemplate } from '../../../htmltamplates/subscriptionInvoice';
import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { SubscriptionActivityService } from './subscriptionActivity.service';
import { ManageFeaturesBodyDto } from '../schemas/subscription.schemas';
import {
  ClinicAssignModel,
  ClinicModel,
} from '../../clinic/models/clinic.model';
import { PharmacyAssignModel } from '../../pharmacy/models/pharmacy.model';
import { UserLabAssignmentsModel } from '../../lab/models/lab.model';
import { UserModel } from '../../users/models/user.model';
import { ne } from 'drizzle-orm';
import {
  billingCycleFromProviderId,
  isYearlyProviderId,
  planPriceForCycle,
} from '../utils/billingCycle.utils';
import { toFeatureKey } from '../utils/featureKey.utils';

interface InvoiceRecord {
  id: string;
  currency?: string | null;
  startsAt?: Date | string | null;
  expiresAt?: Date | string | null;
  createdAt?: Date | string | null;
  paymentMode?: string | null;
  transactionId?: string | null;
  paymentStatus?: string | null;
  price?: string | number | null;
  discount?: string | number | null;
  planName?: string | null;
  planDescription?: string | null;
  clinicName?: string | null;
  clinicAddress?: string | null;
  clinicPhone?: string | null;
  clinicState?: string | null;
  clinicCity?: string | null;
  zipCode?: string | number | null;
  adminName?: string | null;
  adminEmail?: string | null;
  adminMobile?: string | null;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Date rendering for activity-log descriptions. Formatted server-side so the
 * stored sentence reads the same wherever it's shown (timeline, support
 * tooling, exports) rather than depending on the reader's locale.
 */
function activityDate(value: Date | string | null | undefined): string {
  if (!value) return 'period end';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'period end';
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export class SubscriptionService {
  static async createPlan(payload: {
    slug: string;
    name: string;
    description?: string;
    price?: string | number;
    currency?: string;
    features?: {
      name: string;
      description?: string;
    }[];
  }) {
    return database.transaction(async (tx) => {
      // 1️⃣ Create / Update Plan
      const [plan] = await tx
        .insert(SubscriptionPlanModel)
        .values({
          slug: payload.slug,
          name: payload.name,
          description: payload.description,
          price: String(payload.price ?? '0.00'),
          currency: payload.currency ?? 'INR', // default INR
        })
        .onConflictDoUpdate({
          target: [SubscriptionPlanModel.slug],
          set: {
            name: payload.name,
            description: payload.description,
            price: String(payload.price ?? '0.00'),
            currency: payload.currency ?? 'INR',
            updatedAt: new Date(),
          },
        })
        .returning();

      // 2️⃣ Insert / Update Features
      const featuresToInsert = payload.features ?? [];

      for (const feature of featuresToInsert) {
        const featureKey = toFeatureKey(feature.name);

        await tx
          .insert(PlanFeaturesModel)
          .values({
            planId: plan.id,
            featureKey,
            displayName: feature.name,
            description: feature.description ?? '',
            type: 'marketing',
          })
          .onConflictDoUpdate({
            target: [PlanFeaturesModel.planId, PlanFeaturesModel.featureKey],
            set: {
              displayName: feature.name,
              description: feature.description ?? '',
              updatedAt: new Date(),
            },
          });
      }

      return plan;
    });
  }

  static async manageFeatures(planId: string, payload: ManageFeaturesBodyDto) {
    const { add, update, delete: deleteIds } = payload;

    return database.transaction(async (tx) => {
      // 1. Delete features
      if (deleteIds && deleteIds.length > 0) {
        await tx
          .delete(PlanFeaturesModel)
          .where(
            and(
              eq(PlanFeaturesModel.planId, planId),
              inArray(PlanFeaturesModel.id, deleteIds)
            )
          );
      }

      if (update && update.length > 0) {
        for (const feature of update) {
          const { id, name, description } = feature;
          const updateData: Partial<{
            displayName: string;
            description: string;
          }> = {};

          if (description !== undefined) {
            updateData.description = description;
          }

          // Only the display name changes. `featureKey` is the contract the
          // limitation engine looks limits up by (see FEATURE_KEYS) — deriving
          // it from the label would silently disable enforcement on rename.
          if (name) {
            updateData.displayName = name;
          }

          // Only update if there are changes
          if (Object.keys(updateData).length > 0) {
            await tx
              .update(PlanFeaturesModel)
              .set(updateData)
              .where(
                and(
                  eq(PlanFeaturesModel.id, id),
                  eq(PlanFeaturesModel.planId, planId)
                )
              );
          }
        }
      }

      // 3. Add features
      if (add && add.length > 0) {
        const featuresToInsert = add.map((f) => ({
          planId,
          featureKey: toFeatureKey(f.name),
          displayName: f.name,
          description: f.description ?? '',
          type: 'marketing' as const,
          isMarketingFeature: true,
        }));
        await tx.insert(PlanFeaturesModel).values(featuresToInsert);
      }

      // Return all features for the plan after updates
      return tx
        .select()
        .from(PlanFeaturesModel)
        .where(eq(PlanFeaturesModel.planId, planId));
    });
  }

  static async updatePlan(
    id: string,
    payload: {
      slug?: string;
      name?: string;
      description?: string;
      price?: string | number;
      currency?: string;
    }
  ) {
    const [updated] = await database
      .update(SubscriptionPlanModel)
      .set({
        ...(payload.slug !== undefined && { slug: payload.slug }),
        ...(payload.name !== undefined && { name: payload.name }),
        ...(payload.description !== undefined && {
          description: payload.description,
        }),
        ...(payload.price !== undefined && { price: String(payload.price) }),
        ...(payload.currency !== undefined && { currency: payload.currency }),
        updatedAt: new Date(),
      })
      .where(eq(SubscriptionPlanModel.id, id))
      .returning();

    if (!updated) {
      throw new HttpError(404, 'Subscription plan not found');
    }
    return updated;
  }

  static async deletePlan(id: string) {
    const [deleted] = await database
      .delete(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, id))
      .returning();

    if (!deleted) {
      throw new HttpError(404, 'Subscription plan not found');
    }
    return deleted;
  }

  static async getPlans() {
    // Fetch all plans
    const plans = await database
      .select()
      .from(SubscriptionPlanModel)
      .orderBy(asc(SubscriptionPlanModel.price));

    // Fetch features for all plans
    const planIds = plans.map((p) => p.id);
    const features = await database
      .select()
      .from(PlanFeaturesModel)
      .where(inArray(PlanFeaturesModel.planId, planIds))
      .orderBy(
        desc(PlanFeaturesModel.isMarketingFeature),
        asc(PlanFeaturesModel.sortOrder),
        asc(PlanFeaturesModel.createdAt)
      );

    // Attach features to plans
    return plans.map((plan) => ({
      ...plan,
      features: features.filter((f) => f.planId === plan.id),
    }));
  }

  static async getPlanBySlug(slug: string) {
    // Fetch plan by slug
    const [plan] = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.slug, slug))
      .limit(1);

    if (!plan) return null;

    // Fetch features for this plan
    const planFeatures = await database
      .select()
      .from(PlanFeaturesModel)
      .where(eq(PlanFeaturesModel.planId, plan.id))
      .orderBy(
        desc(PlanFeaturesModel.isMarketingFeature),
        asc(PlanFeaturesModel.sortOrder),
        asc(PlanFeaturesModel.createdAt)
      );

    return {
      ...plan,
      features: planFeatures,
    };
  }

  static async subscribeClinic({
    clinicId,
    planId,
    startsAt,
    provider,
    providerSubscriptionId,
    paymentMode,
    transactionId,
    paymentStatus,
    price,
    discountAmount,
  }: {
    clinicId: string;
    planId: string;
    startsAt?: Date;
    provider?: string;
    providerSubscriptionId?: string;
    paymentMode?: string;
    transactionId?: string;
    paymentStatus?: string;
    price?: string | number;
    discountAmount?: string | number;
  }) {
    const startDate = startsAt ?? new Date();

    const plan = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, planId))
      .limit(1)
      .then((res) => res[0]);

    if (!plan) {
      throw new Error('Invalid plan selected');
    }

    let expiresAt: Date | null = null;

    const isFreePlan = plan.slug === 'solo' || plan.slug === 'Free';

    if (isFreePlan) {
      expiresAt = null;
    } else if (isYearlyProviderId(providerSubscriptionId)) {
      expiresAt = addDays(startDate, 365);
    } else {
      expiresAt = addDays(startDate, 30);
    }

    // Deactivate all existing subscriptions for this clinic
    await database
      .update(ClinicSubscriptionModel)
      .set({
        active: false,
        updatedAt: new Date(),
      })
      .where(eq(ClinicSubscriptionModel.clinicId, clinicId));

    const finalPaymentMode = paymentMode || (isFreePlan ? 'free' : 'razorpay');
    const finalTransactionId = transactionId || `txn_${Date.now()}`;
    const finalPaymentStatus =
      paymentStatus || (isFreePlan ? 'success' : 'pending');
    // An explicit price is what the clinic actually paid — after a proration
    // credit or a coupon — and must win over the list price for the cycle.
    // Recomputing it here used to record a fully-discounted yearly plan at full
    // price, which then inflated the credit on the next change.
    const computedPrice =
      price != null
        ? Number(price)
        : planPriceForCycle(
            plan.price,
            billingCycleFromProviderId(providerSubscriptionId)
          );

    const finalPrice = String(computedPrice);
    const finalDiscountAmount =
      discountAmount != null ? String(Number(discountAmount)) : '0.00';

    // Create new subscription entry
    const [sub] = await database
      .insert(ClinicSubscriptionModel)
      .values({
        clinicId,
        planId,
        startsAt: startDate,
        expiresAt,
        active: finalPaymentStatus === 'success',
        provider: provider || 'razorpay',
        providerSubscriptionId: providerSubscriptionId || 'manual',
        paymentMode: finalPaymentMode,
        transactionId: finalTransactionId,
        paymentStatus: finalPaymentStatus,
        price: finalPrice,
        discount: finalDiscountAmount,
        // AutoPay is OFF by default. A plan purchase is a one-time payment;
        // AutoPay only turns on after the user explicitly enables it and
        // authorizes a Razorpay mandate (confirmed via webhook).
        autoRenew: false,
      })
      .returning();

    // A pending row isn't an event worth logging — it becomes one when the
    // payment is verified, which re-enters here with paymentStatus 'success'.
    if (finalPaymentStatus === 'success') {
      await SubscriptionActivityService.record({
        clinicId,
        type: isFreePlan ? 'free_trial_started' : 'subscription_created',
        title: isFreePlan
          ? `Started on the ${plan.name} plan`
          : `Subscribed to ${plan.name}`,
        description: isFreePlan
          ? 'Base features are active. Upgrade any time to raise your limits.'
          : `Paid via ${finalPaymentMode}. Active until ${activityDate(expiresAt)}.`,
        amount: isFreePlan ? null : finalPrice,
        currency: plan.currency ?? 'INR',
        metadata: {
          subscriptionId: sub?.id,
          planId,
          planName: plan.name,
          transactionId: finalTransactionId,
          discount: finalDiscountAmount,
        },
      });
    }

    // Redis cache invalidate
    await redisClient.del(`clinic_active_subscription:${clinicId}`);
    await redisClient.del(`clinic_plan:${clinicId}`);
    await redisClient.del(`clinic_details:${clinicId}`);

    if (sub.active) {
      await SubscriptionService.updateUserSubscriptionExpiryCache(
        clinicId,
        sub.expiresAt
      );
    }

    return sub;
  }

  static async updateUserSubscriptionExpiryCache(
    clinicId: string,
    expiresAt: Date | null
  ) {
    const [clinicUsers, pharmacyUsers, labUsers] = await Promise.all([
      database
        .select({ userId: ClinicAssignModel.userId })
        .from(ClinicAssignModel)
        .where(eq(ClinicAssignModel.clinicId, clinicId)),
      database
        .select({ userId: PharmacyAssignModel.userId })
        .from(PharmacyAssignModel)
        .where(eq(PharmacyAssignModel.clinicId, clinicId)),
      database
        .select({ userId: UserLabAssignmentsModel.userId })
        .from(UserLabAssignmentsModel)
        .where(eq(UserLabAssignmentsModel.clinicId, clinicId)),
    ]);

    const uniqueUserIds = new Set<string>([
      ...clinicUsers.map((u) => u.userId).filter(Boolean),
      ...pharmacyUsers.map((u) => u.userId).filter(Boolean),
      ...labUsers.map((u) => u.userId).filter(Boolean),
    ]);

    for (const userId of uniqueUserIds) {
      const redisKey = `user_subscription_expiry:${userId}`;
      if (expiresAt) {
        const now = new Date();
        const expiryDate = new Date(expiresAt);
        const ttl = Math.floor((expiryDate.getTime() - now.getTime()) / 1000);
        if (ttl > 0) {
          await redisClient.setex(redisKey, ttl, expiryDate.toISOString());
        } else {
          await redisClient.setex(redisKey, 300, expiryDate.toISOString());
        }
      } else {
        await redisClient.setex(redisKey, 86400, 'null');
      }
    }
  }

  /**
   * Schedule cancellation at end of billing period.
   * Subscription stays active until expires_at, then won't renew.
   */
  static async scheduleCancellation(clinicId: string, reason?: string) {
    const [subscription] = await database
      .select()
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

    // Already scheduled — return the existing state instead of re-stamping
    // `cancelledAt` and appending a second identical timeline entry. Callers
    // reach here twice whenever the UI hasn't reflected the first cancellation
    // (e.g. the read query considers the subscription expired while this one
    // still finds it), and cancelling twice is not a second event.
    if (subscription.cancelAtPeriodEnd) {
      return subscription;
    }

    const [updated] = await database
      .update(ClinicSubscriptionModel)
      .set({
        cancelAtPeriodEnd: true,
        cancelledAt: new Date(),
        cancellationReason: reason || null,
        updatedAt: new Date(),
      })
      .where(eq(ClinicSubscriptionModel.id, subscription.id))
      .returning();

    await SubscriptionActivityService.record({
      clinicId,
      type: 'cancel_scheduled',
      title: 'Cancellation scheduled',
      description: `Access continues until ${activityDate(updated?.expiresAt)}, then the subscription will not renew.`,
      metadata: {
        subscriptionId: subscription.id,
        reason: reason || null,
        expiresAt: updated?.expiresAt ?? null,
      },
    });

    // Invalidate cache
    await redisClient.del(`clinic_active_subscription:${clinicId}`);
    await redisClient.del(`clinic_plan:${clinicId}`);

    return updated;
  }

  /**
   * Undo a scheduled cancellation (re-enable renewal).
   */
  static async undoCancellation(clinicId: string) {
    const [subscription] = await database
      .select()
      .from(ClinicSubscriptionModel)
      .where(
        and(
          eq(ClinicSubscriptionModel.clinicId, clinicId),
          eq(ClinicSubscriptionModel.active, true),
          eq(ClinicSubscriptionModel.cancelAtPeriodEnd, true)
        )
      )
      .limit(1);

    if (!subscription) {
      throw new HttpError(
        404,
        'No subscription with pending cancellation found'
      );
    }

    const [updated] = await database
      .update(ClinicSubscriptionModel)
      .set({
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        cancellationReason: null,
        updatedAt: new Date(),
      })
      .where(eq(ClinicSubscriptionModel.id, subscription.id))
      .returning();

    await SubscriptionActivityService.record({
      clinicId,
      type: 'cancel_undone',
      title: 'Cancellation withdrawn',
      description: `The subscription will renew as normal on ${activityDate(updated?.expiresAt)}.`,
      metadata: { subscriptionId: subscription.id },
    });

    // Invalidate cache
    await redisClient.del(`clinic_active_subscription:${clinicId}`);
    await redisClient.del(`clinic_plan:${clinicId}`);

    return updated;
  }

  /**
   * Schedule a plan change (downgrade) to take effect at the end of the current
   * billing period. The current plan stays fully active until then.
   *
   * @param targetPlanId Plan to switch to at period end
   * @param targetProviderSubscriptionId Billing-cycle marker for the target plan
   * @param preferredActiveDoctorIds Optional preferred active doctor IDs for over-quota handling
   * @param preferredActiveStaffIds Optional preferred active staff IDs for over-quota handling
   */
  static async schedulePlanChange(
    clinicId: string,
    targetPlanId: string,
    targetProviderSubscriptionId: string,
    preferredActiveDoctorIds?: string[],
    preferredActiveStaffIds?: string[]
  ) {
    const [subscription] = await database
      .select()
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

    // Validate the target plan exists
    const [targetPlan] = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, targetPlanId))
      .limit(1);

    if (!targetPlan) {
      throw new HttpError(400, 'Invalid target plan');
    }

    if (targetPlanId === subscription.planId) {
      throw new HttpError(400, 'You are already on this plan');
    }

    // The change applies when the current period ends
    const changeAt = subscription.expiresAt ?? new Date();

    const [updated] = await database
      .update(ClinicSubscriptionModel)
      .set({
        scheduledPlanId: targetPlanId,
        scheduledPlanChangeAt: changeAt,
        scheduledProviderSubscriptionId: targetProviderSubscriptionId,
        updatedAt: new Date(),
      })
      .where(eq(ClinicSubscriptionModel.id, subscription.id))
      .returning();

    if (
      (preferredActiveDoctorIds && preferredActiveDoctorIds.length > 0) ||
      (preferredActiveStaffIds && preferredActiveStaffIds.length > 0)
    ) {
      await redisClient.set(
        `scheduled_downgrade_preferences:${clinicId}`,
        JSON.stringify({
          preferredActiveDoctorIds: preferredActiveDoctorIds || [],
          preferredActiveStaffIds: preferredActiveStaffIds || [],
        })
      );
    }

    await SubscriptionActivityService.record({
      clinicId,
      type: 'plan_change_scheduled',
      title: `Plan change scheduled: ${targetPlan.name}`,
      description: `Your current plan stays active until ${activityDate(changeAt)}, when it switches to ${targetPlan.name}.`,
      metadata: {
        subscriptionId: subscription.id,
        fromPlanId: subscription.planId,
        toPlanId: targetPlanId,
        toPlanName: targetPlan.name,
        effectiveAt: changeAt,
        preferredActiveDoctorIds,
        preferredActiveStaffIds,
      },
    });

    await redisClient.del(`clinic_active_subscription:${clinicId}`);
    await redisClient.del(`clinic_plan:${clinicId}`);

    return { subscription: updated, targetPlan, effectiveAt: changeAt };
  }

  /**
   * Undo a scheduled plan change before it takes effect.
   */
  static async undoScheduledPlanChange(clinicId: string) {
    const [subscription] = await database
      .select()
      .from(ClinicSubscriptionModel)
      .where(
        and(
          eq(ClinicSubscriptionModel.clinicId, clinicId),
          eq(ClinicSubscriptionModel.active, true)
        )
      )
      .limit(1);

    if (!subscription || !subscription.scheduledPlanId) {
      throw new HttpError(404, 'No scheduled plan change found');
    }

    const [updated] = await database
      .update(ClinicSubscriptionModel)
      .set({
        scheduledPlanId: null,
        scheduledPlanChangeAt: null,
        scheduledProviderSubscriptionId: null,
        updatedAt: new Date(),
      })
      .where(eq(ClinicSubscriptionModel.id, subscription.id))
      .returning();

    await redisClient.del(`scheduled_downgrade_preferences:${clinicId}`);

    await SubscriptionActivityService.record({
      clinicId,
      type: 'plan_change_scheduled',
      title: 'Scheduled plan change withdrawn',
      description: 'You will stay on your current plan.',
      metadata: {
        subscriptionId: subscription.id,
        cancelledScheduledPlanId: subscription.scheduledPlanId,
      },
    });

    await redisClient.del(`clinic_active_subscription:${clinicId}`);
    await redisClient.del(`clinic_plan:${clinicId}`);

    return updated;
  }

  /**
   * Apply a scheduled plan change. Called at renewal (webhook) or by the
   * expiry cron when the current period ends.
   *
   * Switches the subscription to the scheduled plan, resets the billing period,
   * and enforces limits (deactivating excess staff/doctors if downgrading).
   */
  static async applyScheduledPlanChange(clinicId: string) {
    const [subscription] = await database
      .select()
      .from(ClinicSubscriptionModel)
      .where(
        and(
          eq(ClinicSubscriptionModel.clinicId, clinicId),
          eq(ClinicSubscriptionModel.active, true)
        )
      )
      .limit(1);

    if (!subscription || !subscription.scheduledPlanId) {
      return { applied: false };
    }

    const [targetPlan] = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, subscription.scheduledPlanId))
      .limit(1);

    if (!targetPlan) {
      // Target plan disappeared — clear the schedule to avoid a stuck state.
      await database
        .update(ClinicSubscriptionModel)
        .set({
          scheduledPlanId: null,
          scheduledPlanChangeAt: null,
          scheduledProviderSubscriptionId: null,
          updatedAt: new Date(),
        })
        .where(eq(ClinicSubscriptionModel.id, subscription.id));
      return { applied: false };
    }

    const now = new Date();
    const isYearly = isYearlyProviderId(
      subscription.scheduledProviderSubscriptionId
    );
    const isFree = targetPlan.slug === 'solo' || targetPlan.slug === 'Free';

    // New period
    let newExpiry: Date | null;
    if (isFree) {
      newExpiry = null; // Free never expires
    } else {
      newExpiry = new Date(now);
      if (isYearly) newExpiry.setFullYear(newExpiry.getFullYear() + 1);
      else newExpiry.setDate(newExpiry.getDate() + 30);
    }

    const price = isFree
      ? '0'
      : String(
          planPriceForCycle(targetPlan.price, isYearly ? 'yearly' : 'monthly')
        );

    // Downgrading to Free drops the mandate from our record — but the mandate
    // lives at Razorpay, and nulling the id below would lose the only handle we
    // have to cancel it. Cancel it there FIRST: `disableAutoRenew` already
    // handles the cycle-end vs immediate cases and clears both columns. If it
    // fails we keep the id, so the clinic can retry rather than being billed by
    // a mandate nobody can reach.
    const { AutoRenewService } = await import('./autoRenew.service');
    let mandateCancelled = false;
    if (isFree && subscription.razorpaySubscriptionId) {
      try {
        await AutoRenewService.disableAutoRenew(clinicId);
        mandateCancelled = true;
      } catch (err) {
        logger.error(
          `Downgrade to Free for clinic ${clinicId}: failed to cancel Razorpay mandate ${subscription.razorpaySubscriptionId}. Keeping the reference so it can be retried.`,
          err
        );
      }
    }

    await database
      .update(ClinicSubscriptionModel)
      .set({
        planId: targetPlan.id,
        providerSubscriptionId:
          subscription.scheduledProviderSubscriptionId ?? 'manual',
        startsAt: now,
        expiresAt: newExpiry,
        price,
        // Downgrading to Free removes auto-pay
        autoRenew: isFree ? false : subscription.autoRenew,
        razorpaySubscriptionId:
          isFree && mandateCancelled
            ? null
            : subscription.razorpaySubscriptionId,
        // Clear the schedule
        scheduledPlanId: null,
        scheduledPlanChangeAt: null,
        scheduledProviderSubscriptionId: null,
        updatedAt: now,
      })
      .where(eq(ClinicSubscriptionModel.id, subscription.id));

    await SubscriptionActivityService.record({
      clinicId,
      type: isFree ? 'plan_downgraded' : 'plan_upgraded',
      title: `Plan changed to ${targetPlan.name}`,
      description: isFree
        ? 'Your scheduled downgrade took effect. Paid features are no longer available.'
        : `Your scheduled plan change took effect. Next renewal ${activityDate(newExpiry)}.`,
      amount: isFree ? null : price,
      // Applied by the renewal webhook or the expiry cron, never by a person.
      actorUserId: null,
      metadata: {
        subscriptionId: subscription.id,
        fromPlanId: subscription.planId,
        toPlanId: targetPlan.id,
        toPlanName: targetPlan.name,
        mandateCancelled: isFree ? mandateCancelled : undefined,
      },
    });

    // Paid → paid downgrade: the mandate still carries the OLD plan's amount,
    // so without this the clinic keeps being charged the higher price on the
    // plan it just left. Runs after the update so the sync reads the new plan.
    if (
      !isFree &&
      subscription.autoRenew &&
      subscription.razorpaySubscriptionId
    ) {
      await AutoRenewService.syncAutoRenewAmount(clinicId);
    }

    // Invalidate caches
    await redisClient.del(`clinic_active_subscription:${clinicId}`);
    await redisClient.del(`clinic_plan:${clinicId}`);
    await redisClient.del(`clinic_limits_overview:${clinicId}`);
    await redisClient.del(`clinic_limits:${clinicId}`);

    await SubscriptionService.updateUserSubscriptionExpiryCache(
      clinicId,
      newExpiry
    );

    // Retrieve stored downgrade preferences if any
    let preferredActiveDoctorIds: string[] | undefined;
    let preferredActiveStaffIds: string[] | undefined;
    const prefsKey = `scheduled_downgrade_preferences:${clinicId}`;
    const rawPrefs = await redisClient.get(prefsKey);
    if (rawPrefs) {
      try {
        const parsed = JSON.parse(rawPrefs);
        preferredActiveDoctorIds = parsed.preferredActiveDoctorIds;
        preferredActiveStaffIds = parsed.preferredActiveStaffIds;
      } catch {
        // ignore invalid json for stored downgrade preferences
      }
      await redisClient.del(prefsKey);
    }

    // Enforce limits on the new (lower) plan — deactivate excess staff/doctors
    const { LimitationService } = await import('./limitation.service');
    const enforcement = await LimitationService.enforceStaffLimitsOnExpiry(
      clinicId,
      preferredActiveDoctorIds,
      preferredActiveStaffIds
    );

    return {
      applied: true,
      newPlanSlug: targetPlan.slug,
      warnings: enforcement.warnings,
    };
  }

  /**
   * Process all subscriptions whose scheduled plan change is now due.
   * Intended to be called by a daily cron.
   */
  static async processDueScheduledPlanChanges(): Promise<{
    processed: number;
    applied: number;
    errors: string[];
  }> {
    const now = new Date();
    const errors: string[] = [];
    let applied = 0;

    const due = await database
      .select({ clinicId: ClinicSubscriptionModel.clinicId })
      .from(ClinicSubscriptionModel)
      .where(
        and(
          eq(ClinicSubscriptionModel.active, true),
          isNotNull(ClinicSubscriptionModel.scheduledPlanId),
          lte(ClinicSubscriptionModel.scheduledPlanChangeAt, now)
        )
      );

    for (const row of due) {
      try {
        const result = await SubscriptionService.applyScheduledPlanChange(
          row.clinicId
        );
        if (result.applied) applied++;
      } catch (err) {
        errors.push(
          `Clinic ${row.clinicId}: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }

    return { processed: due.length, applied, errors };
  }

  /**
   * Cancel clinic subscription.
   * Enforces staff limits by deactivating excess staff/doctors on the fallback plan.
   * Returns info about deactivated users so the frontend can display it.
   */
  static async cancelClinicSubscription(
    subscriptionId: string,
    clinicId: string
  ) {
    // Get the subscription to find the clinicId
    const [subscription] = await database
      .select({
        id: ClinicSubscriptionModel.id,
        clinicId: ClinicSubscriptionModel.clinicId,
      })
      .from(ClinicSubscriptionModel)
      .where(eq(ClinicSubscriptionModel.id, subscriptionId))
      .limit(1);

    if (!subscription || subscription.clinicId !== clinicId) {
      throw new HttpError(404, 'Subscription not found');
    }

    // Deactivate subscription
    await database
      .update(ClinicSubscriptionModel)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(ClinicSubscriptionModel.id, subscriptionId));

    // Invalidate cache
    await redisClient.del(
      `clinic_active_subscription:${subscription.clinicId}`
    );
    await redisClient.del(`clinic_plan:${subscription.clinicId}`);
    await redisClient.del(`clinic_details:${subscription.clinicId}`);
    await redisClient.del(`clinic_limits_overview:${subscription.clinicId}`);

    // Invalidate user subscription expiry cache
    const assignedUsers = await database
      .select({ userId: ClinicAssignModel.userId })
      .from(ClinicAssignModel)
      .where(eq(ClinicAssignModel.clinicId, subscription.clinicId));

    for (const user of assignedUsers) {
      await redisClient.del(`user_subscription_expiry:${user.userId}`);
    }

    // Enforce staff limits — deactivate excess staff/doctors
    const { LimitationService } = await import('./limitation.service');
    const enforcement = await LimitationService.enforceStaffLimitsOnExpiry(
      subscription.clinicId
    );

    return {
      cancelled: true,
      warnings: enforcement.warnings,
      doctorsDeactivated: enforcement.doctorsDeactivated,
      staffDeactivated: enforcement.staffDeactivated,
    };
  }

  /**
   * Get active subscriptions for a clinic
   */
  static async getActiveSubscriptionsForClinic(clinicId: string) {
    const subs = await database
      .select()
      .from(ClinicSubscriptionModel)
      .where(
        and(
          eq(ClinicSubscriptionModel.clinicId, clinicId),
          eq(ClinicSubscriptionModel.active, true)
        )
      );
    return subs;
  }

  /**
   * Check if clinic has active subscription
   */
  static async clinicHasActiveSubscription(clinicId: string): Promise<boolean> {
    const subs = await this.getActiveSubscriptionsForClinic(clinicId);

    if (subs.length === 0) {
      return false;
    }

    const now = new Date();
    for (const sub of subs) {
      if (!sub.expiresAt || new Date(sub.expiresAt) > now) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get billing history for a clinic (latest first)
   */
  static async getClinicBillingHistory(clinicId: string) {
    const now = new Date();

    const subscriptionHistory = await database
      .select({
        id: ClinicSubscriptionModel.id,
        currency: SubscriptionPlanModel.currency,
        startsAt: ClinicSubscriptionModel.startsAt,
        expiresAt: ClinicSubscriptionModel.expiresAt,
        createdAt: ClinicSubscriptionModel.createdAt,
        paymentMode: ClinicSubscriptionModel.paymentMode,
        transactionId: ClinicSubscriptionModel.transactionId,
        paymentStatus: ClinicSubscriptionModel.paymentStatus,
        price: ClinicSubscriptionModel.price,
        discount: ClinicSubscriptionModel.discount,

        planName: SubscriptionPlanModel.name,
        planDescription: SubscriptionPlanModel.description,

        clinicId: ClinicModel.id,
        clinicName: ClinicModel.clinicName,
        clinicAddress: ClinicModel.clinicAddress,
        clinicLocation: ClinicModel.clinicLocation,
        clinicPhone: ClinicModel.clinicPhone,
        clinicState: ClinicModel.State,
        clinicCity: ClinicModel.City,
        ZipCode: ClinicModel.ZipCode,

        adminId: UserModel.id,
        adminName: UserModel.name,
        adminEmail: UserModel.email,
        adminMobile: UserModel.mobile,
      })
      .from(ClinicSubscriptionModel)
      .innerJoin(
        SubscriptionPlanModel,
        eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
      )
      .innerJoin(
        ClinicModel,
        eq(ClinicSubscriptionModel.clinicId, ClinicModel.id)
      )
      .innerJoin(
        ClinicAssignModel,
        and(
          eq(ClinicAssignModel.clinicId, ClinicModel.id),
          eq(ClinicAssignModel.userId, ClinicModel.userId)
        )
      )
      .innerJoin(UserModel, eq(ClinicAssignModel.userId, UserModel.id))
      .where(
        and(
          eq(ClinicSubscriptionModel.clinicId, clinicId),
          eq(ClinicSubscriptionModel.paymentStatus, 'success'),
          ne(ClinicSubscriptionModel.transactionId, '-'),
          ne(SubscriptionPlanModel.name, 'Free'),
          ne(SubscriptionPlanModel.name, 'Solo')
        )
      );

    const addOnHistory = await database
      .select({
        id: ClinicAddOnModel.id,
        currency: AddOnModel.currency,
        startsAt: ClinicAddOnModel.startsAt,
        expiresAt: ClinicAddOnModel.expiresAt,
        createdAt: ClinicAddOnModel.createdAt,
        paymentMode: ClinicAddOnModel.paymentMode,
        transactionId: ClinicAddOnModel.transactionId,
        paymentStatus: ClinicAddOnModel.paymentStatus,
        price: ClinicAddOnModel.price,
        discount: sql<number>`0`.as('discount'),

        planName: AddOnModel.name,
        planDescription: AddOnModel.description,

        clinicId: ClinicModel.id,
        clinicName: ClinicModel.clinicName,
        clinicAddress: ClinicModel.clinicAddress,
        clinicLocation: ClinicModel.clinicLocation,
        clinicPhone: ClinicModel.clinicPhone,
        clinicState: ClinicModel.State,
        clinicCity: ClinicModel.City,
        ZipCode: ClinicModel.ZipCode,

        adminId: UserModel.id,
        adminName: UserModel.name,
        adminEmail: UserModel.email,
        adminMobile: UserModel.mobile,
      })
      .from(ClinicAddOnModel)
      .innerJoin(AddOnModel, eq(ClinicAddOnModel.addOnId, AddOnModel.id))
      .innerJoin(ClinicModel, eq(ClinicAddOnModel.clinicId, ClinicModel.id))
      .innerJoin(
        ClinicAssignModel,
        and(
          eq(ClinicAssignModel.clinicId, ClinicModel.id),
          eq(ClinicAssignModel.userId, ClinicModel.userId)
        )
      )
      .innerJoin(UserModel, eq(ClinicAssignModel.userId, UserModel.id))
      .where(
        and(
          eq(ClinicAddOnModel.clinicId, clinicId),
          eq(ClinicAddOnModel.paymentStatus, 'success'),
          ne(ClinicAddOnModel.transactionId, '-')
        )
      );

    // Merge both arrays
    const combinedHistory = [...subscriptionHistory, ...addOnHistory];

    // Sort by createdAt in descending order (latest first)
    combinedHistory.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const history = combinedHistory.map((item) => ({
      ...item,
      active:
        item.paymentStatus === 'success' && item.expiresAt
          ? new Date(item.expiresAt) > now
          : item.paymentStatus === 'success',
    }));

    return history;
  }

  /**
   * Generate Invoice PDF for a subscription or add-on transaction
   */
  static async generateInvoicePdf(
    clinicId: string,
    invoiceId: string,
    type?: 'subscription' | 'addon'
  ) {
    const formatDate = (date?: Date | string | null) => {
      if (!date) return '-';
      return new Date(date)
        .toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
        .toUpperCase();
    };

    const formatDateTime = (date?: Date | string | null) => {
      if (!date) return '-';
      const d = new Date(date);
      const dateStr = d
        .toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
        .toUpperCase();
      const timeStr = d
        .toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })
        .toUpperCase();
      return `${dateStr}, ${timeStr}`;
    };

    const numberToWordsRupees = (amount: number): string => {
      const rounded = Math.round(amount);
      if (rounded === 0) return 'ZERO RUPEES ONLY';

      const a = [
        '',
        'ONE',
        'TWO',
        'THREE',
        'FOUR',
        'FIVE',
        'SIX',
        'SEVEN',
        'EIGHT',
        'NINE',
        'TEN',
        'ELEVEN',
        'TWELVE',
        'THIRTEEN',
        'FOURTEEN',
        'FIFTEEN',
        'SIXTEEN',
        'SEVENTEEN',
        'EIGHTEEN',
        'NINETEEN',
      ];
      const b = [
        '',
        '',
        'TWENTY',
        'THIRTY',
        'FORTY',
        'FIFTY',
        'SIXTY',
        'SEVENTY',
        'EIGHTY',
        'NINETY',
      ];

      function inWords(num: number): string {
        if (num < 20) return a[num];
        if (num < 100)
          return (
            b[Math.floor(num / 10)] + (num % 10 !== 0 ? ' ' + a[num % 10] : '')
          );
        if (num < 1000)
          return (
            a[Math.floor(num / 100)] +
            ' HUNDRED' +
            (num % 100 !== 0 ? ' ' + inWords(num % 100) : '')
          );
        if (num < 100000)
          return (
            inWords(Math.floor(num / 1000)) +
            ' THOUSAND' +
            (num % 1000 !== 0 ? ' ' + inWords(num % 1000) : '')
          );
        if (num < 10000000)
          return (
            inWords(Math.floor(num / 100000)) +
            ' LAKH' +
            (num % 100000 !== 0 ? ' ' + inWords(num % 100000) : '')
          );
        return (
          inWords(Math.floor(num / 10000000)) +
          ' CRORE' +
          (num % 10000000 !== 0 ? ' ' + inWords(num % 10000000) : '')
        );
      }

      return `${inWords(rounded)} RUPEES ONLY`;
    };

    let record: InvoiceRecord | null = null;

    // 1. Try finding in ClinicSubscriptionModel if type is 'subscription' or not specified
    if (!type || type === 'subscription') {
      const subRecords = await database
        .select({
          id: ClinicSubscriptionModel.id,
          currency: SubscriptionPlanModel.currency,
          startsAt: ClinicSubscriptionModel.startsAt,
          expiresAt: ClinicSubscriptionModel.expiresAt,
          createdAt: ClinicSubscriptionModel.createdAt,
          paymentMode: ClinicSubscriptionModel.paymentMode,
          transactionId: ClinicSubscriptionModel.transactionId,
          paymentStatus: ClinicSubscriptionModel.paymentStatus,
          price: ClinicSubscriptionModel.price,
          discount: ClinicSubscriptionModel.discount,
          planName: SubscriptionPlanModel.name,
          planDescription: SubscriptionPlanModel.description,
          clinicName: ClinicModel.clinicName,
          clinicAddress: ClinicModel.clinicAddress,
          clinicPhone: ClinicModel.clinicPhone,
          clinicState: ClinicModel.State,
          clinicCity: ClinicModel.City,
          zipCode: ClinicModel.ZipCode,
          adminName: UserModel.name,
          adminEmail: UserModel.email,
          adminMobile: UserModel.mobile,
        })
        .from(ClinicSubscriptionModel)
        .innerJoin(
          SubscriptionPlanModel,
          eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
        )
        .innerJoin(
          ClinicModel,
          eq(ClinicSubscriptionModel.clinicId, ClinicModel.id)
        )
        .innerJoin(
          ClinicAssignModel,
          and(
            eq(ClinicAssignModel.clinicId, ClinicModel.id),
            eq(ClinicAssignModel.userId, ClinicModel.userId)
          )
        )
        .innerJoin(UserModel, eq(ClinicAssignModel.userId, UserModel.id))
        .where(
          and(
            eq(ClinicSubscriptionModel.clinicId, clinicId),
            or(
              eq(ClinicSubscriptionModel.id, invoiceId),
              eq(ClinicSubscriptionModel.transactionId, invoiceId)
            )
          )
        )
        .limit(1);

      if (subRecords.length > 0) {
        record = subRecords[0];
      }
    }

    // 2. Try finding in ClinicAddOnModel if not found and type is 'addon' or not specified
    if (!record && (!type || type === 'addon')) {
      const addOnRecords = await database
        .select({
          id: ClinicAddOnModel.id,
          currency: AddOnModel.currency,
          startsAt: ClinicAddOnModel.startsAt,
          expiresAt: ClinicAddOnModel.expiresAt,
          createdAt: ClinicAddOnModel.createdAt,
          paymentMode: ClinicAddOnModel.paymentMode,
          transactionId: ClinicAddOnModel.transactionId,
          paymentStatus: ClinicAddOnModel.paymentStatus,
          price: ClinicAddOnModel.price,
          discount: sql<number>`0`.as('discount'),
          planName: AddOnModel.name,
          planDescription: AddOnModel.description,
          clinicName: ClinicModel.clinicName,
          clinicAddress: ClinicModel.clinicAddress,
          clinicPhone: ClinicModel.clinicPhone,
          clinicState: ClinicModel.State,
          clinicCity: ClinicModel.City,
          zipCode: ClinicModel.ZipCode,
          adminName: UserModel.name,
          adminEmail: UserModel.email,
          adminMobile: UserModel.mobile,
        })
        .from(ClinicAddOnModel)
        .innerJoin(AddOnModel, eq(ClinicAddOnModel.addOnId, AddOnModel.id))
        .innerJoin(ClinicModel, eq(ClinicAddOnModel.clinicId, ClinicModel.id))
        .innerJoin(
          ClinicAssignModel,
          and(
            eq(ClinicAssignModel.clinicId, ClinicModel.id),
            eq(ClinicAssignModel.userId, ClinicModel.userId)
          )
        )
        .innerJoin(UserModel, eq(ClinicAssignModel.userId, UserModel.id))
        .where(
          and(
            eq(ClinicAddOnModel.clinicId, clinicId),
            or(
              eq(ClinicAddOnModel.id, invoiceId),
              eq(ClinicAddOnModel.transactionId, invoiceId)
            )
          )
        )
        .limit(1);

      if (addOnRecords.length > 0) {
        record = addOnRecords[0];
      }
    }

    if (!record) {
      throw new HttpError(404, 'Invoice record not found');
    }

    const priceNum = Number(record.price || 0);
    const discountNum = Number(record.discount || 0);
    const totalNum = Math.max(0, priceNum - discountNum);

    const baseAmount = Math.round((totalNum / 1.18) * 100) / 100;
    const cgst = Math.round(((totalNum - baseAmount) / 2) * 100) / 100;
    const sgst = Math.round((totalNum - baseAmount - cgst) * 100) / 100;

    const cityState = [record.clinicCity, record.clinicState]
      .filter(Boolean)
      .join(', ')
      .toUpperCase();

    const invoiceNumber = String(record.id).slice(0, 12).toUpperCase();

    const templateData = {
      invoiceNumber,
      currentDateTime: formatDateTime(record.createdAt),
      clinicName: (record.clinicName || 'Clinic').toUpperCase(),
      clinicAddress: (record.clinicAddress || '').toUpperCase(),
      clinicCity: (record.clinicCity || '').toUpperCase(),
      clinicState: (record.clinicState || '').toUpperCase(),
      zipCode: record.zipCode || '',
      clinicPhone: record.clinicPhone || '',
      adminName: (record.adminName || '').toUpperCase(),
      adminEmail: (record.adminEmail || '').toUpperCase(),
      adminMobile: record.adminMobile || '',
      planName: (record.planName || '').toUpperCase(),
      planDescription: (record.planDescription || '').toLowerCase(),
      startsAt: formatDate(record.startsAt),
      expiresAt: formatDate(record.expiresAt),
      createdAt: formatDateTime(record.createdAt),
      transactionId: record.transactionId || '-',
      subtotal: `₹${baseAmount.toFixed(2)}`,
      cgst: `₹${cgst.toFixed(2)}`,
      sgst: `₹${sgst.toFixed(2)}`,
      grandTotal: `₹${totalNum.toFixed(2)}`,
      amountInWords: numberToWordsRupees(totalNum),

      // Retain nested objects for legacy/backwards compatibility
      invoice: {
        invoiceNumber,
        dateTime: formatDateTime(record.createdAt),
        transactionId: record.transactionId || '-',
      },
      clinic: {
        name: (record.clinicName || 'Clinic').toUpperCase(),
        address: (record.clinicAddress || '').toUpperCase(),
        cityState,
        zipCode: record.zipCode || '',
        phone: record.clinicPhone || '',
      },
      admin: {
        name: (record.adminName || '').toUpperCase(),
        email: (record.adminEmail || '').toUpperCase(),
        phone: record.adminMobile || '',
      },
      item: {
        name: (record.planName || '').toUpperCase(),
        description: (record.planDescription || '').toLowerCase(),
        startDate: formatDate(record.startsAt),
        endDate: formatDate(record.expiresAt),
        transactionDateTime: formatDateTime(record.createdAt),
      },
      summary: {
        baseAmountFormatted: baseAmount.toFixed(2),
        cgstFormatted: cgst.toFixed(2),
        sgstFormatted: sgst.toFixed(2),
        totalFormatted: totalNum.toFixed(2),
        totalInWords: numberToWordsRupees(totalNum),
      },
    };

    const template = handlebars.compile(subscriptionInvoiceTemplate);
    const html = template(templateData);
    const pdfBuffer = await htmlToPdfBuffer(html);

    return {
      pdfBuffer,
      fileName: `${invoiceNumber}.pdf`,
    };
  }
}
