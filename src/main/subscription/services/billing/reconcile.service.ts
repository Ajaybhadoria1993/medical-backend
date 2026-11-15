import { and, eq, gte, inArray, isNotNull, lte, or } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import logger from '../../../../utils/logger';
import { razorpayClient } from '../../gateway/razorpay.client';
import { SubscriptionPaymentModel } from '../../models/subscriptionPayment.model';
import { capturedFor, STALE_AFTER_MS } from '../../utils/reconcile.utils';
import { PaymentsService } from './payments.service';

const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
const SETTLE_MS = 30 * 60 * 1000;
// Decision L: an AutoPay debit can take 24-36 h; with no answer after 5 days it is failed.
const AUTOPAY_STALE_MS = 5 * 24 * 60 * 60 * 1000;
const AUTOPAY_LOOKBACK_MS = 6 * 24 * 60 * 60 * 1000;
const BATCH = 100;

/** Daily safety net for what the webhook and the verify call both missed. */
export class ReconcileService {
  static async run() {
    const refunds = await ReconcileService.retryRefunds();
    const recovered = await ReconcileService.recoverMissed();
    logger.info(
      `[Reconcile] Refunds retried: ${refunds}; missed payments applied: ${recovered.applied}, closed: ${recovered.closed}`
    );
    // After healing what it can, list what still differs from Razorpay for a Super Admin.
    const { BillingMatchService } = await import('./billingMatch.service');
    await BillingMatchService.run();
    // Then tell the Super Admins once, only if something needs a look (Q4: email).
    const { BillingAlertService } = await import('./billingAlert.service');
    await BillingAlertService.run();
  }

  private static async retryRefunds() {
    const rows = await database
      .select()
      .from(SubscriptionPaymentModel)
      .where(
        and(
          eq(SubscriptionPaymentModel.needsRefund, true),
          eq(SubscriptionPaymentModel.status, 'captured')
        )
      )
      .limit(BATCH);
    for (const row of rows) await PaymentsService.refundDuplicate(row);
    return rows.length;
  }

  private static async recoverMissed() {
    const now = Date.now();
    const rows = await database
      .select()
      .from(SubscriptionPaymentModel)
      .where(
        and(
          or(
            inArray(SubscriptionPaymentModel.status, [
              'created',
              'pending',
              'abandoned',
            ]),
            // A failed AutoPay try may still be captured by the bank.
            and(
              eq(SubscriptionPaymentModel.status, 'failed'),
              isNotNull(SubscriptionPaymentModel.mandateId)
            )
          ),
          isNotNull(SubscriptionPaymentModel.providerOrderId),
          or(
            gte(
              SubscriptionPaymentModel.createdAt,
              new Date(now - LOOKBACK_MS)
            ),
            and(
              isNotNull(SubscriptionPaymentModel.mandateId),
              gte(
                SubscriptionPaymentModel.createdAt,
                new Date(now - AUTOPAY_LOOKBACK_MS)
              )
            )
          ),
          lte(SubscriptionPaymentModel.createdAt, new Date(now - SETTLE_MS))
        )
      )
      .limit(BATCH);

    let applied = 0;
    let closed = 0;
    for (const row of rows) {
      try {
        const { items } = await razorpayClient.orderPayments(
          row.providerOrderId!
        );
        const paid = capturedFor(items, row.amountPaise);
        if (paid) {
          await PaymentsService.activatePayment({
            paymentRowId: row.id,
            providerPaymentId: paid.id,
            method: paid.method ?? null,
          });
          applied++;
        } else if (
          row.status !== 'abandoned' &&
          row.status !== 'failed' &&
          now - row.createdAt.getTime() >
            (row.mandateId ? AUTOPAY_STALE_MS : STALE_AFTER_MS)
        ) {
          const autoPay = !!row.mandateId && row.kind === 'renewal';
          if (autoPay) {
            logger.error(
              `[Reconcile] AutoPay renewal ${row.id} has no bank answer after 5 days; marked failed`
            );
          }
          // Conditional, so a payment that lands meanwhile is not overwritten.
          await database
            .update(SubscriptionPaymentModel)
            .set(
              autoPay
                ? {
                    status: 'failed',
                    failureReason: 'No answer from the bank after 5 days',
                    updatedAt: new Date(),
                  }
                : { status: 'abandoned', updatedAt: new Date() }
            )
            .where(
              and(
                eq(SubscriptionPaymentModel.id, row.id),
                eq(SubscriptionPaymentModel.status, row.status)
              )
            );
          closed++;
        }
      } catch (error) {
        logger.error(
          `[Reconcile] Check failed for payment row ${row.id}:`,
          error
        );
      }
    }
    return { applied, closed };
  }
}
