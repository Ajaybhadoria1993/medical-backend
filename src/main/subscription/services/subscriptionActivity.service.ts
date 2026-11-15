import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import logger from '../../../utils/logger';
import { IST_TIMEZONE } from '../../../utils/istDateTime';
import { decodeAddOnItems } from '../utils/razorpayOrder.utils';
import { AddOnModel } from '../models/addon.model';
import { SubscriptionPlanModel } from '../models/subscription.model';
import {
  SubscriptionActivityModel,
  type SubscriptionActivityType,
} from '../models/subscriptionActivity.model';

export interface RecordActivityInput {
  clinicId: string;
  type: SubscriptionActivityType;
  title: string;
  description?: string | null;
  amount?: number | string | null;
  currency?: string;
  actorUserId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PaymentFailureOrderNotes {
  planId?: string;
  providerSubscriptionId?: string;
  addOnItems?: string;
}

/**
 * Append-only writer/reader for the subscription activity timeline.
 *
 * Every subscription mutation calls `record()`. It is deliberately
 * best-effort: an audit row failing to insert must never fail the billing
 * operation that produced it — losing one timeline entry is a far smaller
 * problem than rolling back a payment or leaving a Razorpay mandate
 * half-cancelled.
 */
export class SubscriptionActivityService {
  /**
   * Check whether a payment failure has already been recorded for an order.
   */
  static async hasPaymentFailureForOrder(
    clinicId: string,
    orderId?: string | null
  ): Promise<boolean> {
    if (!orderId) return false;

    const [existing] = await database
      .select({ id: SubscriptionActivityModel.id })
      .from(SubscriptionActivityModel)
      .where(
        and(
          eq(SubscriptionActivityModel.clinicId, clinicId),
          eq(SubscriptionActivityModel.type, 'payment_failed'),
          sql`${SubscriptionActivityModel.metadata}->>'orderId' = ${orderId}`
        )
      )
      .limit(1);

    return Boolean(existing);
  }

  /** Check for a repeated client failure report when an order ID is unavailable. */
  static async hasPaymentFailureForReportId(
    clinicId: string,
    failureReportId?: string | null
  ): Promise<boolean> {
    if (!failureReportId) return false;

    const [existing] = await database
      .select({ id: SubscriptionActivityModel.id })
      .from(SubscriptionActivityModel)
      .where(
        and(
          eq(SubscriptionActivityModel.clinicId, clinicId),
          eq(SubscriptionActivityModel.type, 'payment_failed'),
          sql`${SubscriptionActivityModel.metadata}->>'failureReportId' = ${failureReportId}`
        )
      )
      .limit(1);

    return Boolean(existing);
  }

  /**
   * Resolve the item-specific title used by payment-failure activity entries.
   */
  static async resolvePaymentFailureDetails(
    notes: PaymentFailureOrderNotes
  ): Promise<{ title: string; itemName: string | null }> {
    let itemName: string | null = null;

    if (notes.addOnItems) {
      const items = decodeAddOnItems(notes.addOnItems);
      if (items.length > 0) {
        const addOnIds = items.map((item) => item.addOnId);
        const addOns = await database
          .select({ id: AddOnModel.id, name: AddOnModel.name })
          .from(AddOnModel)
          .where(inArray(AddOnModel.id, addOnIds));

        if (addOns.length > 0) {
          itemName = addOns.map((addOn) => addOn.name).join(', ');
        }
      }
    }

    if (!itemName && notes.planId) {
      const [plan] = await database
        .select({ name: SubscriptionPlanModel.name })
        .from(SubscriptionPlanModel)
        .where(eq(SubscriptionPlanModel.id, notes.planId))
        .limit(1);

      itemName = plan?.name ?? null;
    }

    return {
      title: itemName ? `Payment failed: ${itemName}` : 'Payment failed',
      itemName,
    };
  }

