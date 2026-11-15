import { and, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import redisClient from '../../../../configurations/redisConfig';
import { CacheKeys } from '../../../../utils/cache.util';
import logger from '../../../../utils/logger';
import { notify } from '../../../notifications/queues/notification.queue';
import { SubscriptionPaymentModel } from '../../models/subscriptionPayment.model';
import { SubscriptionWebhookEventModel as W } from '../../models/subscriptionWebhookEvent.model';
import { BillingReadService } from './billingRead.service';
import {
  AUTOPAY_FAILED_ALERT,
  HOUR_MS as HOUR,
  WEBHOOK_QUIET_AFTER_MS as QUIET_AFTER,
} from '../../utils/billingChecks.utils';

/** Daily, after the match job: one email to Super Admins if billing needs a look, otherwise nothing. */
export class BillingAlertService {
  static async run(now = new Date()) {
    const from = new Date(now.getTime() - 24 * HOUR);
    const [match, autoPay, failed, stuck] = await Promise.all([
      BillingReadService.matchSummary(from, now),
      BillingReadService.autoPay(from, now),
      database
        .select({ n: sql<number>`count(*)::int` })
        .from(SubscriptionPaymentModel)
        .where(
          and(
            eq(SubscriptionPaymentModel.kind, 'renewal'),
            isNotNull(SubscriptionPaymentModel.mandateId),
            eq(SubscriptionPaymentModel.status, 'failed'),
            gte(SubscriptionPaymentModel.updatedAt, from)
          )
        ),
      // Razorpay events that ran out of retries: saved but never applied, so a person must look.
      database
        .select({ n: sql<number>`count(*)::int` })
        .from(W)
        .where(
          and(
            eq(W.status, 'failed'),
            isNull(W.nextAttemptAt),
            gte(W.receivedAt, new Date(now.getTime() - 7 * 24 * HOUR))
          )
        ),
    ]);
    // Loaded here, not at the top: the cron registry imports this module.
    const [{ jobInfos }, { SystemJobsService }] = await Promise.all([
      import('../../../../cron/registry'),
      import('../../../systemJobs'),
    ]);
    const jobs = (await SystemJobsService.health(jobInfos(), now)).filter(
      (j) => j.state === 'failed' || j.state === 'missed'
    );
    const last = match.lastWebhookAt ? new Date(match.lastWebhookAt) : null;
    const ctx = {
      differences: match.openDifferences,
      webhookQuiet: !last || now.getTime() - last.getTime() > QUIET_AFTER,
      lastWebhookAt: last?.toISOString() ?? null,
      autoPayFailed: failed[0]?.n ?? 0,
      pastDue: autoPay.pastDue,
      webhooksStuck: stuck[0]?.n ?? 0,
      jobsNeedingLook: jobs.map((j) => `${j.label} (${j.state})`),
      appointmentPayments: await BillingAlertService.appointmentPayments(),
    };
    const worthIt =
      ctx.appointmentPayments.length > 0 ||
      ctx.differences > 0 ||
      ctx.webhookQuiet ||
      ctx.autoPayFailed >= AUTOPAY_FAILED_ALERT ||
      ctx.webhooksStuck > 0 ||
      ctx.jobsNeedingLook.length > 0;
    if (!worthIt) return { sent: false, ...ctx };
    // One email per IST day, however often the job runs.
    const day = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    await notify('platform.billing_alert', ctx, {
      jobId: `platform.billing_alert|${day}`,
    });
    logger.warn(`[BillingAlert] Sent: ${JSON.stringify(ctx)}`);
    return { sent: true, ...ctx };
  }

  /** Tonight's list from the appointment payment check; a Redis miss or outage sends none. */
  private static async appointmentPayments(): Promise<string[]> {
    try {
      const raw = await redisClient.get(
        CacheKeys.appointmentPaymentNeedsLook()
      );
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch (err) {
      logger.error(
        '[BillingAlert] Could not read the appointment payment list',
        err
      );
      return [];
    }
  }
}
