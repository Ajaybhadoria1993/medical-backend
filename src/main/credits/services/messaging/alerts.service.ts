import redisClient from '../../../../configurations/redisConfig';
import { CacheKeys } from '../../../../utils/cache.util';
import logger from '../../../../utils/logger';
import { getNotifyPort } from '../../ports';
import type { BillingPeriod, UsageAlert } from '../../types/credits.types';
import type { MessageChannel } from '../../utils/creditTypes.utils';

// Outlives the longest billing month, so a marker never expires mid-period.
const ALERT_MARKER_TTL_SECONDS = 35 * 24 * 60 * 60;

const resetsOnFormat = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
});

interface AlertInput {
  clinicId: string;
  channel: MessageChannel;
  used: number;
  limit: number;
  period: BillingPeriod;
}

export class AlertsService {
  static warning(input: AlertInput): Promise<void> {
    return this.sendOnce(input, 'warning');
  }

  static paused(input: AlertInput): Promise<void> {
    return this.sendOnce(input, 'paused');
  }

  /** At most one alert of each kind per clinic and billing period. Never throws:
   *  an alert must not stop or repeat a message. */
  private static async sendOnce(
    { clinicId, channel, used, limit, period }: AlertInput,
    kind: 'warning' | 'paused'
  ): Promise<void> {
    const periodKey = period.start.toISOString();
    try {
      const first = await redisClient.set(
        CacheKeys.creditUsageAlert(clinicId, channel, periodKey, kind),
        '1',
        'EX',
        ALERT_MARKER_TTL_SECONDS,
        'NX'
      );
      if (first !== 'OK') return;

      const alert: UsageAlert = {
        clinicId,
        channel,
        used,
        limit,
        resetsOn: resetsOnFormat.format(period.end),
        periodKey,
      };
      const notify = getNotifyPort();
      await (kind === 'warning'
        ? notify.usageWarning(alert)
        : notify.usagePaused(alert));
    } catch (err) {
      logger.error(
        `[Credits] Failed to send ${kind} alert for clinic ${clinicId}: ${(err as Error).message}`
      );
    }
  }
}
