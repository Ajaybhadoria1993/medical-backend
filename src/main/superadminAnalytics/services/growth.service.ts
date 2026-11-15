import { CacheKeys, getOrSetCache } from '../../../utils/cache.util';
import { getSourceDataPort } from '../ports';
import type { PeriodQueryDto } from '../schemas/superadminAnalytics.schema';
import type { GrowthResponse } from '../types/responses.types';
import {
  cohortFunnel,
  freeToPaid,
  liveTrials,
  plansInUse,
  sourcePerformance,
  timeToFirstValue,
  trialToPaid,
} from '../utils/metrics.utils';
import { resolvePeriod, storedNow } from '../utils/period.utils';

/** Business figures; a few minutes' lag is fine and nothing invalidates them. */
const GROWTH_TTL_SECONDS = 300;

const pct = (n: number, of: number) =>
  of ? Math.round((n / of) * 1000) / 10 : 0;

export class GrowthService {
  static getGrowth(query: PeriodQueryDto): Promise<GrowthResponse> {
    const p = resolvePeriod(query);
    return getOrSetCache(
      CacheKeys.superadminGrowth(p.current.from, p.current.to, p.previous.from),
      GROWTH_TTL_SECONDS,
      () => GrowthService.build(p)
    );
  }

  private static async build(
    p: ReturnType<typeof resolvePeriod>
  ): Promise<GrowthResponse> {
    const port = getSourceDataPort();
    const [facts, spans] = await Promise.all([
      port.getClinicFacts(p.today),
      port.getSubscriptionSpans(),
    ]);
    const now = storedNow();
    const trials = liveTrials(spans, facts, now);
    const funnel = cohortFunnel(facts, spans, p.start, p.end, now);
    const registeredIn = (from: Date, to: Date) =>
      facts.filter((f) => f.createdAt >= from && f.createdAt <= to).length;

    return {
      period: p.current,
      previousPeriod: p.previous,
      registrations: funnel.registered,
      registrationsPrevious: registeredIn(p.prevStart, p.prevEnd),
      funnel,
      setupRate: pct(funnel.setupDone, funnel.registered),
      firstValueRate: pct(funnel.firstValue, funnel.registered),
      freeToPaid: freeToPaid(facts, spans, p.start, p.end),
      trialToPaid: trialToPaid(spans, p.start, p.end),
      timeToFirstValue: timeToFirstValue(facts, p.start, p.end),
      sources: sourcePerformance(facts, spans, p.start, p.end, now),
      plans: plansInUse(spans, facts, now).map((row) => {
        const next = trials.find((t) => t.planName === row.planName);
        return {
          ...row,
          nextTrialEndsOn: next?.endsOn ?? null,
          nextTrialDaysLeft: next?.daysLeft ?? null,
        };
      }),
      generatedAt: new Date().toISOString(),
    };
  }
}
