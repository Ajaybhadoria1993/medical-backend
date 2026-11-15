import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { addOnPriceNow } from '../../models/addOnPrice.model';
import { database } from '../../../../configurations/dbConnection';
import { istDaysBetween } from '../../../../utils/istDateTime';
import logger from '../../../../utils/logger';
import { fromPaise, toPaise } from '../../../money';
import { AddOnModel } from '../../models/addon.model';
import {
  SubscriptionAddOnModel,
  SubscriptionModel,
} from '../../models/ownerSubscription.model';
import { PlanVersionModel } from '../../models/planVersion.model';
import { SubscriptionPlanModel } from '../../models/subscription.model';
import { notify } from '../../../notifications/queues/notification.queue';
import { subscriptionNotify } from '../../notify/subscriptionNotify';
import { PlansService } from './plans.service';
import { OwnerSubscriptionService } from './ownerSubscription.service';
import { accessEnd, GRACE_DAYS } from '../../utils/subscriptionState.utils';
import { getClinicPort } from '../../ports';

const TRIAL_DAYS = [3, 1];
const RENEWAL_DAYS = [7, 3, 1];
const MAX_DAYS = Math.max(...TRIAL_DAYS, ...RENEWAL_DAYS);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Daily trial-ending and renewal reminders on the new tables; the queue's dedupe key makes a rerun send nothing. */
export class LifecycleRemindersService {
  /** `clinicId`: only that clinic (the staging test tool); the daily job passes none. */
  static async run(now = new Date(), clinicId?: string) {
    const found = await database
      .select({
        id: SubscriptionModel.id,
        clinicId: SubscriptionModel.ownerId,
        isTrial: SubscriptionModel.isTrial,
        billingCycle: SubscriptionModel.billingCycle,
        periodEnd: SubscriptionModel.currentPeriodEnd,
        cancelAtPeriodEnd: SubscriptionModel.cancelAtPeriodEnd,
        scheduledPlanId: SubscriptionModel.scheduledPlanId,
        planId: SubscriptionPlanModel.id,
        planName: SubscriptionPlanModel.name,
        kind: SubscriptionPlanModel.kind,
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
          eq(SubscriptionModel.ownerType, 'clinic'),
          clinicId ? eq(SubscriptionModel.ownerId, clinicId) : undefined,
          inArray(SubscriptionModel.status, ['trialing', 'active', 'past_due']),
          // Periods ending within the reminder window, or ended within the grace days.
          gte(
            SubscriptionModel.currentPeriodEnd,
            new Date(now.getTime() - (GRACE_DAYS + 1) * DAY_MS)
          ),
          lte(
            SubscriptionModel.currentPeriodEnd,
            new Date(now.getTime() + (MAX_DAYS + 1) * DAY_MS)
          )
        )
      );
    const clinics = await getClinicPort().getClinics(
      found.map((r) => r.clinicId)
    );
    const rows = found.flatMap((r) => {
      const c = clinics.get(r.clinicId);
      return c
        ? [{ ...r, clinicName: c.name, adminUserId: c.ownerUserId }]
        : [];
    });
    const renewalPaise = await LifecycleRemindersService.renewalAmounts(
      rows,
      now
    );

    let queued = 0;
    const errors: string[] = [];
    for (const r of rows) {
      const daysLeft = istDaysBetween(now, r.periodEnd!);
      const key = `${r.id}|${r.periodEnd!.toISOString()}|${daysLeft}`;
      try {
        if (r.isTrial && TRIAL_DAYS.includes(daysLeft)) {
          await subscriptionNotify(
            'subscription.trial_ending',
            {
              clinicId: r.clinicId,
              planName: r.planName,
              trialEndsAt: r.periodEnd!,
              daysLeft,
            },
            key
          );
          queued++;
        }
        // A cancel or downgrade already chose not to renew, so no renewal reminder for it.
        const renews =
          !r.isTrial &&
          r.kind === 'paid' &&
          !r.cancelAtPeriodEnd &&
          !r.scheduledPlanId &&
          (r.billingCycle === 'monthly' || r.billingCycle === 'yearly');
        // First and last grace day: the renewal is overdue but access continues.
        if (renews && (daysLeft === -1 || daysLeft === -GRACE_DAYS)) {
          const pending = await OwnerSubscriptionService.renewalPending(
            r.id,
            r.periodEnd!
          );
          if (!pending) {
            await subscriptionNotify(
              'subscription.renewal_reminder',
              {
                clinicId: r.clinicId,
                planName: r.planName,
                billingCycle: r.billingCycle,
                periodEnd: r.periodEnd!,
                amount: fromPaise(renewalPaise.get(r.id) ?? 0),
                daysLeft,
                graceUntil: accessEnd({
                  status: 'active',
                  isTrial: false,
                  currentPeriodEnd: r.periodEnd,
                  planKind: 'paid',
                }),
              },
              key
            );
            queued++;
          }
        }
        if (renews && RENEWAL_DAYS.includes(daysLeft)) {
          const amount = fromPaise(renewalPaise.get(r.id) ?? 0);
          await subscriptionNotify(
            'subscription.renewal_reminder',
            {
              clinicId: r.clinicId,
              planName: r.planName,
              billingCycle: r.billingCycle,
              periodEnd: r.periodEnd!,
              amount,
              daysLeft,
            },
            key
          );
          // The in-app notice collapses into one row per clinic, so each day replaces the last.
          await notify('subscription.expiring', {
            clinicId: r.clinicId,
            clinicName: r.clinicName,
            adminUserId: r.adminUserId,
            planName: r.planName,
            totalAmount: amount,
            daysRemaining: daysLeft,
          });
          queued++;
        }
      } catch (e) {
        logger.error(`[LifecycleReminders] subscription ${r.id} failed:`, e);
        errors.push(r.id);
      }
    }
    return { checked: rows.length, queued, errors };
  }

