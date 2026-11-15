import { and, desc, eq, inArray } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { CacheKeys, invalidateCache } from '../../../../utils/cache.util';
import { isUndefinedTable } from '../../../../utils/db.utils';
import logger from '../../../../utils/logger';
import { ClinicTrialOverrideModel as T } from '../../models/clinicTrialOverride.model';
import { SubscriptionModel } from '../../models/ownerSubscription.model';
import { SubscriptionPlanModel } from '../../models/subscription.model';
import { getClinicPort } from '../../ports';
import type { BillingActor as Actor } from '../../types/billingAdmin.types';
import { SubscriptionActivityService } from '../subscriptionActivity.service';

const OVERRIDES_MAX = 500;

/** Where a clinic's free trial stands: waiting to be started, running, or over. */
export type TrialStatus = 'not_started' | 'running' | 'ended';

/** Super Admin's free-trial lengths: the default every clinic gets and a clinic's own. */
export class TrialOverrideService {
  /** A clinic's own trial length in days; null when the plan's default applies or the lookup fails (fails open). */
  static async daysFor(clinicId: string): Promise<number | null> {
    try {
      const [row] = await database
        .select({ days: T.trialDays })
        .from(T)
        .where(eq(T.clinicId, clinicId))
        .limit(1);
      return row?.days ?? null;
    } catch (error) {
      // Billing pages and trials must keep working before the table is migrated.
      if (isUndefinedTable(error)) {
        logger.warn('[FreeTrial] Trial length table is not migrated yet; using the plan default.');
      } else {
        logger.error(`[FreeTrial] Could not read the trial length of clinic ${clinicId}:`, error);
      }
      return null;
    }
  }

  /** The default trial length and every clinic with its own, with how far each trial has got. */
  static async overview() {
    const now = new Date();
    const [[plan], rows] = await Promise.all([
      database
        .select({ days: SubscriptionPlanModel.trialDays })
        .from(SubscriptionPlanModel)
        .where(
          and(
            eq(SubscriptionPlanModel.ownerType, 'clinic'),
            eq(SubscriptionPlanModel.isTrialPlan, true)
          )
        )
        .limit(1),
      database
        .select()
        .from(T)
        .orderBy(desc(T.updatedAt))
        .limit(OVERRIDES_MAX),
    ]);
    const ids = rows.map((r) => r.clinicId);
    const [clinics, trials] = ids.length
      ? await Promise.all([
          getClinicPort().getClinics(ids),
          database
            .select({
              ownerId: SubscriptionModel.ownerId,
              status: SubscriptionModel.status,
              endsAt: SubscriptionModel.currentPeriodEnd,
            })
            .from(SubscriptionModel)
            .where(
              and(
                eq(SubscriptionModel.ownerType, 'clinic'),
                inArray(SubscriptionModel.ownerId, ids),
                eq(SubscriptionModel.isTrial, true)
              )
            ),
        ])
      : [new Map(), []];
    const statusOf = (clinicId: string): TrialStatus => {
      const own = trials.filter((t) => t.ownerId === clinicId);
      if (!own.length) return 'not_started';
      return own.some(
        (t) => t.status === 'trialing' && t.endsAt && t.endsAt > now
      )
        ? 'running'
        : 'ended';
    };
    return {
      defaultDays: plan?.days ?? null,
      clinics: rows.map((r) => ({
        clinicId: r.clinicId,
        clinicName: clinics.get(r.clinicId)?.name ?? 'Unnamed clinic',
        days: r.trialDays,
        reason: r.reason,
        updatedAt: r.updatedAt.toISOString(),
        trial: statusOf(r.clinicId),
      })),
    };
  }

  /** Sets how many days the free trial gives every clinic that has no length of its own. */
  static async setDefault(days: number, by: Actor) {
    const updated = await database
      .update(SubscriptionPlanModel)
      .set({ trialDays: days, updatedAt: new Date() })
      .where(
        and(
          eq(SubscriptionPlanModel.ownerType, 'clinic'),
          eq(SubscriptionPlanModel.isTrialPlan, true)
        )
      )
      .returning({ id: SubscriptionPlanModel.id });
    if (!updated.length) {
      throw new HttpError(409, 'No free trial plan is set up.');
    }
    await invalidateCache(CacheKeys.allPlans);
    logger.warn(
      `[FreeTrial] Default trial set to ${days} days by ${by.userId}: ${by.reason}`
    );
    return TrialOverrideService.overview();
  }

  /** Gives one clinic its own trial length; it applies when the clinic starts its trial. */
  static async setForClinic(clinicId: string, days: number, by: Actor) {
    if (!(await getClinicPort().getClinics([clinicId])).has(clinicId)) {
      throw new HttpError(404, 'Clinic not found.');
    }
    const reason = by.reason.slice(0, 255);
    await database
      .insert(T)
      .values({ clinicId, trialDays: days, setBy: by.userId, reason })
      .onConflictDoUpdate({
        target: T.clinicId,
        set: {
          trialDays: days,
          setBy: by.userId,
          reason,
          updatedAt: new Date(),
        },
      });
    await SubscriptionActivityService.record({
      clinicId,
      type: 'free_trial_changed',
      title: `Free trial set to ${days} day${days === 1 ? '' : 's'}`,
      description: by.reason,
      actorUserId: by.userId,
      metadata: { days },
    });
    return TrialOverrideService.overview();
  }

  /** Removes a clinic's own trial length, so the default applies again. */
  static async clearForClinic(clinicId: string, by: Actor) {
    const removed = await database
      .delete(T)
      .where(eq(T.clinicId, clinicId))
      .returning({ clinicId: T.clinicId });
    if (!removed.length) {
      throw new HttpError(404, 'This clinic has no free trial of its own.');
    }
    await SubscriptionActivityService.record({
      clinicId,
      type: 'free_trial_changed',
      title: 'Free trial back to the default length',
      description: by.reason,
      actorUserId: by.userId,
    });
    return TrialOverrideService.overview();
  }
}
