import type { ExpiryAlert, NotifyPort, UsageAlert } from '../../main/credits';
import { notify } from '../../main/notifications/queues/notification.queue';

const usageCtx = (alert: UsageAlert) => ({
  clinicId: alert.clinicId,
  used: alert.used,
  limit: alert.limit,
  resetsOn: alert.resetsOn,
});

// Stable ids make a repeated call a no-op; BullMQ rejects ':' in ids.
const jobId = (...parts: string[]) =>
  `credits-${parts.join('-')}`.replace(/[:.]/g, '-');

export const notifyAdapter: NotifyPort = {
  usageWarning: (alert) =>
    notify('credits.usage_warning', usageCtx(alert), {
      jobId: jobId('warning', alert.clinicId, alert.channel, alert.periodKey),
    }),
  usagePaused: (alert) =>
    notify('credits.usage_paused', usageCtx(alert), {
      jobId: jobId('paused', alert.clinicId, alert.channel, alert.periodKey),
    }),
  creditsExpiring: (alert: ExpiryAlert) =>
    notify(
      'credits.expiring',
      {
        clinicId: alert.clinicId,
        grantId: alert.grantId,
        creditsLeft: alert.creditsLeft,
        expiresOn: alert.expiresOn,
      },
      { jobId: jobId('expiring', alert.grantId) }
    ),
};
