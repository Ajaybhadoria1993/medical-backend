import { and, desc, eq, inArray, isNotNull, lt, lte } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { formatISTDate } from '../../../../utils/istDateTime';
import logger from '../../../../utils/logger';
import { accessEnd } from '../../utils/subscriptionState.utils';
import {
  SubscriptionAddOnModel,
  SubscriptionModel,
} from '../../models/ownerSubscription.model';
import { PlanVersionModel } from '../../models/planVersion.model';
import { SubscriptionPlanModel } from '../../models/subscription.model';
import { pickToDeactivate } from '../../utils/scheduledChange.utils';
import { AccountAccessEmailService } from '../accountAccessEmail.service';
import { LimitationService } from '../limitation.service';
import { SubscriptionActivityService } from '../subscriptionActivity.service';
import { FirstPlanService } from './firstPlan.service';
import { OwnerSubscriptionService } from './ownerSubscription.service';
import { AutoPayService } from '../billing/autoPay.service';
import { AddOnModel } from '../../models/addon.model';
import { SubscriptionPaymentModel } from '../../models/subscriptionPayment.model';
import { capInUnits } from '../../utils/autoPay.utils';
import { AddOnChangeService } from './addOnChange.service';
import { subscriptionNotify } from '../../notify/subscriptionNotify';

type Cycle = 'monthly' | 'yearly';
const asCycle = (c: string | null | undefined): Cycle =>
  c === 'yearly' ? 'yearly' : 'monthly';
const dateText = (d: Date | null) => (d ? formatISTDate(d) : 'period end');

/** Changes that take effect when the current period ends: cancel, downgrade, and the end itself. */
export class ScheduledChangeService {
  static async scheduleCancel(clinicId: string, reason?: string) {
    // Allowed while a renewal is with the bank: renewal capture moves it to the next period.
    const { subscription: sub } =
      await ScheduledChangeService.paidCurrent(clinicId);
    if (sub.cancelAtPeriodEnd) return sub;
    if (sub.scheduledPlanId) {
      throw new HttpError(
        409,
        'A plan change is already scheduled. Undo it before cancelling.'
      );
    }

    const [updated] = await database
      .update(SubscriptionModel)
      .set({
        cancelAtPeriodEnd: true,
        cancelledAt: new Date(),
        cancellationReason: reason || null,
        updatedAt: new Date(),
      })
      .where(eq(SubscriptionModel.id, sub.id))
      .returning();

    await SubscriptionActivityService.record({
      clinicId,
      type: 'cancel_scheduled',
      title: 'Cancellation scheduled',
      description: `Access continues until ${dateText(updated.currentPeriodEnd)}, then the subscription will not renew.`,
      metadata: {
        subscriptionId: sub.id,
        reason: reason || null,
        expiresAt: updated.currentPeriodEnd,
      },
    });
    return updated;
  }

  static async undoCancel(clinicId: string) {
    // Allowed while a renewal is with the bank: renewal capture moves it to the next period.
    const current = await OwnerSubscriptionService.getCurrent(
      'clinic',
      clinicId
    );
    if (!current?.subscription.cancelAtPeriodEnd) {
      throw new HttpError(
        404,
        'No subscription with pending cancellation found'
      );
    }

    const [updated] = await database
      .update(SubscriptionModel)
      .set({
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        cancellationReason: null,
        updatedAt: new Date(),
      })
      .where(eq(SubscriptionModel.id, current.subscription.id))
      .returning();

    await SubscriptionActivityService.record({
      clinicId,
      type: 'cancel_undone',
      title: 'Cancellation withdrawn',
      description: `The subscription will renew as normal on ${dateText(updated.currentPeriodEnd)}.`,
      metadata: { subscriptionId: updated.id },
    });
    return updated;
  }

