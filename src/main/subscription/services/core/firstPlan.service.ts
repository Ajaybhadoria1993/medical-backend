import { and, desc, eq, lte, type SQL } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { isUniqueViolation } from '../../../../utils/db.utils';
import logger from '../../../../utils/logger';
import { SubscriptionModel } from '../../models/ownerSubscription.model';
import { PlanVersionModel } from '../../models/planVersion.model';
import { SubscriptionPlanModel } from '../../models/subscription.model';
import { TrialRequestModel } from '../../models/trialRequest.model';
import {
  TRIAL_BLOCK_MESSAGES,
  trialBlockReason,
} from '../../utils/firstPlan.utils';
import { LimitationService } from '../limitation.service';
import { SubscriptionActivityService } from '../subscriptionActivity.service';
import { effectiveTrialDays } from '../../utils/trialDays.utils';
import type { OwnerType } from './ownerSubscription.service';
import { TrialOverrideService } from './trialOverride.service';
import { subscriptionNotify } from '../../notify/subscriptionNotify';
import type { Db } from '../../types/db.types';
import { getClinicPort } from '../../ports';

const DAY_MS = 24 * 60 * 60 * 1000;
const CURRENT_STATUSES = new Set(['trialing', 'active', 'past_due']);

export class FirstPlanService {
  static async assignFreePlan(
    ownerType: OwnerType,
    ownerId: string,
    opts: { db?: Db; startsAt?: Date } = {}
  ): Promise<void> {
    const planVersionId = await FirstPlanService.freeVersionId(ownerType);
    // The one-current-plan-per-owner index turns a repeat call, or a race, into a no-op.
    await (opts.db ?? database)
      .insert(SubscriptionModel)
      .values({
        ownerType,
        ownerId,
        planVersionId,
        status: 'active',
        billingCycle: 'none',
        currentPeriodStart: opts.startsAt ?? new Date(),
      })
      .onConflictDoNothing();
  }

  /** Same rule as startTrial, so the trial button and the API always agree. */
  static async canStartTrial(
    ownerType: OwnerType,
    ownerId: string
  ): Promise<boolean> {
    const { onFree, hadTrial } = await FirstPlanService.trialFacts(
      database,
      ownerType,
      ownerId
    );
    return trialBlockReason(onFree, hadTrial) === null;
  }

  static async startTrial(
    ownerType: OwnerType,
    ownerId: string,
    actorUserId: string | null
  ) {
    // The trial starts only after a Super Admin approves the clinic.
    if (
      ownerType === 'clinic' &&
      !(await getClinicPort().isApproved(ownerId))
    ) {
      throw new HttpError(
        403,
        'Your clinic is waiting for Super Admin approval. You can start the free trial once it is approved.'
      );
    }
    const { plan, version } = await FirstPlanService.planWithVersion(
      eq(SubscriptionPlanModel.ownerType, ownerType),
      eq(SubscriptionPlanModel.isTrialPlan, true)
    );
    const trialDays = effectiveTrialDays(
      ownerType === 'clinic' ? await TrialOverrideService.daysFor(ownerId) : null,
      plan?.trialDays
    );
    if (!plan || !version || trialDays < 1) {
      logger.error(
        `[FirstPlan] No trial plan, version or trial days set up for ${ownerType}`
      );
      throw new HttpError(
        503,
        'The free trial is not available right now. Please contact support.'
      );
    }

    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + trialDays * DAY_MS);
    let trial;
    try {
      trial = await database.transaction(async (tx) => {
        const { current, onFree, hadTrial } = await FirstPlanService.trialFacts(
          tx,
          ownerType,
          ownerId,
          true
        );
        const block = trialBlockReason(onFree, hadTrial);
        if (block) throw new HttpError(409, TRIAL_BLOCK_MESSAGES[block]);

        if (current) {
          await tx
            .update(SubscriptionModel)
            .set({ status: 'replaced', endedAt: startsAt, updatedAt: startsAt })
            .where(eq(SubscriptionModel.id, current.id));
        }
        const [row] = await tx
          .insert(SubscriptionModel)
          .values({
            ownerType,
            ownerId,
            planVersionId: version.id,
            status: 'trialing',
            billingCycle: 'none',
            currentPeriodStart: startsAt,
            currentPeriodEnd: endsAt,
            isTrial: true,
          })
          .returning();
        return row;
      });
    } catch (e) {
      // A second click that lost the race hits the one-current-plan index.
      if (isUniqueViolation(e)) {
        throw new HttpError(409, TRIAL_BLOCK_MESSAGES.trial_used);
      }
      throw e;
    }
    // The cached Free plan would otherwise keep trial features locked until it expires.
    await LimitationService.invalidateClinicCache(ownerId);

