import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { HttpError } from '../../../../middlewear/errorHandler';
import { database } from '../../../../configurations/dbConnection';
import {
  SubscriptionAddOnModel,
  SubscriptionModel,
  type Subscription,
} from '../../models/ownerSubscription.model';
import { PlanVersionModel } from '../../models/planVersion.model';
import { SubscriptionPlanModel } from '../../models/subscription.model';
import { SubscriptionPaymentModel } from '../../models/subscriptionPayment.model';
import { subscriptionState } from '../../utils/subscriptionState.utils';
import type { Db } from '../../types/db.types';

export type OwnerType = Subscription['ownerType'];

const CURRENT_STATUSES: Subscription['status'][] = [
  'trialing',
  'active',
  'past_due',
];

export class OwnerSubscriptionService {
  static async getCurrent(
    ownerType: OwnerType,
    ownerId: string,
    now: Date = new Date()
  ) {
    const [row] = await database
      .select({
        subscription: SubscriptionModel,
        version: PlanVersionModel,
        plan: SubscriptionPlanModel,
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
          eq(SubscriptionModel.ownerId, ownerId),
          inArray(SubscriptionModel.status, CURRENT_STATUSES)
        )
      )
      .limit(1);
    if (!row) return null;

    const state = subscriptionState(
      { ...row.subscription, planKind: row.plan.kind },
      now
    );
    // Decision L: while the bank decides on a renewal, the clinic keeps full access.
    if (
      state.state === 'expired' &&
      row.subscription.currentPeriodEnd &&
      (await OwnerSubscriptionService.renewalPending(
        row.subscription.id,
        row.subscription.currentPeriodEnd
      ))
    ) {
      return {
        ...row,
        state: { ...state, state: 'active' as const, isValid: true },
      };
    }
    return { ...row, state };
  }

  /** Blocks plan changes and add-on removals while an AutoPay renewal waits for the bank: it was priced on what the clinic has now. */
  static async assertNoRenewalInFlight(clinicId: string) {
    const current = await OwnerSubscriptionService.getCurrent(
      'clinic',
      clinicId
    );
    const end = current?.subscription.currentPeriodEnd;
    if (
      end &&
      (await OwnerSubscriptionService.renewalPending(
        current.subscription.id,
        end
      ))
    ) {
      throw new HttpError(
        409,
        'Your renewal payment is being processed. You can change your plan or add-ons once it completes, usually within 1–2 days.'
      );
    }
  }

  /** A renewal for the period after this one, sent to the bank and not yet answered; null if none. */
  static async renewalPending(subscriptionId: string, periodEnd: Date) {
    const [row] = await database
      .select({ periodEnd: SubscriptionPaymentModel.periodEnd })
      .from(SubscriptionPaymentModel)
      .where(
        and(
          eq(SubscriptionPaymentModel.subscriptionId, subscriptionId),
          eq(SubscriptionPaymentModel.kind, 'renewal'),
          eq(SubscriptionPaymentModel.periodStart, periodEnd),
          eq(SubscriptionPaymentModel.status, 'pending')
        )
      )
      .limit(1);
    return row ?? null;
  }

  /** The AutoPay order already sent for the next period (pre-debit notice out), with its frozen amount and lines. */
  static async scheduledRenewal(subscriptionId: string, periodEnd: Date) {
    const [row] = await database
      .select({
        amountPaise: SubscriptionPaymentModel.amountPaise,
        lines: SubscriptionPaymentModel.lines,
      })
      .from(SubscriptionPaymentModel)
      .where(
        and(
          eq(SubscriptionPaymentModel.subscriptionId, subscriptionId),
          eq(SubscriptionPaymentModel.kind, 'renewal'),
          eq(SubscriptionPaymentModel.periodStart, periodEnd),
          inArray(SubscriptionPaymentModel.status, ['created', 'pending']),
          isNotNull(SubscriptionPaymentModel.mandateId),
          isNotNull(SubscriptionPaymentModel.providerOrderId)
        )
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * The owner's account was closed (deactivated, blocked, deleted or reset): end the current
   * plan and its add-ons so nothing renews. Payments and invoices stay; returns the ended row id.
   */
  static async onOwnerClosed(
    ownerType: OwnerType,
    ownerId: string,
    reason: string,
    db: Db = database
  ): Promise<string | null> {
    const now = new Date();
    const [ended] = await db
      .update(SubscriptionModel)
      .set({
        status: 'cancelled',
        endedAt: now,
        cancelledAt: now,
        cancellationReason: reason.slice(0, 255),
        scheduledPlanId: null,
        scheduledBillingCycle: null,
        scheduledChangeAt: null,
        scheduledStaffChange: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(SubscriptionModel.ownerType, ownerType),
          eq(SubscriptionModel.ownerId, ownerId),
          inArray(SubscriptionModel.status, CURRENT_STATUSES)
        )
      )
      .returning({ id: SubscriptionModel.id });
    if (!ended) return null;

    await db
      .update(SubscriptionAddOnModel)
      .set({ status: 'cancelled', scheduledQuantity: null, updatedAt: now })
      .where(
        and(
          eq(SubscriptionAddOnModel.subscriptionId, ended.id),
          eq(SubscriptionAddOnModel.status, 'active')
        )
      );
    return ended.id;
  }
}