  /** A paid target applies only when the renewal is paid; unpaid, the period end moves the owner to Free. */
  static async scheduleDowngrade(
    clinicId: string,
    input: {
      targetPlanId: string;
      billingCycle?: Cycle;
      keepDoctorIds?: string[];
      keepStaffIds?: string[];
      exactKeep?: boolean;
    }
  ) {
    // Allowed while a renewal is with the bank: renewal capture moves it to the next period.
    const { subscription: sub, plan } =
      await ScheduledChangeService.paidCurrent(clinicId);
    if (sub.cancelAtPeriodEnd) {
      throw new HttpError(
        409,
        'A cancellation is already scheduled. Undo it before changing the plan.'
      );
    }
    const changeAt = sub.currentPeriodEnd;
    if (!changeAt) {
      throw new HttpError(400, 'This plan has no end date to change at.');
    }

    const [target] = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(
        and(
          eq(SubscriptionPlanModel.id, input.targetPlanId),
          eq(SubscriptionPlanModel.ownerType, 'clinic'),
          eq(SubscriptionPlanModel.isActive, true)
        )
      )
      .limit(1);
    if (!target) throw new HttpError(400, 'Invalid target plan');

    const targetCycle =
      target.kind === 'free'
        ? 'none'
        : (input.billingCycle ?? asCycle(sub.billingCycle));
    if (target.id === plan.id && targetCycle === sub.billingCycle) {
      throw new HttpError(400, 'You are already on this plan');
    }

    const limits = await LimitationService.checkDowngradeLimits(
      clinicId,
      target.id
    );
    const keepDoctorIds = input.keepDoctorIds ?? [];
    const keepStaffIds = input.keepStaffIds ?? [];
    // Exact: a sent keep list is the whole answer for that group; otherwise only the excess goes.
    const offFor = (
      label: string,
      users: { id: string }[],
      excess: number,
      keep: string[],
      sent: boolean
    ) => {
      if (!input.exactKeep || !sent)
        return pickToDeactivate(users, excess, keep);
      const ids = new Set(users.map((u) => u.id));
      if (keep.some((id) => !ids.has(id))) {
        throw new HttpError(
          400,
          `Some ${label} you chose are not part of this clinic.`
        );
      }
      const room = users.length - excess;
      if (keep.length > room) {
        throw new HttpError(
          400,
          `${target.name} has room for ${room} ${label}; you chose ${keep.length}.`
        );
      }
      const kept = new Set(keep);
      return users.filter((u) => !kept.has(u.id)).map((u) => u.id);
    };
    const doctorsOff = offFor(
      'doctors',
      limits.doctors,
      limits.excessDoctors,
      keepDoctorIds,
      input.keepDoctorIds !== undefined
    );
    const staffOff = offFor(
      'staff',
      limits.staff,
      limits.excessStaff,
      keepStaffIds,
      input.keepStaffIds !== undefined
    );
    const noticeUserIds = [...doctorsOff, ...staffOff];
    const noticeEventId = `plan:${sub.id}:${target.id}:${changeAt.toISOString()}:${Date.now()}`;

    await database
      .update(SubscriptionModel)
      .set({
        scheduledPlanId: target.id,
        scheduledBillingCycle: targetCycle,
        scheduledChangeAt: changeAt,
        scheduledStaffChange: {
          keepDoctorIds,
          keepStaffIds,
          noticeUserIds,
          noticeEventId,
          exact: !!input.exactKeep,
        },
        updatedAt: new Date(),
      })
      .where(eq(SubscriptionModel.id, sub.id));

    const summary = `a plan downgrade from ${plan.name} to ${target.name}`;
    await SubscriptionActivityService.record({
      clinicId,
      type: 'plan_change_scheduled',
      title: `Plan change scheduled: ${target.name}`,
      description: `Your current plan stays active until ${dateText(changeAt)}, when it switches to ${target.name}.`,
      metadata: {
        subscriptionId: sub.id,
        fromPlanId: plan.id,
        toPlanId: target.id,
        toPlanName: target.name,
        effectiveAt: changeAt,
        preferredActiveDoctorIds: keepDoctorIds,
        preferredActiveStaffIds: keepStaffIds,
        deactivationNoticeUserIds: noticeUserIds,
        deactivationNoticeEventId: noticeEventId,
        deactivationNoticeEffectiveAt: changeAt.toISOString(),
        deactivationNoticeSummary: summary,
      },
    });
    if (noticeUserIds.length > 0) {
      await AccountAccessEmailService.notifyScheduledDeactivation({
        clinicId,
        userIds: noticeUserIds,
        eventId: noticeEventId,
        changeKind: 'plan_downgrade',
        changeSummary: summary,
        effectiveAt: changeAt,
      });
    }
    const names = (
      users: { id: string; name: string | null }[],
      off: string[],
      keep: boolean,
      fallback: string
    ) =>
      users
        .filter((u) => off.includes(u.id) !== keep)
        .map((u) => u.name || fallback);
    await subscriptionNotify(
      'subscription.change_scheduled',
      {
        clinicId,
        planName: target.name,
        effectiveAt: changeAt,
        scheduled: true,
        fromBillingCycle: asCycle(sub.billingCycle),
        billingCycle: asCycle(targetCycle),
        accountImpact: {
          continuingDoctors: names(
            limits.doctors,
            doctorsOff,
            true,
            'Unnamed doctor'
          ),
          deactivatedDoctors: names(
            limits.doctors,
            doctorsOff,
            false,
            'Unnamed doctor'
          ),
          continuingStaff: names(
            limits.staff,
            staffOff,
            true,
            'Unnamed staff member'
          ),
          deactivatedStaff: names(
            limits.staff,
            staffOff,
            false,
            'Unnamed staff member'
          ),
        },
      },
      `${sub.id}|downgrade|${target.id}|${changeAt.toISOString()}`
    );

    return { targetPlan: target, effectiveAt: changeAt };
  }

