import logger from '../utils/logger';
import { envConfig } from '../utils/envConfig';
import {
  AccountAccessEmailService,
  AutoPayRenewalService,
  AutoPayService,
  LifecycleRemindersService,
  ReconcileService,
  ScheduledChangeService,
  WebhookService,
} from '../main/subscription';
import { SystemJobsService } from '../main/systemJobs';
import type { JobInfo } from '../main/systemJobs';
import redisClient from '../configurations/redisConfig';
import { runOnce } from './runOnce';
import { markPastDayAppointmentsNoShow } from './jobs/missedAppointments.cron';
import { AppointmentPaymentMatch } from '../main/clinicFinance/services/appointmentPaymentMatch.service';
import { ClinicFinanceProviderWebhookService } from '../main/clinicFinance/services/financeProviderWebhook.service';

const HOUR = 60 * 60;

/** One background job: when it runs, how it is locked, and the work (which returns a short summary). */
export interface CronJob {
  key: string;
  label: string;
  purpose: string;
  when: string;
  /** node-cron expression, IST. */
  schedule: string;
  /** Set: one server per run, held this long after a success. Unset: every server runs it. */
  lockTtlSec?: number;
  /** False for every-minute jobs, which record failures only. */
  recordSuccess: boolean;
  maxGapHours: number | null;
  enabled?: () => boolean;
  /** Also run once when the server starts (catches a missed night). */
  runAtBoot?: boolean;
  work: () => Promise<string | void>;
}

const DAILY = 26;

