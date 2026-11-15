import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import logger from '../../../../utils/logger';
import { notify } from '../../../notifications/queues/notification.queue';
import { SubscriptionPaymentModel } from '../../models/subscriptionPayment.model';
import { SubscriptionWebhookEventModel } from '../../models/subscriptionWebhookEvent.model';
import {
  MAX_WEBHOOK_ATTEMPTS,
  nextRetryDelayMs,
  webhookRef,
} from '../../utils/webhookEvent.utils';
import { AutoPayService } from './autoPay.service';
import { PaymentsService } from './payments.service';

const LEASE_MS = 10 * 60 * 1000;
const KEEP_PAYLOAD_DAYS = 90;
type Entity = {
  id?: string;
  order_id?: string;
  payment_id?: string;
  amount?: number;
  method?: string;
  error_description?: string;
  error_reason?: string;
};
type Body = {
  event: string;
  payload: {
    payment?: { entity: Entity };
    refund?: { entity: Entity };
    order?: { entity?: { id?: string } };
    token?: {
      entity: {
        id?: string;
        recurring_details?: { status?: string; failure_reason?: string | null };
      };
    };
  };
};

/** The Razorpay webhook inbox: every event stored first, then processed once, with retries. */
export class WebhookService {
  /** Subscription events, run from the inbox; returns a note when done but worth a human look. */
  static async dispatch(body: Body): Promise<string | undefined> {
    // Pre-debit notice for an AutoPay renewal: the charge may only run once it is delivered.
    if (body.event?.startsWith('order.notification.')) {
      const { AutoPayRenewalService } =
        await import('./autoPayRenewal.service');
      await AutoPayRenewalService.onNoticeEvent(
        body.event,
        body.payload?.order?.entity?.id
      );
      return undefined;
    }
    if (body.event?.startsWith('token.')) {
      const token = body.payload?.token?.entity;
      await AutoPayService.onTokenEvent(
        body.event,
        token?.id,
        token?.recurring_details?.failure_reason ?? undefined
      );
      return undefined;
    }
    return WebhookService.handle(body);
  }

  /** True when the event is about one of our payment rows; every other event keeps its old handler. */
  static async isOurs(body: Body): Promise<boolean> {
    const ref = webhookRef(body.event, body.payload ?? {});
    if (!ref) return false;
    const [row] = await database
      .select({ id: SubscriptionPaymentModel.id })
      .from(SubscriptionPaymentModel)
      .where(
        ref.kind === 'payment'
          ? eq(SubscriptionPaymentModel.providerOrderId, ref.orderId)
          : eq(SubscriptionPaymentModel.providerPaymentId, ref.paymentId)
      )
      .limit(1);
    return !!row;
  }

  /** Every Razorpay event is stored first; a repeat delivery of the same event id is ignored. */
  static async receive(
    eventId: string,
    body: { event: string }
  ): Promise<void> {
    const [inserted] = await database
      .insert(SubscriptionWebhookEventModel)
      .values({ eventId, eventType: body.event, payload: body })
      .onConflictDoNothing({ target: SubscriptionWebhookEventModel.eventId })
      .returning({ id: SubscriptionWebhookEventModel.id });
    if (inserted) {
      setImmediate(() => void WebhookService.processOne(inserted.id));
    }
  }

  /** Called every minute: events not yet done, failed ones due for a retry, and expired leases. */
  static async processDue(limit = 25): Promise<number> {
    const due = await database
      .select({ id: SubscriptionWebhookEventModel.id })
      .from(SubscriptionWebhookEventModel)
      .where(WebhookService.claimable(new Date()))
      .orderBy(SubscriptionWebhookEventModel.receivedAt)
      .limit(limit);
    for (const { id } of due) await WebhookService.processOne(id);
    return due.length;
  }

  /** Super Admin retry of an event that ran out of tries: fresh tries, processed now; returns its status. */
  static async retryStuck(id: string, userId: string) {
    const W = SubscriptionWebhookEventModel;
    const [reset] = await database
      .update(W)
      .set({ attempts: 0, nextAttemptAt: null })
      .where(
        and(
          eq(W.id, id),
          eq(W.status, 'failed'),
          gte(W.attempts, MAX_WEBHOOK_ATTEMPTS)
        )
      )
      .returning({ id: W.id, eventId: W.eventId });
    if (!reset) {
      throw new HttpError(
        404,
        'This event is not stuck any more; refresh the list.'
      );
    }
    logger.warn(
      `[Webhook] Event ${reset.eventId} retried by Super Admin ${userId}`
    );
    await WebhookService.processOne(id);
    const [after] = await database
      .select({ status: W.status, error: W.error })
      .from(W)
      .where(eq(W.id, id));
    return after;
  }

