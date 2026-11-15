import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { fromPaise, toPaise } from '../../../money';
import { SubscriptionModel } from '../../models/ownerSubscription.model';
import { PlanVersionModel } from '../../models/planVersion.model';
import { SubscriptionPlanModel } from '../../models/subscription.model';
import { BillingTaxRateModel } from '../../models/taxRate.model';
import { subscriptionNotify } from '../../notify/subscriptionNotify';
import type { TaxSetting } from '../../types/tax.types';
import { startOfDayIST } from '../../../../utils/istDateTime';
import type { ScheduleTaxRateInput } from '../../schemas/taxRate.schemas';
import {
  applyTax,
  GST_NOTICE_DAYS,
  raisesPrice,
} from '../../utils/invoiceTax.utils';
import { DAY_MS } from '../../utils/billingChecks.utils';
import { PlansService } from '../core/plans.service';
import { TaxService } from './tax.service';

/** Super Admin GST settings: schedule a change, undo it before it starts, see the history and its effect. */
export class TaxAdminService {
  static async overview() {
    const now = new Date();
    const [{ current, upcoming }, history] = await Promise.all([
      TaxService.snapshot(now),
      database
        .select()
        .from(BillingTaxRateModel)
        .orderBy(desc(BillingTaxRateModel.effectiveFrom))
        .limit(50),
    ]);
    return { current, upcoming, history, noticeDays: GST_NOTICE_DAYS };
  }

  /** Each plan on sale, today and under the proposed setting, so the screen shows what clinics will pay. */
  static async preview(next: TaxSetting) {
    // Prices only: two light queries instead of the full plan catalogue with features.
    const [current, plans] = await Promise.all([
      TaxService.inForce(),
      database
        .select({
          id: SubscriptionPlanModel.id,
          name: SubscriptionPlanModel.name,
        })
        .from(SubscriptionPlanModel)
        .where(
          and(
            eq(SubscriptionPlanModel.ownerType, 'clinic'),
            eq(SubscriptionPlanModel.isActive, true),
            eq(SubscriptionPlanModel.kind, 'paid')
          )
        ),
    ]);
    const versions = await PlansService.currentVersions(plans.map((p) => p.id));
    return {
      current,
      next,
      raisesPrice: raisesPrice(current, next),
      plans: plans
        .flatMap((plan) => {
          const version = versions.get(plan.id);
          return version ? [{ plan, version }] : [];
        })
        .map(({ plan, version }) => {
          const row = (price: string | null) => {
            if (price === null) return null;
            const paise = toPaise(price);
            return {
              now: fromPaise(applyTax(paise, current).totalPaise),
              next: fromPaise(applyTax(paise, next).totalPaise),
            };
          };
          return {
            planId: plan.id,
            name: plan.name,
            monthly: row(version.monthlyPrice),
            yearly: row(version.yearlyPrice),
          };
        }),
    };
  }

  static async schedule(input: ScheduleTaxRateInput, userId: string) {
    const now = new Date();
    const next: TaxSetting = {
      rateBp: Math.round(input.ratePercent * 100),
      mode: input.mode,
    };
    const startsAt = input.applyNow ? now : startOfDayIST(input.effectiveFrom!);
    if (startsAt.getTime() < now.getTime() - 60_000) {
      throw new HttpError(
        400,
        'A GST change cannot start in the past. Pick today or a later date.'
      );
    }
    const { current } = await TaxService.snapshot(now);
    if (current.rateBp === next.rateBp && current.mode === next.mode) {
      throw new HttpError(400, 'This is already the GST in force.');
    }
    const raises = raisesPrice(current, next);
    const noticeDays = raises && !input.applyNow ? GST_NOTICE_DAYS : 0;
    if (
      noticeDays &&
      startsAt.getTime() < now.getTime() + (GST_NOTICE_DAYS - 1) * DAY_MS
    ) {
      throw new HttpError(
        400,
        `This change makes clinics pay more, so it needs ${GST_NOTICE_DAYS} days' notice. Pick a later date, or choose to apply it now without notice.`
      );
    }

    const row = await database.transaction(async (tx) => {
      // One save at a time, then check the table itself (not the cache): two Super Admins can't both schedule.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('billing_tax_rates'))`
      );
      const [pending] = await tx
        .select({ id: BillingTaxRateModel.id })
        .from(BillingTaxRateModel)
        .where(
          and(
            isNull(BillingTaxRateModel.cancelledAt),
            gt(BillingTaxRateModel.effectiveFrom, now)
          )
        )
        .limit(1);
      // One pending change at a time, so clinics are never told two different prices.
      if (pending) {
        throw new HttpError(
          409,
          'A GST change is already scheduled. Undo it first, then schedule the new one.'
        );
      }
      const [created] = await tx
        .insert(BillingTaxRateModel)
        .values({
          rateBp: next.rateBp,
          mode: next.mode,
          effectiveFrom: startsAt,
          noticeDays,
          reason: input.reason,
          createdBy: userId,
        })
        .returning();
      return created!;
    });
    await TaxService.invalidate();
    if (noticeDays)
      await TaxAdminService.notifyClinics(row.id, current, next, startsAt);
    return row;
  }

  /** Undo a change that has not started; one already in force is changed by scheduling a new one. */
  static async undo(id: string, userId: string) {
    const now = new Date();
    const [row] = await database
      .update(BillingTaxRateModel)
      .set({ cancelledAt: now, cancelledBy: userId })
      .where(
        and(
          eq(BillingTaxRateModel.id, id),
          isNull(BillingTaxRateModel.cancelledAt),
          gt(BillingTaxRateModel.effectiveFrom, now)
        )
      )
      .returning();
    if (!row) {
      throw new HttpError(
        409,
        'Only a GST change that has not started yet can be undone.'
      );
    }
    await TaxService.invalidate();
    return row;
  }

  /** Emails every paying clinic whose next bill goes up, once per change. */
  private static async notifyClinics(
    changeId: string,
    current: TaxSetting,
    next: TaxSetting,
    from: Date
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
          inArray(SubscriptionModel.status, ['active', 'past_due']),
          eq(SubscriptionModel.isTrial, false)
        )
      );
    for (const r of rows) {
      const cycle = r.billingCycle === 'yearly' ? 'yearly' : 'monthly';
      const price = cycle === 'yearly' ? r.yearlyPrice : r.monthlyPrice;
      if (price === null || Number(price) <= 0) continue;
      const paise = toPaise(Number(price));
      const oldTotal = applyTax(paise, current).totalPaise;
      const newTotal = applyTax(paise, next).totalPaise;
      if (newTotal <= oldTotal) continue;
      // ponytail: reuses the plan price-change email; a GST-specific template can say "because GST changed".
      await subscriptionNotify(
        'subscription.price_change',
        {
          clinicId: r.clinicId,
          planName: r.planName,
          billingCycle: cycle,
          oldPrice: fromPaise(oldTotal),
          newPrice: fromPaise(newTotal),
          from,
        },
        `${r.clinicId}|gst|${changeId}`
      );
    }
  }
}
