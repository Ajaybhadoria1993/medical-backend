import { and, desc, eq } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import redisClient from '../../../../configurations/redisConfig';
import { HttpError } from '../../../../middlewear/errorHandler';
import { CacheKeys, invalidateCacheMany } from '../../../../utils/cache.util';
import { envConfig } from '../../../../utils/envConfig';
import logger from '../../../../utils/logger';
import { razorpayClient } from '../../gateway/razorpay.client';
import { SubscriptionModel } from '../../models/ownerSubscription.model';
import { SubscriptionPaymentModel as P } from '../../models/subscriptionPayment.model';
import { capturedFor } from '../../utils/reconcile.utils';
import { LifecycleRemindersService } from '../core/lifecycleReminders.service';
import { OwnerSubscriptionService } from '../core/ownerSubscription.service';
import { ScheduledChangeService } from '../core/scheduledChange.service';
import { LimitationService } from '../limitation.service';
import { SubscriptionActivityService } from '../subscriptionActivity.service';
import { AutoPayService } from './autoPay.service';
import { AutoPayRenewalService } from './autoPayRenewal.service';
import { PaymentsService } from './payments.service';

const HOUR = 60 * 60 * 1000;
const BACKUP_TTL_S = 7 * 24 * 60 * 60;
const backupKey = (clinicId: string) => `billing:test:backup:${clinicId}`;

export type BillingTestAction =
  'renew' | 'grace' | 'end_grace' | 'reminder' | 'restore';

/** Super Admin test tool: moves one clinic's renewal date and runs the real jobs for it. Never in production. */
export class BillingTestService {
  /** Only on dev/staging with a Razorpay test key, so no real money or live clinic can be touched. */
  static enabled() {
    return (
      ['development', 'staging'].includes(envConfig.NODE_ENV) &&
      String(envConfig.RAZORPAY_KEY_ID ?? '').startsWith('rzp_test_')
    );
  }

  private static assertEnabled() {
    if (!BillingTestService.enabled()) throw new HttpError(404, 'Not found');
  }

  private static async current(clinicId: string) {
    const current = await OwnerSubscriptionService.getCurrent(
      'clinic',
      clinicId
    );
    if (
      !current ||
      current.plan.kind !== 'paid' ||
      current.subscription.isTrial
    ) {
      throw new HttpError(
        409,
        'Put this clinic on a paid plan first; the test tool moves a paid renewal.'
      );
    }
    return current.subscription;
  }

  /** Keeps the real dates once (7 days in Redis), so Restore can put them back. */
  private static async backup(sub: typeof SubscriptionModel.$inferSelect) {
    await redisClient.set(
      backupKey(sub.ownerId),
      JSON.stringify({
        id: sub.id,
        start: sub.currentPeriodStart,
        end: sub.currentPeriodEnd,
        status: sub.status,
      }),
      'EX',
      BACKUP_TTL_S,
      'NX'
    );
  }