    await SubscriptionActivityService.recordTrialStarted({
      clinicId: ownerId,
      planId: plan.id,
      planName: plan.name,
      subscriptionId: trial.id,
      trialDays,
      expiresAt: endsAt,
      actorUserId,
    });
    await subscriptionNotify(
      'subscription.trial_started',
      {
        clinicId: ownerId,
        planName: plan.name,
        isTrialPlan: true,
        trialDays,
        trialEndsAt: endsAt,
      },
      trial.id
    );
    return { trial, planName: plan.name, trialDays };
  }

  /** The trial button: starts it for an approved clinic, else saves the request for approval to start. */
  static async requestOrStartTrial(
    ownerType: OwnerType,
    ownerId: string,
    actorUserId: string | null
  ) {
    if (ownerType !== 'clinic' || (await getClinicPort().isApproved(ownerId))) {
      return {
        requested: false as const,
        ...(await FirstPlanService.startTrial(ownerType, ownerId, actorUserId)),
      };
    }
    // Same rules as starting it, so a clinic past its trial or on a paid plan is told now, not at approval.
    const { onFree, hadTrial } = await FirstPlanService.trialFacts(
      database,
      ownerType,
      ownerId
    );
    const block = trialBlockReason(onFree, hadTrial);
    if (block) throw new HttpError(409, TRIAL_BLOCK_MESSAGES[block]);
    const [row] = await database
      .insert(TrialRequestModel)
      .values({ ownerType, ownerId, requestedBy: actorUserId })
      .onConflictDoNothing()
      .returning({ requestedAt: TrialRequestModel.requestedAt });
    return {
      requested: true as const,
      requestedAt:
        row?.requestedAt ?? (await FirstPlanService.trialRequestedAt(ownerId)),
    };
  }

  /** When the clinic asked for a trial that approval has not started yet; null if it has not. */
  static async trialRequestedAt(clinicId: string): Promise<Date | null> {
    const [row] = await database
      .select({ at: TrialRequestModel.requestedAt })
      .from(TrialRequestModel)
      .where(
        and(
          eq(TrialRequestModel.ownerType, 'clinic'),
          eq(TrialRequestModel.ownerId, clinicId)
        )
      )
      .limit(1);
    return row?.at ?? null;
  }

  /** On approval: starts the trial only if the clinic asked for one, then clears the request. True if it started. */
  static async startRequestedTrial(
    clinicId: string,
    actorUserId: string | null
  ): Promise<boolean> {
    if (!(await FirstPlanService.trialRequestedAt(clinicId))) return false;
    let started = false;
    try {
      await FirstPlanService.startTrial('clinic', clinicId, actorUserId);
      started = true;
    } catch (err) {
      // Bought a paid plan or used a trial meanwhile: the request no longer applies. Anything else keeps it.
      if (!(err instanceof HttpError && err.status === 409)) throw err;
    }
    await database
      .delete(TrialRequestModel)
      .where(
        and(
          eq(TrialRequestModel.ownerType, 'clinic'),
          eq(TrialRequestModel.ownerId, clinicId)
        )
      );
    return started;
  }

  private static async freeVersionId(ownerType: OwnerType): Promise<string> {
    const { version } = await FirstPlanService.planWithVersion(
      eq(SubscriptionPlanModel.ownerType, ownerType),
      eq(SubscriptionPlanModel.kind, 'free'),
      eq(SubscriptionPlanModel.isDefaultFallback, true)
    );
    if (!version) throw new Error(`No Free plan set up for ${ownerType}`);
    return version.id;
  }

  /** The plan and its version in force now, in one query. */
  private static async planWithVersion(...filters: SQL[]) {
    const now = new Date();
    const [row] = await database
      .select({ plan: SubscriptionPlanModel, version: PlanVersionModel })
      .from(SubscriptionPlanModel)
      .innerJoin(
        PlanVersionModel,
        and(
          eq(PlanVersionModel.planId, SubscriptionPlanModel.id),
          lte(PlanVersionModel.effectiveFrom, now)
        )
      )
      .where(and(...filters))
      .orderBy(desc(PlanVersionModel.effectiveFrom))
      .limit(1);
    return { plan: row?.plan, version: row?.version };
  }

  /** `lock` makes two trial clicks queue, so only the first passes the check. */
  private static async trialFacts(
    db: Db,
    ownerType: OwnerType,
    ownerId: string,
    lock = false
  ) {
    const query = db
      .select({
        id: SubscriptionModel.id,
        status: SubscriptionModel.status,
        isTrial: SubscriptionModel.isTrial,
        planKind: SubscriptionPlanModel.kind,
      })
      .from(SubscriptionModel)
      .innerJoin(
        PlanVersionModel,
        eq(PlanVersionModel.id, SubscriptionModel.planVersionId)
      )
      .innerJoin(
        SubscriptionPlanModel,
        eq(SubscriptionPlanModel.id, PlanVersionModel.planId)
      )
      .where(
        and(
          eq(SubscriptionModel.ownerType, ownerType),
          eq(SubscriptionModel.ownerId, ownerId)
        )
      );
    const rows = lock
      ? await query.for('update', { of: SubscriptionModel })
      : await query;
    const current = rows.find((r) => CURRENT_STATUSES.has(r.status));
    return {
      current,
      // No row at all counts as Free: every owner starts there.
      onFree: !current || current.planKind === 'free',
      hadTrial: rows.some((r) => r.isTrial),
    };
  }
}
