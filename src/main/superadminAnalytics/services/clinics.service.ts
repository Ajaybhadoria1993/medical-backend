import { getISTDateString } from '../../../utils/istDateTime';
import { HttpError } from '../../../middlewear/errorHandler';
import { getSourceDataPort } from '../ports';
import { storedNow } from '../utils/period.utils';
import type { ClinicListQueryDto } from '../schemas/superadminAnalytics.schema';
import type {
  ClinicFacts,
  ClinicIdentity,
  SubscriptionSpan,
} from '../types/metrics.types';
import type {
  ClinicListResponse,
  ClinicRow,
  ClinicSummaryResponse,
} from '../types/responses.types';
import {
  billingAt,
  clinicStage,
  covers,
  firstPaidStart,
  mrrByClinicAt,
} from '../utils/metrics.utils';

/** Search hard cap (BE §7); the whole platform fits under it today. */
const SEARCH_CAP = 500;

const NO_FACTS = {
  appointments30: 0,
  appointmentsPrev30: 0,
  activeDays30: 0,
  lastActivityAt: null,
  firstValueAt: null,
};

function toRow(
  c: ClinicIdentity,
  f: ClinicFacts | undefined,
  spans: SubscriptionSpan[],
  mrr: Map<string, number>,
  now: Date
): ClinicRow & { facts: ClinicFacts | undefined } {
  const { billing, planName } = billingAt(spans, c.clinicId, now);
  const trialEnd =
    billing === 'Trial'
      ? (spans.find(
          (s) =>
            s.clinicId === c.clinicId &&
            s.isTrial &&
            s.expiresAt &&
            covers(s, now)
        )?.expiresAt ?? null)
      : null;
  const stage = f
    ? clinicStage(f, now)
    : clinicStage(
        {
          ...NO_FACTS,
          clinicId: c.clinicId,
          createdAt: c.createdAt,
          acquisitionSource: c.acquisitionSource,
          onboardingCompleted: false,
          accountStatus: c.status,
          deleted: false,
        },
        now
      );
  return {
    ...c,
    stage,
    billing,
    planName,
    // Spans are on the IST clock, so the ISO date part is the IST day.
    trialEndsOn: trialEnd ? trialEnd.toISOString().slice(0, 10) : null,
    trialDaysLeft: trialEnd
      ? Math.max(
          0,
          Math.ceil((trialEnd.getTime() - now.getTime()) / 86_400_000)
        )
      : null,
    mrr: mrr.get(c.clinicId) ?? 0,
    appointments30: f?.appointments30 ?? 0,
    appointmentsPrev30: f?.appointmentsPrev30 ?? 0,
    lastActivityAt: f?.lastActivityAt ?? null,
    facts: f,
  };
}

export class ClinicsService {
  static async list(query: ClinicListQueryDto): Promise<ClinicListResponse> {
    const port = getSourceDataPort();
    const [clinics, facts, spans, stats, locations] = await Promise.all([
      port.searchClinics(
        query.q,
        { status: query.status, city: query.city, state: query.state },
        SEARCH_CAP
      ),
      port.getClinicFacts(getISTDateString()),
      port.getSubscriptionSpans(),
      port.countByAccountStatus(),
      port.getLocationOptions(),
    ]);
    const now = storedNow();
    const byId = new Map(facts.map((f) => [f.clinicId, f]));
    const mrr = mrrByClinicAt(spans, now);

    // ponytail: stage is derived in Node, so filters run after the query; move to SQL past ~5k clinics.
    const rows = clinics
      .map((c) => toRow(c, byId.get(c.clinicId), spans, mrr, now))
      .filter(
        (r) =>
          (!query.stage || r.stage === query.stage) &&
          (!query.billing || r.billing === query.billing) &&
          (!query.source || r.acquisitionSource === query.source)
      );

    const offset = (query.pageNumber - 1) * query.pageSize;
    return {
      stats,
      locations,
      items: rows
        .slice(offset, offset + query.pageSize)
        .map(({ facts: _f, ...row }) => row),
      pageNumber: query.pageNumber,
      pageSize: query.pageSize,
      total: rows.length,
    };
  }

  static async summary(clinicId: string): Promise<ClinicSummaryResponse> {
    const port = getSourceDataPort();
    const [clinic, facts, spans] = await Promise.all([
      port.getClinicIdentity(clinicId),
      port.getClinicFacts(getISTDateString()),
      port.getSubscriptionSpans(),
    ]);
    if (!clinic) throw new HttpError(404, 'Clinic not found');
    const now = storedNow();
    const { facts: f, ...row } = toRow(
      clinic,
      facts.find((x) => x.clinicId === clinicId),
      spans,
      mrrByClinicAt(spans, now),
      now
    );
    return {
      ...row,
      firstValueAt: f?.firstValueAt ?? null,
      activeDays30: f?.activeDays30 ?? 0,
      firstPaidAt: firstPaidStart(spans, clinicId),
    };
  }
}