  private static async moveEnd(
    sub: typeof SubscriptionModel.$inferSelect,
    end: Date
  ) {
    await BillingTestService.backup(sub);
    await database
      .update(SubscriptionModel)
      .set({
        currentPeriodEnd: end,
        // The table needs end > start; a fresh period's start moves back a month with it (Restore puts it back).
        ...(sub.currentPeriodStart >= end
          ? { currentPeriodStart: new Date(end.getTime() - 30 * 24 * HOUR) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(SubscriptionModel.id, sub.id));
    await BillingTestService.clearCaches(sub.ownerId);
  }

  private static async clearCaches(clinicId: string) {
    await LimitationService.invalidateClinicCache(clinicId);
    await invalidateCacheMany([
      CacheKeys.clinicDetails(clinicId),
      CacheKeys.clinicActiveSubscription(clinicId),
    ]);
  }

  static async run(
    clinicId: string,
    action: BillingTestAction,
    userId: string
  ) {
    BillingTestService.assertEnabled();
    const now = new Date();
    let summary: string;
    if (action === 'restore') {
      summary = await BillingTestService.restore(clinicId);
    } else {
      const sub = await BillingTestService.current(clinicId);
      if (action === 'renew' || action === 'grace') {
        // Renew: inside the 27-51 h charge window. Grace: past the end, so a failed try is retried.
        await BillingTestService.moveEnd(
          sub,
          new Date(now.getTime() + (action === 'renew' ? 30 : -24) * HOUR)
        );
        const mandate = await AutoPayService.active(clinicId);
        if (!mandate) {
          summary =
            action === 'renew'
              ? 'Renewal moved to 30 h away, but AutoPay is off, so nothing was charged. Turn AutoPay on, or pay by hand.'
              : 'Renewal moved to yesterday: the clinic is in its grace days (Payment due).';
        } else {
          const outcome = await AutoPayRenewalService.renew(mandate, now);
          summary =
            action === 'renew'
              ? outcome === 'notice_sent'
                ? 'Renewal moved to 30 h away; pre-debit notice sent. The charge runs about 26 h later (bank rule), from the hourly AutoPay job.'
                : `Renewal moved to 30 h away; AutoPay: ${outcome}.`
              : `Renewal moved to yesterday (grace); AutoPay retry: ${outcome}${outcome === 'not_due' ? ' (a retry needs an earlier failed try)' : ''}.`;
        }
      } else if (action === 'end_grace') {
        await BillingTestService.moveEnd(
          sub,
          new Date(now.getTime() - 4 * 24 * HOUR)
        );
        const r = await ScheduledChangeService.endDuePeriods(now, clinicId);
        summary = `Renewal moved 4 days back; period end ran: ${r.ended} ended${r.errors.length ? `, errors: ${r.errors.join(', ')}` : ''}.`;
      } else {
        await BillingTestService.moveEnd(
          sub,
          new Date(now.getTime() + 30 * HOUR)
        );
        const r = await LifecycleRemindersService.run(now, clinicId);
        summary = `Renewal moved to 30 h away; reminders queued: ${r.queued}.`;
      }
      await BillingTestService.clearCaches(clinicId);
    }
    await SubscriptionActivityService.record({
      clinicId,
      type: 'billing_test',
      title: `Billing test: ${action.replace('_', ' ')}`,
      description: summary,
      actorUserId: userId,
    });
    logger.warn(
      `[BillingTest] Clinic ${clinicId} ${action} by ${userId}: ${summary}`
    );
    return { summary, ...(await BillingTestService.status(clinicId)) };
  }

  private static async restore(clinicId: string) {
    const raw = await redisClient.get(backupKey(clinicId));
    if (!raw) return 'Nothing to restore: no test change in the last 7 days.';
    const b = JSON.parse(raw) as {
      id: string;
      start: string | null;
      end: string | null;
    };
    await database
      .update(SubscriptionModel)
      .set({
        // The start is never null in the table, so it is only put back when it was saved.
        ...(b.start ? { currentPeriodStart: new Date(b.start) } : {}),
        currentPeriodEnd: b.end ? new Date(b.end) : null,
        updatedAt: new Date(),
      })
      .where(eq(SubscriptionModel.id, b.id));
    await redisClient.del(backupKey(clinicId));
    await BillingTestService.clearCaches(clinicId);
    return 'Dates restored to before the test.';
  }

  /** Polled by the screen. A renewal Razorpay captured is applied with the webhook's code, so tests
   *  settle even where webhooks cannot reach (local dev). */
  static async status(clinicId: string) {
    BillingTestService.assertEnabled();
    // Webhooks may not reach this server: charge a renewal whose notice is out, as the notice webhook would.
    await AutoPayRenewalService.chargeWaiting(clinicId).catch((e) =>
      logger.warn(
        `[BillingTest] Charging the waiting renewal of ${clinicId} failed:`,
        e
      )
    );
    const [renewal] = await database
      .select()
      .from(P)
      .where(
        and(
          eq(P.ownerType, 'clinic'),
          eq(P.ownerId, clinicId),
          eq(P.kind, 'renewal')
        )
      )
      .orderBy(desc(P.createdAt))
      .limit(1);
    if (
      renewal &&
      (renewal.status === 'created' || renewal.status === 'pending') &&
      renewal.providerOrderId
    ) {
      try {
        const { items } = await razorpayClient.orderPayments(
          renewal.providerOrderId
        );
        const paid = capturedFor(items, renewal.amountPaise);
        if (paid) {
          await PaymentsService.activatePayment({
            paymentRowId: renewal.id,
            providerPaymentId: paid.id,
            method: paid.method ?? null,
          });
        }
      } catch (e) {
        logger.warn(
          `[BillingTest] Razorpay check for renewal ${renewal.id} failed:`,
          e
        );
      }
    }
    const [[latest], current, backup, mandate] = await Promise.all([
      database
        .select({
          id: P.id,
          status: P.status,
          amountPaise: P.amountPaise,
          providerPaymentId: P.providerPaymentId,
          failureReason: P.failureReason,
          createdAt: P.createdAt,
        })
        .from(P)
        .where(
          and(
            eq(P.ownerType, 'clinic'),
            eq(P.ownerId, clinicId),
            eq(P.kind, 'renewal')
          )
        )
        .orderBy(desc(P.createdAt))
        .limit(1),
      OwnerSubscriptionService.getCurrent('clinic', clinicId),
      redisClient.get(backupKey(clinicId)),
      AutoPayService.active(clinicId),
    ]);
    return {
      periodEnd: current?.subscription.currentPeriodEnd ?? null,
      state: current?.state.state ?? null,
      autoPayOn: !!mandate,
      hasBackup: !!backup,
      renewal: latest
        ? {
            ...latest,
            amount: latest.amountPaise / 100,
            amountPaise: undefined,
          }
        : null,
    };
  }
}