  /**
   * Append one activity row. Never throws.
   */
  static async record(input: RecordActivityInput): Promise<void> {
    try {
      if (!input.clinicId) return;

      await database.insert(SubscriptionActivityModel).values({
        clinicId: input.clinicId,
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        amount:
          input.amount === null || input.amount === undefined
            ? null
            : String(input.amount),
        currency: input.currency ?? 'INR',
        actorUserId: input.actorUserId ?? null,
        metadata: input.metadata ?? null,
      });
    } catch (err) {
      logger.error(
        `Failed to record subscription activity '${input.type}' for clinic ${input.clinicId}:`,
        err
      );
    }
  }

  /**
   * Records that a free trial began.
   *
   * A trial is granted by inserting the subscription row directly: nothing is
   * paid, so it never passes through `subscribeClinic`, which is what logs plan
   * purchases. Without this the clinic's Activity Timeline stayed empty after
   * taking a trial. Uses the `free_trial_started` type the timeline and the
   * super-admin timeline already understand.
   */
  static async recordTrialStarted(input: {
    clinicId: string;
    planId: string;
    planName: string;
    subscriptionId?: string | null;
    trialDays?: number | null;
    expiresAt?: Date | null;
    currency?: string | null;
    actorUserId?: string | null;
  }): Promise<void> {
    const endsOn = input.expiresAt
      ? input.expiresAt.toLocaleDateString('en-IN', {
          timeZone: IST_TIMEZONE,
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : null;

    const description = input.trialDays
      ? `${input.trialDays}-day free trial${endsOn ? `. Ends on ${endsOn}` : ''}.`
      : endsOn
        ? `Free trial active until ${endsOn}.`
        : 'Free trial is active.';

    await SubscriptionActivityService.record({
      clinicId: input.clinicId,
      type: 'free_trial_started',
      title: `Free trial started: ${input.planName}`,
      description,
      currency: input.currency ?? undefined,
      actorUserId: input.actorUserId ?? null,
      metadata: {
        subscriptionId: input.subscriptionId ?? null,
        planId: input.planId,
        planName: input.planName,
        trialDays: input.trialDays ?? null,
        trialEndsAt: input.expiresAt ? input.expiresAt.toISOString() : null,
      },
    });
  }

  /**
   * Fire-and-forget variant for call sites that are already past the point of
   * no return (post-commit, inside webhook handlers). Makes the intent
   * explicit rather than leaving a bare floating promise at the call site.
   */
  static recordAsync(input: RecordActivityInput): void {
    void SubscriptionActivityService.record(input);
  }

  /**
   * Read a clinic's activity, newest first.
   *
   * `before` is a createdAt cursor rather than an offset: the log is
   * append-only and read newest-first, so an offset would shift under the
   * reader as new events land.
   */
  static async list(
    clinicId: string,
    options: { limit?: number; before?: Date } = {}
  ) {
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);

    const rows = await database
      .select({
        id: SubscriptionActivityModel.id,
        type: SubscriptionActivityModel.type,
        title: SubscriptionActivityModel.title,
        description: SubscriptionActivityModel.description,
        amount: SubscriptionActivityModel.amount,
        currency: SubscriptionActivityModel.currency,
        metadata: SubscriptionActivityModel.metadata,
        createdAt: SubscriptionActivityModel.createdAt,
      })
      .from(SubscriptionActivityModel)
      .where(
        options.before
          ? and(
              eq(SubscriptionActivityModel.clinicId, clinicId),
              lt(SubscriptionActivityModel.createdAt, options.before)
            )
          : eq(SubscriptionActivityModel.clinicId, clinicId)
      )
      .orderBy(desc(SubscriptionActivityModel.createdAt))
      // One extra row tells us whether another page exists without a
      // second COUNT query.
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: items.map((r) => ({
        ...r,
        amount: r.amount === null ? null : Number(r.amount),
      })),
      hasMore,
      nextCursor: hasMore
        ? (items[items.length - 1]?.createdAt?.toISOString() ?? null)
        : null,
    };
  }
}