export const CRON_JOBS: CronJob[] = [
  {
    key: 'AppointmentPaymentCheck',
    label: 'Appointment payment check',
    purpose:
      'Compares the last 3 days of online appointment payments and refunds with Razorpay, records missed payments and fees, and lists the rest for the billing alert email.',
    when: 'Daily at 23:30 IST and at server start',
    // Before PaymentCheck (23:45), whose billing alert email carries this list.
    schedule: '30 23 * * *',
    lockTtlSec: 23 * HOUR,
    recordSuccess: true,
    maxGapHours: DAILY,
    runAtBoot: true,
    work: () => AppointmentPaymentMatch.run(),
  },
  {
    key: 'ClinicSettlementSync',
    label: 'Clinic payout check',
    purpose:
      'Asks Razorpay which clinic transfers have reached the bank and records the settlement with its UTR, in case the settlement webhook never arrives.',
    when: 'Daily at 11:00 and 19:00 IST',
    // Twice a day: Razorpay pays out during bank hours, so the evening run catches same-day payouts.
    schedule: '0 11,19 * * *',
    lockTtlSec: 7 * HOUR,
    recordSuccess: true,
    maxGapHours: DAILY,
    work: () => ClinicFinanceProviderWebhookService.syncPendingSettlements(),
  },
  {
    key: 'PaymentCheck',
    label: 'Payment check',
    purpose:
      'Settles payments still waiting on Razorpay, compares our payments with Razorpay and emails Super Admins if billing needs a look.',
    when: 'Daily at 23:45 IST',
    // Before PeriodEnd (00:05), so a renewal that failed at the bank ends on time, not a day late.
    schedule: '45 23 * * *',
    lockTtlSec: 23 * HOUR,
    recordSuccess: true,
    maxGapHours: DAILY,
    work: async () => {
      await ReconcileService.run();
    },
  },
  {
    key: 'PeriodEnd',
    label: 'Plan period end',
    purpose:
      'Switches clinics that paid for a scheduled plan, then moves plans past their period and grace days to Free.',
    when: 'Daily at 00:05 IST',
    // A plan's last day ends at IST midnight; ending is a conditional update, so a doubled run is harmless.
    schedule: '5 0 * * *',
    lockTtlSec: 23 * HOUR,
    recordSuccess: true,
    maxGapHours: DAILY,
    work: async () => {
      // Switch first, so clinics that paid for their scheduled plan are not ended below.
      const switches = await ScheduledChangeService.applyPaidSwitches();
      const result = await ScheduledChangeService.endDuePeriods();
      const summary = `${switches.switched} switched, ${result.ended} of ${result.due} ended`;
      if (result.errors.length) {
        throw new Error(
          `${summary}; could not end: ${result.errors.join(', ')}`
        );
      }
      return summary;
    },
  },
  {
    key: 'MissedAppointments',
    label: 'Missed appointments',
    purpose:
      'Marks visits from past days that were never closed as No Show, frees their treatment-plan steps, and clears what unpaid cancelled or missed visits owe.',
    when: 'Daily at 00:05 IST and at server start',
    schedule: '5 0 * * *',
    recordSuccess: true,
    maxGapHours: DAILY,
    runAtBoot: true,
    work: async () => {
      const { syncTreatmentPlanDeadVisits } =
        await import('../main/treatmentPlan');
      const { AppointmentMoneySync } =
        await import('../main/appointments/services/appointmentMoneySync.service');
      const marked = await markPastDayAppointmentsNoShow();
      // The no-show UPDATE skips the plan hook, so steps on those visits are freed here.
      const steps = await syncTreatmentPlanDeadVisits();
      // It skips the money sync too: unpaid visits that never happened stop counting as dues.
      const settled = await AppointmentMoneySync.settleUnattended();
      return `${marked} marked No Show, ${steps} plan steps freed, ${settled} unpaid visits cleared`;
    },
  },
  {
    key: 'SubscriptionReminders',
    label: 'Subscription reminders',
    purpose:
      'Emails and in-app reminders for trials ending, renewals due and grace days.',
    when: 'Daily at 07:00 IST',
    schedule: '0 7 * * *',
    // The email queue's dedupe key also stops a second run from resending.
    lockTtlSec: 23 * HOUR,
    recordSuccess: true,
    maxGapHours: DAILY,
    work: async () => {
      const r = await LifecycleRemindersService.run();
      const summary = `${r.checked} checked, ${r.queued} queued`;
      if (r.errors.length) {
        throw new Error(`${summary}; failed for: ${r.errors.join(', ')}`);
      }
      return summary;
    },
  },
  {
    key: 'AutoPayRenewal',
    label: 'AutoPay renewals',
    purpose:
      'Syncs AutoPay mandates, then charges renewals due and retries declined ones through the grace days.',
    when: 'Daily from 09:00 IST, retried hourly until 18:00 if it fails',
    schedule: '0 9-18 * * *',
    // A success holds the lock past 18:00 (10 h), so later hours skip; a failed run frees it for the next hour.
    lockTtlSec: 10 * HOUR,
    recordSuccess: true,
    maxGapHours: DAILY,
    // Off with subscription payments: an old mandate must not be charged at Razorpay.
    enabled: () => envConfig.ENABLE_SUBSCRIPTION_PAYMENTS,
    work: async () => {
      // Status first, so a mandate cancelled at the bank is not charged.
      await AutoPayService.syncAll();
      // Re-send cancels that did not reach Razorpay, so no turned-off AutoPay stays live at the bank.
      await AutoPayService.finishCancels();
      await AutoPayRenewalService.run();
    },
  },
  {
    key: 'AutoPayCharge',
    label: 'AutoPay charges',
    purpose:
      'Charges AutoPay renewals 26 h after their pre-debit notice, so the money is taken before the renewal date.',
    when: 'Hourly',
    // Hourly, not daily: a daily run would charge 48 h after the notice, after the renewal date.
    schedule: '0 * * * *',
    lockTtlSec: 55 * 60,
    recordSuccess: true,
    maxGapHours: 2,
    enabled: () => envConfig.ENABLE_SUBSCRIPTION_PAYMENTS,
    work: async () => {
      const r = await AutoPayRenewalService.chargeWaiting();
      return `${r.charged} of ${r.waiting} waiting renewals charged`;
    },
  },
  {
    key: 'CreditExpiryReminders',
    label: 'Credit expiry reminders',
    purpose:
      'Reminds clinic admins of credits about to expire, once per grant.',
    when: 'Daily at 09:00 IST',
    schedule: '0 9 * * *',
    recordSuccess: true,
    maxGapHours: DAILY,
    work: async () => {
      const { runCreditExpiryReminders } = await import('../main/credits');
      return `${await runCreditExpiryReminders()} grants reminded`;
    },
  },
  {
    key: 'AccountAccessReminders',
    label: 'Account access reminders',
    purpose:
      'Warns staff three days before their account is switched off by a scheduled change.',
    when: 'Hourly',
    schedule: '0 * * * *',
    lockTtlSec: 55 * 60,
    recordSuccess: true,
    maxGapHours: 2,
    work: async () =>
      `${await AccountAccessEmailService.sendThreeDayReminders()} reminders sent`,
  },
  {
    key: 'WebhookInbox',
    label: 'Razorpay event retries',
    purpose:
      'Retries Razorpay events that could not be applied when they arrived; one that still fails after every retry shows on Billing checks.',
    when: 'Every minute',
    schedule: '* * * * *',
    // No lock: each event is claimed by a conditional update, so every server can safely help.
    recordSuccess: false,
    maxGapHours: null,
    work: async () => `${await WebhookService.processDue()} processed`,
  },
  {
    key: 'WebhookPayloadCleanup',
    label: 'Razorpay data cleanup',
    purpose:
      'Removes customer details from Razorpay events processed long ago.',
    when: 'Daily at 03:30 IST',
    schedule: '30 3 * * *',
    lockTtlSec: 23 * HOUR,
    recordSuccess: true,
    maxGapHours: DAILY,
    work: async () => {
      await WebhookService.clearOldPayloads();
    },
  },
  {
    key: 'QueueTick',
    label: 'Live queue update',
    purpose:
      'Recomputes waiting times for active doctor queues and pushes changes to patients and clinics.',
    when: 'Every minute',
    schedule: '* * * * *',
    recordSuccess: false,
    maxGapHours: null,
    // Off when several servers share one database; only one should own the tick.
    enabled: () =>
      String(process.env.QUEUE_TICK_ENABLED).toLowerCase() !== 'false',
    work: async () => {
      const { queueTickService } =
        await import('../main/appointment-engine/services/queueTick.service');
      await queueTickService.tick();
    },
  },
  {
    key: 'FollowupRules',
    label: 'Super Admin follow-ups',
    purpose: 'Opens, refreshes and auto-closes Super Admin follow-up tasks.',
    when: 'Daily at 02:30 IST',
    schedule: '30 2 * * *',
    recordSuccess: true,
    maxGapHours: DAILY,
    work: async () => {
      const { runFollowupRules } = await import('../main/superadminAnalytics');
      await runFollowupRules();
    },
  },
  {
    key: 'OtpCleanup',
    label: 'Expired OTP cleanup',
    purpose: 'Deletes expired patient sign-in codes.',
    when: 'Daily at 03:00 IST',
    schedule: '0 3 * * *',
    recordSuccess: true,
    maxGapHours: DAILY,
    work: async () => {
      const { PatientAuthService } =
        await import('../main/patient/services/patientAuth.service');
      await PatientAuthService.cleanupExpiredOtps();
    },
  },
  {
    key: 'NotificationRetention',
    label: 'Notification cleanup',
    purpose:
      'Deletes read notifications and activity rows past their keep window.',
    when: 'Daily at 03:30 IST',
    schedule: '30 3 * * *',
    recordSuccess: true,
    maxGapHours: DAILY,
    // Off until in-app notifications ship: it deletes rows the archive step must see first.
    enabled: () => envConfig.NOTIFICATIONS_INAPP_ENABLED,
    work: async () => {
      const { purgeExpiredNotifications } =
        await import('../main/notifications/services/retention.service');
      const r = await purgeExpiredNotifications();
      return `${r.notifications} notifications and ${r.activity} activity rows removed`;
    },
  },
  {
    key: 'AuditLogRetention',
    label: 'Audit log cleanup',
    purpose:
      'Deletes staff audit-log rows past the keep window (90 days by default).',
    when: 'Daily at 04:00 IST',
    schedule: '0 4 * * *',
    recordSuccess: true,
    maxGapHours: DAILY,
    work: async () => {
      const { AuditLogService } =
        await import('../main/audit/services/auditLog.service');
      return `${await AuditLogService.purgeExpired()} audit rows removed`;
    },
  },
  {
    key: 'CronRunCleanup',
    label: 'Job history cleanup',
    purpose: 'Deletes job run history older than 30 days.',
    when: 'Daily at 04:10 IST',
    schedule: '10 4 * * *',
    lockTtlSec: 23 * HOUR,
    recordSuccess: true,
    maxGapHours: DAILY,
    work: async () => `${await SystemJobsService.purgeOld()} runs removed`,
  },
];

