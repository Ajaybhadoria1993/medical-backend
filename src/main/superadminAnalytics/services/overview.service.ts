import { CacheKeys, getOrSetCache } from '../../../utils/cache.util';
import { getSourceDataPort } from '../ports';
import type { PeriodQueryDto } from '../schemas/superadminAnalytics.schema';
import type { ClinicStage } from '../types/metrics.types';
import type { OverviewResponse } from '../types/responses.types';
import {
  clinicStage,
  cohortFunnel,
  freeToPaid,
  mrrBridge,
  mrrByClinicAt,
  liveTrials,
  plansInUse,
  trialToPaid,
  yearTrend,
} from '../utils/metrics.utils';
import { resolvePeriod, storedNow } from '../utils/period.utils';
import { FollowupsService } from './followups.service';

/** Figures may lag by this much; they are business trends, not live counters. */
const OVERVIEW_TTL_SECONDS = 300;

const EMPTY_STAGES: Record<ClinicStage, number> = {
  Registered: 0,
  SetupDone: 0,
  FirstValue: 0,
  Active: 0,
  Declining: 0,
  Dormant: 0,
  Churned: 0,
};

export class OverviewService {
  static async getOverview(query: PeriodQueryDto): Promise<OverviewResponse> {
    const p = resolvePeriod(query);
    const [cached, attention, billing] = await Promise.all([
      getOrSetCache(
        CacheKeys.superadminOverview(
          p.current.from,
          p.current.to,
          p.previous.from
        ),
        OVERVIEW_TTL_SECONDS,
        () => OverviewService.build(p)
      ),
      // Read live, outside the cache, so resolving a task drops the count at once.
      FollowupsService.openCounts(),
      getSourceDataPort().getBillingHealth(p.today, p.today),
    ]);
    const last = billing.razorpayMatch.lastWebhookAt;
    return {
      ...cached,
      attention: {
        ...attention,
        billingDifferences: billing.razorpayMatch.openDifferences,
        pastDue: billing.autoPay.pastDue,
        // No Razorpay event for 6 h usually means the webhook URL or secret is wrong.
        webhookQuiet:
          !last || Date.now() - new Date(last).getTime() > 6 * 60 * 60 * 1000,
      },
    };
  }

  private static async build(
    p: ReturnType<typeof resolvePeriod>
  ): Promise<OverviewResponse> {
    const port = getSourceDataPort();
    const [facts, spans, appointments] = await Promise.all([
      port.getClinicFacts(p.today),
      port.getSubscriptionSpans(),
      port.getMonthlyAppointments(`${p.today.slice(0, 4)}-01-01`),
    ]);
    const now = storedNow();
    const bridge = mrrBridge(spans, p.start, p.end);
    const payingNow = mrrByClinicAt(spans, now);

    const stages = { ...EMPTY_STAGES };
    let activePaidClinics = 0;
    for (const f of facts) {
      const stage = clinicStage(f, now);
      stages[stage]++;
      const using = stage === 'Active' || stage === 'Declining';
      if (using && payingNow.has(f.clinicId)) activePaidClinics++;
    }

    const trials = liveTrials(spans, facts, now);
    const trialLabels = new Map(
      (
        await port.getClinicLabels(trials.slice(0, 5).map((t) => t.clinicId))
      ).map((l) => [l.clinicId, l])
    );

    const registeredIn = (from: Date, to: Date) =>
      facts.filter((f) => f.createdAt >= from && f.createdAt <= to).length;

    return {
      period: p.current,
      previousPeriod: p.previous,
      kpis: {
        mrr: bridge.closing,
        mrrPrevious: bridge.opening,
        paidClinics: mrrByClinicAt(spans, p.end).size,
        paidClinicsPrevious: mrrByClinicAt(spans, p.start).size,
        activePaidClinics,
        newRegistrations: registeredIn(p.start, p.end),
        newRegistrationsPrevious: registeredIn(p.prevStart, p.prevEnd),
        freeToPaid: freeToPaid(facts, spans, p.start, p.end),
        trialToPaid: trialToPaid(spans, p.start, p.end),
        lostMrr: bridge.contraction + bridge.churned,
      },
      mrrBridge: bridge,
      trend: yearTrend(
        spans,
        facts,
        new Map(appointments.map((a) => [a.month, a.count])),
        now
      ),
      funnel: cohortFunnel(facts, spans, p.start, p.end, now),
      stages,
      plans: plansInUse(spans, facts, now),
      trials: {
        total: trials.length,
        endingFirst: trials.slice(0, 5).map((t) => ({
          ...t,
          clinicCode: trialLabels.get(t.clinicId)?.clinicCode ?? '—',
          name: trialLabels.get(t.clinicId)?.name ?? 'Removed clinic',
        })),
      },
      attention: {
        paidDormant: 0,
        declining: 0,
        setupStuck: 0,
        noFirstValue: 0,
        payoutBlocked: 0,
      },
      generatedAt: new Date().toISOString(),
    };
  }
}