  /** Customer email and phone sit in the payload, so it is not kept longer than needed. */
  static async clearOldPayloads(): Promise<void> {
    const cutoff = new Date(
      Date.now() - KEEP_PAYLOAD_DAYS * 24 * 60 * 60 * 1000
    );
    await database
      .update(SubscriptionWebhookEventModel)
      .set({ payload: null })
      .where(
        and(
          eq(SubscriptionWebhookEventModel.status, 'processed'),
          lt(SubscriptionWebhookEventModel.processedAt, cutoff),
          isNotNull(SubscriptionWebhookEventModel.payload)
        )
      );
  }

  private static claimable(now: Date) {
    return and(
      inArray(SubscriptionWebhookEventModel.status, [
        'received',
        'failed',
        'processing',
      ]),
      lt(SubscriptionWebhookEventModel.attempts, MAX_WEBHOOK_ATTEMPTS),
      or(
        isNull(SubscriptionWebhookEventModel.nextAttemptAt),
        lte(SubscriptionWebhookEventModel.nextAttemptAt, now)
      )
    );
  }

  private static async processOne(id: string): Promise<void> {
    const now = new Date();
    // The conditional update is the claim: two servers can try, only one gets the row.
    const [event] = await database
      .update(SubscriptionWebhookEventModel)
      .set({
        status: 'processing',
        attempts: sql`${SubscriptionWebhookEventModel.attempts} + 1`,
        nextAttemptAt: new Date(now.getTime() + LEASE_MS),
      })
      .where(
        and(
          eq(SubscriptionWebhookEventModel.id, id),
          WebhookService.claimable(now)
        )
      )
      .returning();
    if (!event) return;

    try {
      // Loaded here: the router imports this module, so a top-level import would be circular.
      const { RazorpayWebhookRouter } =
        await import('../../../payment/services/razorpayWebhookRouter.service');
      const note = await RazorpayWebhookRouter.dispatch(
        event.payload as never
      ).catch((error) => {
        // A business refusal (checkout closed, already applied) will not change on retry.
        if (error instanceof HttpError) return error.message;
        throw error;
      });
      await database
        .update(SubscriptionWebhookEventModel)
        .set({
          status: 'processed',
          processedAt: new Date(),
          nextAttemptAt: null,
          error: note ?? null,
        })
        .where(eq(SubscriptionWebhookEventModel.id, id));
    } catch (error) {
      const delay = nextRetryDelayMs(event.attempts);
      await database
        .update(SubscriptionWebhookEventModel)
        .set({
          status: 'failed',
          error: String((error as Error).message ?? error).slice(0, 2000),
          nextAttemptAt: delay === null ? null : new Date(Date.now() + delay),
        })
        .where(eq(SubscriptionWebhookEventModel.id, id));
      if (delay === null) {
        logger.error(
          `[Webhook] Event ${event.eventId} (${event.eventType}) gave up after ${event.attempts} attempts:`,
          error
        );
        // Tell Super Admins now, not only in the daily email; one alert per event.
        await notify(
          'platform.webhook_stuck',
          {
            eventType: event.eventType,
            error: String((error as Error).message ?? error),
          },
          { jobId: `platform.webhook_stuck|${event.eventId}` }
        );
      }
    }
  }

  /** Returns a note to keep on the event when it is done but needs a human look. */
  private static async handle(body: Body): Promise<string | undefined> {
    const ref = webhookRef(body.event, body.payload ?? {});
    if (!ref) return undefined;

    const [row] = await database
      .select()
      .from(SubscriptionPaymentModel)
      .where(
        ref.kind === 'payment'
          ? eq(SubscriptionPaymentModel.providerOrderId, ref.orderId)
          : eq(SubscriptionPaymentModel.providerPaymentId, ref.paymentId)
      )
      .limit(1);
    if (!row) return 'No payment row for this event';

    if (body.event === 'payment.captured') {
      const entity = body.payload.payment!.entity;
      if (Number(entity.amount) !== row.amountPaise) {
        logger.error(
          `[Webhook] Amount mismatch on ${row.id}: paid ${entity.amount}, expected ${row.amountPaise}`
        );
        return `Amount mismatch: paid ${entity.amount}, expected ${row.amountPaise}`;
      }
      await PaymentsService.activatePayment({
        paymentRowId: row.id,
        providerPaymentId: entity.id ?? null,
        method: entity.method ?? null,
      });
      return undefined;
    }
    if (body.event === 'payment.failed') {
      const entity = body.payload.payment!.entity;
      await PaymentsService.recordFailure(row, {
        reason: entity.error_description ?? entity.error_reason ?? null,
        dropped: false,
      });
      return undefined;
    }
    if (body.event === 'refund.processed') {
      await PaymentsService.completeRefund(row);
      return undefined;
    }
    if (body.event === 'refund.failed') {
      // Back to captured with needs_refund: the money is still owed to the clinic.
      await database
        .update(SubscriptionPaymentModel)
        .set({ status: 'captured', needsRefund: true, updatedAt: new Date() })
        .where(eq(SubscriptionPaymentModel.id, row.id));
      logger.error(`[Webhook] Refund failed for payment row ${row.id}`);
      return 'Refund failed; needs_refund set again';
    }
    // order.paid and payment.authorized add nothing: payment.captured carries the money.
    return undefined;
  }
}