export const isEnabled = (job: CronJob) => job.enabled?.() ?? true;

/** What the System jobs screen needs from the registry. */
export const jobInfos = (): JobInfo[] =>
  CRON_JOBS.map((j) => ({
    key: j.key,
    label: j.label,
    purpose: j.purpose,
    when: j.when,
    enabled: isEnabled(j),
    maxGapHours: j.maxGapHours,
  }));

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Runs the work once, records it and logs it; rethrows a failure so the lock is freed. */
async function execute(job: CronJob, triggeredBy?: string) {
  const startedAt = new Date();
  try {
    const summary = (await job.work()) || 'Done';
    if (job.recordSuccess || triggeredBy) {
      await SystemJobsService.record({
        job: job.key,
        status: 'ok',
        startedAt,
        durationMs: Date.now() - startedAt.getTime(),
        summary,
        triggeredBy: triggeredBy ?? null,
      });
      logger.info(`[Cron:${job.key}] ${summary}`);
    }
    return summary;
  } catch (error) {
    await SystemJobsService.record({
      job: job.key,
      status: 'failed',
      startedAt,
      durationMs: Date.now() - startedAt.getTime(),
      error: describe(error),
      triggeredBy: triggeredBy ?? null,
    });
    throw error;
  }
}

/** A scheduled tick: locked when the job asks for it; failures are logged, never thrown into node-cron. */
export async function runScheduled(job: CronJob): Promise<void> {
  try {
    if (job.lockTtlSec)
      await runOnce(job.key, job.lockTtlSec, async () => {
        await execute(job);
      });
    else await execute(job);
  } catch (error) {
    logger.error(`[Cron:${job.key}] Failed:`, error);
  }
}

/** "Run now": skips the daily lock (jobs are safe to rerun); its own lock blocks a double click (null). */
export async function runNow(
  job: CronJob,
  userId: string
): Promise<string | null> {
  const key = `cron:manual:${job.key}`;
  // Ten minutes caps a crashed run; a normal one frees it in finally.
  if ((await redisClient.set(key, userId, 'EX', 10 * 60, 'NX')) !== 'OK')
    return null;
  try {
    const summary = await execute(job, userId);
    logger.warn(`[Cron:${job.key}] Run now by ${userId}: ${summary}`);
    return summary;
  } finally {
    await redisClient
      .del(key)
      .catch((e: Error) =>
        logger.error(
          `[Cron:${job.key}] Could not release the manual lock: ${e.message}`
        )
      );
  }
}