  /** What each renewal will cost: the plan's version in force plus add-ons at next period's quantity, as the renewal quote prices it. */
  private static async renewalAmounts(
    rows: { id: string; planId: string; billingCycle: string }[],
    now: Date
  ) {
    const amounts = new Map<string, number>();
    if (!rows.length) return amounts;
    const [versions, addOns] = await Promise.all([
      PlansService.currentVersions(
        [...new Set(rows.map((r) => r.planId))],
        now
      ),
      database
        .select({
          subscriptionId: SubscriptionAddOnModel.subscriptionId,
          quantity: SubscriptionAddOnModel.quantity,
          scheduledQuantity: SubscriptionAddOnModel.scheduledQuantity,
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
            inArray(
              SubscriptionAddOnModel.subscriptionId,
              rows.map((r) => r.id)
            ),
            eq(SubscriptionAddOnModel.status, 'active')
          )
        ),
    ]);
    const yearly = (cycle: string) => cycle === 'yearly';
    for (const r of rows) {
      const v = versions.get(r.planId);
      const plan = v
        ? toPaise(
            (yearly(r.billingCycle) ? v.yearlyPrice : v.monthlyPrice) ?? 0
          )
        : 0;
      const extras = addOns
        .filter((a) => a.subscriptionId === r.id)
        .reduce((sum, a) => {
          const qty = a.scheduledQuantity ?? a.quantity;
          return qty > 0
            ? sum +
                toPaise(
                  (yearly(r.billingCycle) ? a.yearlyPrice : a.monthlyPrice) ?? 0
                ) *
                  qty
            : sum;
        }, 0);
      amounts.set(r.id, plan + extras);
    }
    return amounts;
  }

  /** A new version that raises the price a paying clinic will pay at its next renewal tells that clinic. */
  /** `revision` makes an edited version email again; the same revision never sends twice. */
  static async priceChange(
    version: {
      id: string;
      planId: string;
      monthlyPrice: string | null;
      yearlyPrice: string | null;
      effectiveFrom: Date;
    },
    revision = ''
  ) {
    const rows = await database
      .select({
        clinicId: SubscriptionModel.ownerId,
        billingCycle: SubscriptionModel.billingCycle,
        monthlyPrice: PlanVersionModel.monthlyPrice,
        yearlyPrice: PlanVersionModel.yearlyPrice,
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
          eq(SubscriptionModel.ownerType, 'clinic'),
          eq(PlanVersionModel.planId, version.planId),
          inArray(SubscriptionModel.status, ['active', 'past_due']),
          eq(SubscriptionModel.isTrial, false)
        )
      );
    for (const r of rows) {
      const cycle = r.billingCycle === 'yearly' ? 'yearly' : 'monthly';
      const oldPrice = cycle === 'yearly' ? r.yearlyPrice : r.monthlyPrice;
      const newPrice =
        cycle === 'yearly' ? version.yearlyPrice : version.monthlyPrice;
      // A cut, an unchanged price or a cycle the new version stops selling sends nothing here.
      if (
        oldPrice === null ||
        newPrice === null ||
        Number(newPrice) <= Number(oldPrice)
      )
        continue;
      await subscriptionNotify(
        'subscription.price_change',
        {
          clinicId: r.clinicId,
          planName: r.planName,
          billingCycle: cycle,
          oldPrice: Number(oldPrice).toFixed(2),
          newPrice: Number(newPrice).toFixed(2),
          from: version.effectiveFrom,
        },
        `${r.clinicId}|${version.id}${revision ? `|${revision}` : ''}`
      );
    }
  }
}
