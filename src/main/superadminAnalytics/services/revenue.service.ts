import { CacheKeys, getOrSetCache } from '../../../utils/cache.util';
import { getSourceDataPort } from '../ports';
import type { PeriodQueryDto } from '../schemas/superadminAnalytics.schema';
import type { RevenueResponse } from '../types/responses.types';
import {
  movementCounts,
  mrrBridge,
  mrrByClinicAt,
  planMix,
} from '../utils/metrics.utils';
import { resolvePeriod } from '../utils/period.utils';

/** Business figures; a few minutes' lag is fine and nothing invalidates them. */
const REVENUE_TTL_SECONDS = 300;

export class RevenueService {
  static getRevenue(query: PeriodQueryDto): Promise<RevenueResponse> {
    const p = resolvePeriod(query);
    return getOrSetCache(
      CacheKeys.superadminRevenue(
        p.current.from,
        p.current.to,
        p.previous.from
      ),
      REVENUE_TTL_SECONDS,
      () => RevenueService.build(p)
    );
  }

  private static async build(
    p: ReturnType<typeof resolvePeriod>
  ): Promise<RevenueResponse> {
    const port = getSourceDataPort();
    const [spans, money, billing] = await Promise.all([
      port.getSubscriptionSpans(),
      port.getMoney(p.current.from, p.current.to),
      port.getBillingHealth(p.current.from, p.current.to),
    ]);
    const bridge = mrrBridge(spans, p.start, p.end);
    const paying = mrrByClinicAt(spans, p.end).size;
    const { collected } = money;

    return {
      period: p.current,
      previousPeriod: p.previous,
      mrr: bridge.closing,
      mrrPrevious: bridge.opening,
      arpc: paying ? Math.round(bridge.closing / paying) : 0,
      mrrBridge: bridge,
      movement: movementCounts(spans, p.start, p.end),
      collected: {
        ...collected,
        total: collected.subscriptions + collected.bookingFees,
      },
      planMix: planMix(spans, p.end),
      failedPayments: money.failed,
      billing,
      generatedAt: new Date().toISOString(),
    };
  }
}