  static async undoDowngrade(clinicId: string) {
    await OwnerSubscriptionService.assertNoRenewalInFlight(clinicId);
    const current = await OwnerSubscriptionService.getCurrent(
      'clinic',
      clinicId
    );
    const sub = current?.subscription;
    if (!current || !sub?.scheduledPlanId) {
      throw new HttpError(404, 'No scheduled plan change found');
    }
    const [target] = await database
      .select({ name: SubscriptionPlanModel.name })
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, sub.scheduledPlanId))
      .limit(1);

    await database
      .update(SubscriptionModel)
      .set({
        scheduledPlanId: null,
        scheduledBillingCycle: null,
        scheduledChangeAt: null,
        scheduledStaffChange: null,
        updatedAt: new Date(),
      })
      .where(eq(SubscriptionModel.id, sub.id));

    await SubscriptionActivityService.record({
      clinicId,
      type: 'plan_change_scheduled',
      title: 'Scheduled plan change withdrawn',
      description: 'You will stay on your current plan.',
      metadata: {
        subscriptionId: sub.id,
        cancelledScheduledPlanId: sub.scheduledPlanId,
      },
    });
    const told = sub.scheduledStaffChange;
    if (told?.noticeUserIds.length) {
      await AccountAccessEmailService.notifyDowngradeReversed({
        clinicId,
        userIds: told.noticeUserIds,
        eventId: `reversed:${told.noticeEventId}:${Date.now()}`,
        currentPlanName: current.plan.name,
        cancelledPlanName: target?.name || 'scheduled plan',
        effectiveAt: sub.scheduledChangeAt,
      });
    }
    await subscriptionNotify(
      'subscription.change_undone',
      {
        clinicId,
        currentPlanName: current.plan.name,
        cancelledPlanName: target?.name || 'scheduled plan',
      },
      `${sub.id}|undo|${sub.scheduledChangeAt?.toISOString() ?? ''}|${Date.now()}`
    );
  }

  /** Trials and unrenewed paid periods whose last IST day is over move to Free; a second run finds nothing. */
  /**
   * 00:05 IST: a clinic that paid the next period on its scheduled plan switches to it on the day
   * that period starts; add-ons the new plan doesn't allow end, others are capped. Safe to rerun.
   */
  static async applyPaidSwitches(
    now: Date = new Date(),
    onlySubscriptionId?: string
  ) {
    const due = await database
      .select()
      .from(SubscriptionModel)
      .where(
        and(
          isNotNull(SubscriptionModel.scheduledPlanId),
          // The current period has started; whether it was paid on the scheduled plan is checked below.
          lte(SubscriptionModel.currentPeriodStart, now),
          inArray(SubscriptionModel.status, ['active', 'past_due']),
          onlySubscriptionId
            ? eq(SubscriptionModel.id, onlySubscriptionId)
            : undefined
        )
      )
      .limit(200);
    let switched = 0;
    for (const sub of due) {
      try {
        const [paid] = await database
          .select({ lines: SubscriptionPaymentModel.lines })
          .from(SubscriptionPaymentModel)
          .where(
            and(
              eq(SubscriptionPaymentModel.subscriptionId, sub.id),
              eq(SubscriptionPaymentModel.kind, 'renewal'),
              eq(SubscriptionPaymentModel.status, 'captured'),
              // The payment for the period now running.
              eq(SubscriptionPaymentModel.periodStart, sub.currentPeriodStart!)
            )
          )
          .orderBy(desc(SubscriptionPaymentModel.createdAt))
          .limit(1);
        const line = paid?.lines.items.find((l) => l.kind === 'plan');
        if (!line?.planVersionId) continue;
        const versionId = line.planVersionId;
        // Only a payment for the scheduled plan switches it; an unpaid period waits for the period-end job.
        const [paidPlan] = await database
          .select({ planId: PlanVersionModel.planId })
          .from(PlanVersionModel)
          .where(eq(PlanVersionModel.id, versionId))
          .limit(1);
        if (paidPlan?.planId !== sub.scheduledPlanId) continue;
        const keep = sub.scheduledStaffChange;
        const dropped = await database.transaction(async (tx) => {
          const [row] = await tx
            .update(SubscriptionModel)
            .set({
              planVersionId: versionId,
              billingCycle: sub.scheduledBillingCycle ?? sub.billingCycle,
              scheduledPlanId: null,
              scheduledBillingCycle: null,
              scheduledChangeAt: null,
              scheduledStaffChange: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(SubscriptionModel.id, sub.id),
                isNotNull(SubscriptionModel.scheduledPlanId)
              )
            )
            .returning({ id: SubscriptionModel.id });
          if (!row) return null;
          const caps = await AddOnChangeService.capsForVersion(versionId, tx);
          const addOns = await tx
            .select({
              id: SubscriptionAddOnModel.id,
              addOnId: SubscriptionAddOnModel.addOnId,
              quantity: SubscriptionAddOnModel.quantity,
              unitValue: AddOnModel.unitValue,
              name: AddOnModel.name,
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
            );
          const ended: string[] = [];
          for (const a of addOns) {
            const cap = caps.get(a.addOnId);
            const allowed =
              cap === undefined
                ? 0
                : cap === null
                  ? a.quantity
                  : Math.min(a.quantity, capInUnits(cap, a.unitValue));
            if (allowed === a.quantity) continue;
            if (allowed <= 0) ended.push(a.name);
            await tx
              .update(SubscriptionAddOnModel)
              .set(
                allowed <= 0
                  ? { status: 'cancelled', updatedAt: now }
                  : { quantity: allowed, updatedAt: now }
              )
              .where(eq(SubscriptionAddOnModel.id, a.id));
          }
          return ended;
        });
        if (dropped === null || sub.ownerType !== 'clinic') continue;
        switched++;
        await LimitationService.invalidateClinicCache(sub.ownerId);
        // The staff the clinic chose to keep when it scheduled the change stay active.
        if (keep?.exact)
          await LimitationService.switchOff(sub.ownerId, keep.noticeUserIds);
        await LimitationService.enforceStaffLimitsOnExpiry(
          sub.ownerId,
          keep?.keepDoctorIds ?? [],
          keep?.keepStaffIds ?? []
        );
        const [plan] = await database
          .select({ name: SubscriptionPlanModel.name })
          .from(PlanVersionModel)
          .innerJoin(
            SubscriptionPlanModel,
            eq(SubscriptionPlanModel.id, PlanVersionModel.planId)
          )
          .where(eq(PlanVersionModel.id, versionId))
          .limit(1);
        await SubscriptionActivityService.record({
          clinicId: sub.ownerId,
          type: 'plan_downgraded',
          title: `Switched to ${plan?.name ?? 'the new plan'}`,
          description: dropped.length
            ? `Ended with the switch: ${dropped.join(', ')}.`
            : null,
          metadata: { subscriptionId: sub.id, planVersionId: versionId },
        });
      } catch (e) {
        logger.error(
          `[ScheduledChange] Could not apply the paid switch for ${sub.id}:`,
          e
        );
      }
    }
    return { due: due.length, switched };
  }

  /** `ownerId`: only that clinic (the staging test tool); the daily job passes none. */
  static async endDuePeriods(now: Date = new Date(), ownerId?: string) {
    const due = (
      await database
        .select({
          id: SubscriptionModel.id,
          ownerType: SubscriptionModel.ownerType,
          ownerId: SubscriptionModel.ownerId,
          currentPeriodEnd: SubscriptionModel.currentPeriodEnd,
          cancelAtPeriodEnd: SubscriptionModel.cancelAtPeriodEnd,
          isTrial: SubscriptionModel.isTrial,
          status: SubscriptionModel.status,
          planName: SubscriptionPlanModel.name,
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
            inArray(SubscriptionModel.status, [
              'trialing',
              'active',
              'past_due',
            ]),
            eq(SubscriptionPlanModel.kind, 'paid'),
            lt(SubscriptionModel.currentPeriodEnd, now),
            ownerId ? eq(SubscriptionModel.ownerId, ownerId) : undefined
          )
        )
    )
      .map((t) => ({ ...t, endedAt: accessEnd({ ...t, planKind: 'paid' }) }))
      .filter((t) => t.endedAt && t.endedAt < now);

    let ended = 0;
    const errors: string[] = [];
    for (const t of due) {
      // Decision L: a renewal the bank is still deciding keeps the plan; the payment check settles it.
      if (
        t.currentPeriodEnd &&
        (await OwnerSubscriptionService.renewalPending(
          t.id,
          t.currentPeriodEnd
        ))
      ) {
        continue;
      }
      try {
        const keep = await database.transaction(async (tx) => {
          // Only the run that flips the status goes on, so two servers never end it twice.
          const [row] = await tx
            .update(SubscriptionModel)
            .set({
              status: t.cancelAtPeriodEnd ? 'cancelled' : 'expired',
              endedAt: t.endedAt,
              updatedAt: now,
            })
            .where(
              and(
                eq(SubscriptionModel.id, t.id),
                inArray(SubscriptionModel.status, [
                  'trialing',
                  'active',
                  'past_due',
                ])
              )
            )
            .returning({ staff: SubscriptionModel.scheduledStaffChange });
          if (!row) return null;
          // Add-ons follow the period, so they end with it.
          await tx
            .update(SubscriptionAddOnModel)
            .set({ status: 'cancelled', updatedAt: now })
            .where(
              and(
                eq(SubscriptionAddOnModel.subscriptionId, t.id),
                eq(SubscriptionAddOnModel.status, 'active')
              )
            );
          await FirstPlanService.assignFreePlan(t.ownerType, t.ownerId, {
            db: tx,
            startsAt: t.endedAt!,
          });
          return row.staff ?? { keepDoctorIds: [], keepStaffIds: [] };
        });
        if (!keep) continue;
        ended++;
        if (t.ownerType !== 'clinic') continue;

        // The cached plan must not outlive the period, or the limits below would read the old one.
        await LimitationService.invalidateClinicCache(t.ownerId);
        await AutoPayService.stop(t.ownerId, 'Plan ended; moved to Free');
        if ('exact' in keep && keep.exact)
          await LimitationService.switchOff(t.ownerId, keep.noticeUserIds);
        await LimitationService.enforceStaffLimitsOnExpiry(
          t.ownerId,
          keep.keepDoctorIds,
          keep.keepStaffIds
        );
        await SubscriptionActivityService.record({
          clinicId: t.ownerId,
          type: 'subscription_expired',
          title: `${t.planName} ended`,
          description: 'The clinic is on the Free plan from here on.',
          metadata: { subscriptionId: t.id, endedAt: t.endedAt },
        });
        await subscriptionNotify(
          'subscription.expired',
          {
            clinicId: t.ownerId,
            planName: t.planName,
            endedAt: t.endedAt!,
            cancelled: t.cancelAtPeriodEnd,
          },
          t.id
        );
      } catch (e) {
        logger.error(`[ScheduledChange] Could not end period ${t.id}:`, e);
        errors.push(t.id);
      }
    }
    return { due: due.length, ended, errors };
  }

  private static async paidCurrent(clinicId: string) {
    const current = await OwnerSubscriptionService.getCurrent(
      'clinic',
      clinicId
    );
    if (!current?.state.isValid) {
      throw new HttpError(404, 'No active subscription found');
    }
    if (current.plan.kind === 'free') {
      throw new HttpError(
        400,
        'You are on the Free plan, so there is nothing to change.'
      );
    }
    return current;
  }
}
