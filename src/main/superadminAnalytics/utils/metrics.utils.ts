import type {
  ClinicFacts,
  ClinicStage,
  Conversion,
  Funnel,
  MovementCounts,
  MrrBridge,
  PlanMixRow,
  SourceRow,
  SubscriptionSpan,
  TimeToFirstValue,
  TrendPoint,
} from '../types/metrics.types';

/** Master Plan thresholds; change here, never inline. */
export const ACTIVE_MIN_APPOINTMENTS = 5;
export const ACTIVE_MIN_DAYS = 4;
export const DECLINE_DROP_RATIO = 0.5;
export const DORMANT_AFTER_DAYS = 14;
export const CHURNED_AFTER_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export const covers = (s: SubscriptionSpan, at: Date) =>
  s.startsAt <= at && (s.expiresAt === null || s.expiresAt > at);

/** Recurring revenue per clinic at one instant. Trials and free plans count as 0. */
export function mrrByClinicAt(
  spans: SubscriptionSpan[],
  at: Date
): Map<string, number> {
  const mrr = new Map<string, number>();
  for (const s of spans) {
    if (!s.isPaid || s.isTrial || s.monthlyValue <= 0 || !covers(s, at))
      continue;
    mrr.set(s.clinicId, (mrr.get(s.clinicId) ?? 0) + s.monthlyValue);
  }
  return mrr;
}

const sum = (m: Map<string, number>) =>
  [...m.values()].reduce((a, b) => a + b, 0);

type Move = 'new' | 'expansion' | 'contraction' | 'churned';

/**
 * Every per-clinic MRR change inside (start, end], step by step at each plan start/expiry.
 * Comparing only the two ends missed clinics that joined and left within a long range.
 */
function mrrMoves(spans: SubscriptionSpan[], start: Date, end: Date) {
  const inside = (t: Date | null): t is Date => !!t && t > start && t < end;
  const stamps = new Set<number>([start.getTime(), end.getTime()]);
  for (const s of spans) {
    if (inside(s.startsAt)) stamps.add(s.startsAt.getTime());
    if (inside(s.expiresAt)) stamps.add(s.expiresAt.getTime());
  }
  const checkpoints = [...stamps].sort((a, b) => a - b).map((t) => new Date(t));
  const moves: { id: string; kind: Move; amount: number }[] = [];
  let before = mrrByClinicAt(spans, checkpoints[0]);
  for (const at of checkpoints.slice(1)) {
    const after = mrrByClinicAt(spans, at);
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const was = before.get(id) ?? 0;
      const now = after.get(id) ?? 0;
      if (was === 0 && now > 0) moves.push({ id, kind: 'new', amount: now });
      else if (was > 0 && now === 0)
        moves.push({ id, kind: 'churned', amount: was });
      else if (now > was)
        moves.push({ id, kind: 'expansion', amount: now - was });
      else if (now < was)
        moves.push({ id, kind: 'contraction', amount: was - now });
    }
    before = after;
  }
  return moves;
}

/** Opening + every move in the range = closing, by construction (each step telescopes). */
export function mrrBridge(
  spans: SubscriptionSpan[],
  start: Date,
  end: Date
): MrrBridge {
  const bridge: MrrBridge = {
    opening: sum(mrrByClinicAt(spans, start)),
    newMrr: 0,
    expansion: 0,
    contraction: 0,
    churned: 0,
    closing: sum(mrrByClinicAt(spans, end)),
  };
  const field = {
    new: 'newMrr',
    expansion: 'expansion',
    contraction: 'contraction',
    churned: 'churned',
  } as const;
  for (const m of mrrMoves(spans, start, end))
    bridge[field[m.kind]] += m.amount;
  return bridge;
}

/** Clinics behind each mrrBridge row; a clinic counts once per row however often it moved. */
export function movementCounts(
  spans: SubscriptionSpan[],
  start: Date,
  end: Date
): MovementCounts {
  const ids: Record<Move, Set<string>> = {
    new: new Set(),
    expansion: new Set(),
    contraction: new Set(),
    churned: new Set(),
  };
  for (const m of mrrMoves(spans, start, end)) ids[m.kind].add(m.id);
  return {
    newPaid: ids.new.size,
    upgrades: ids.expansion.size,
    downgrades: ids.contraction.size,
    churned: ids.churned.size,
  };
}

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

/** Clinics and MRR per paid plan at one instant, biggest MRR first. */
export function planMix(spans: SubscriptionSpan[], at: Date): PlanMixRow[] {
  const byPlan = new Map<string, { clinics: Set<string>; mrr: number }>();
  for (const s of spans) {
    if (!s.isPaid || s.isTrial || s.monthlyValue <= 0 || !covers(s, at))
      continue;
    const row = byPlan.get(s.planName) ?? {
      clinics: new Set<string>(),
      mrr: 0,
    };
    row.clinics.add(s.clinicId);
    row.mrr += s.monthlyValue;
    byPlan.set(s.planName, row);
  }
  const total = [...byPlan.values()].reduce((a, r) => a + r.mrr, 0);
  return [...byPlan.entries()]
    .map(([planName, r]) => ({
      planName,
      clinics: r.clinics.size,
      mrr: r.mrr,
      share: total ? oneDecimal((r.mrr / total) * 100) : 0,
    }))
    .sort((a, b) => b.mrr - a.mrr);
}

export const daysSince = (d: Date, now: Date) =>
  (now.getTime() - d.getTime()) / DAY_MS;

const inCohort = (f: ClinicFacts, start: Date, end: Date) =>
  f.createdAt >= start && f.createdAt <= end;

/** Median and buckets of registration → First Value, for the period's cohort. */
export function timeToFirstValue(
  facts: ClinicFacts[],
  start: Date,
  end: Date
): TimeToFirstValue {
  const t: TimeToFirstValue = {
    medianDays: null,
    underOneDay: 0,
    oneToThree: 0,
    threeToSeven: 0,
    overSeven: 0,
    notYet: 0,
  };
  const days: number[] = [];
  for (const f of facts) {
    if (!inCohort(f, start, end)) continue;
    if (!f.firstValueAt) {
      t.notYet++;
      continue;
    }
    const d = Math.max(0, daysSince(f.createdAt, f.firstValueAt));
    days.push(d);
    if (d < 1) t.underOneDay++;
    else if (d < 3) t.oneToThree++;
    else if (d < 7) t.threeToSeven++;
    else t.overSeven++;
  }
  if (days.length) {
    days.sort((a, b) => a - b);
    const mid = Math.floor(days.length / 2);
    const median =
      days.length % 2 ? days[mid] : (days[mid - 1] + days[mid]) / 2;
    t.medianDays = oneDecimal(median);
  }
  return t;
}

/** Per acquisition source: the period's cohort, how far it got, and the MRR it brings now. */
export function sourcePerformance(
  facts: ClinicFacts[],
  spans: SubscriptionSpan[],
  start: Date,
  end: Date,
  now: Date
): SourceRow[] {
  const mrrNow = mrrByClinicAt(spans, now);
  const rows = new Map<string, SourceRow>();
  for (const f of facts) {
    if (!inCohort(f, start, end)) continue;
    const r = rows.get(f.acquisitionSource) ?? {
      source: f.acquisitionSource,
      registered: 0,
      firstValue: 0,
      paid: 0,
      mrr: 0,
    };
    r.registered++;
    if (f.firstValueAt) r.firstValue++;
    const mrr = mrrNow.get(f.clinicId) ?? 0;
    if (mrr > 0) {
      r.paid++;
      r.mrr += mrr;
    }
    rows.set(f.acquisitionSource, r);
  }
  return [...rows.values()].sort((a, b) => b.registered - a.registered);
}

/** Usage stage from the Master Plan lifecycle table; billing is tracked separately. */
export function clinicStage(f: ClinicFacts, now: Date): ClinicStage {
  if (f.deleted) return 'Churned';
  if (!f.firstValueAt)
    return f.onboardingCompleted ? 'SetupDone' : 'Registered';
  const idle = f.lastActivityAt ? daysSince(f.lastActivityAt, now) : Infinity;
  if (idle >= CHURNED_AFTER_DAYS) return 'Churned';
  if (idle >= DORMANT_AFTER_DAYS) return 'Dormant';
  const active =
    f.appointments30 >= ACTIVE_MIN_APPOINTMENTS &&
    f.activeDays30 >= ACTIVE_MIN_DAYS;
  if (!active) return 'FirstValue';
  const dropped =
    f.appointmentsPrev30 > 0 &&
    f.appointments30 <= f.appointmentsPrev30 * (1 - DECLINE_DROP_RATIO);
  return dropped ? 'Declining' : 'Active';
}

const rate = (converted: number, eligible: number): Conversion => ({
  converted,
  eligible,
  rate: eligible ? Math.round((converted / eligible) * 1000) / 10 : 0,
});

/** Billing at one instant: a paid plan beats a trial, anything else is Free. */
// Unpaid rows are skipped; a 100%-off coupon plan still counts as Paid (MRR stays 0).
export function billingAt(
  spans: SubscriptionSpan[],
  clinicId: string,
  at: Date
): { billing: 'Paid' | 'Trial' | 'Free'; planName: string | null } {
  const live = spans.filter(
    (s) => s.clinicId === clinicId && s.isPaid && covers(s, at)
  );
  const paid =
    live.find((s) => !s.isTrial && s.monthlyValue > 0) ??
    live.find((s) => !s.isTrial && !s.isFreePlan);
  if (paid) return { billing: 'Paid', planName: paid.planName };
  const trial = live.find((s) => s.isTrial);
  if (trial) return { billing: 'Trial', planName: trial.planName };
  return { billing: 'Free', planName: live[0]?.planName ?? null };
}

export const firstPaidStart = (spans: SubscriptionSpan[], clinicId: string) =>
  spans
    .filter(
      (s) =>
        s.clinicId === clinicId && s.isPaid && !s.isTrial && s.monthlyValue > 0
    )
    .reduce<Date | null>(
      (min, s) => (!min || s.startsAt < min ? s.startsAt : min),
      null
    );

/** Cohort: clinics reaching First Value in [start, end]; converted = paid by `end`. */
export function freeToPaid(
  facts: ClinicFacts[],
  spans: SubscriptionSpan[],
  start: Date,
  end: Date
): Conversion {
  const cohort = facts.filter(
    (f) => f.firstValueAt && f.firstValueAt >= start && f.firstValueAt <= end
  );
  const converted = cohort.filter((f) => {
    const paid = firstPaidStart(spans, f.clinicId);
    return paid !== null && paid <= end;
  }).length;
  return rate(converted, cohort.length);
}

const isUsing = (stage: ClinicStage) =>
  stage === 'Active' || stage === 'Declining';

/** Every step is a subset of the one before, so the percentages always add up. */
export function cohortFunnel(
  facts: ClinicFacts[],
  spans: SubscriptionSpan[],
  start: Date,
  end: Date,
  now: Date
): Funnel {
  const cohort = facts.filter(
    (f) => f.createdAt >= start && f.createdAt <= end
  );
  const setup = cohort.filter((f) => f.onboardingCompleted || f.firstValueAt);
  const fv = setup.filter((f) => f.firstValueAt);
  const active = fv.filter((f) => isUsing(clinicStage(f, now)));
  const paid = active.filter((f) => {
    const p = firstPaidStart(spans, f.clinicId);
    return p !== null && p <= end;
  });
  return {
    registered: cohort.length,
    setupDone: setup.length,
    firstValue: fv.length,
    active: active.length,
    paid: paid.length,
  };
}

/** Days after sign-up before a stuck clinic is flagged (Master Plan Action Center rules). */
export const SETUP_STUCK_DAYS = 3;
export const NO_FIRST_VALUE_DAYS = 7;

/** One row per month of `now`'s year, Jan to this month: MRR and paid clinics at month end, plus monthly counts. */
export function yearTrend(
  spans: SubscriptionSpan[],
  facts: ClinicFacts[],
  appointmentsByMonth: Map<string, number>,
  now: Date
): TrendPoint[] {
  const year = now.getUTCFullYear();
  const out: TrendPoint[] = [];
  for (let m = 0; m <= now.getUTCMonth(); m++) {
    const monthEnd = new Date(Date.UTC(year, m + 1, 0, 23, 59, 59, 999));
    const at = monthEnd > now ? now : monthEnd;
    const month = `${year}-${String(m + 1).padStart(2, '0')}`;
    const paying = mrrByClinicAt(spans, at);
    out.push({
      month,
      mrr: sum(paying),
      paidClinics: paying.size,
      registrations: facts.filter((f) =>
        f.createdAt.toISOString().startsWith(month)
      ).length,
      appointments: appointmentsByMonth.get(month) ?? 0,
    });
  }
  return out;
}

/** Cohort: trials started in [start, end]; converted = a paid plan after the trial began. */
export function trialToPaid(
  spans: SubscriptionSpan[],
  start: Date,
  end: Date
): Conversion {
  const trials = new Map<string, Date>();
  for (const s of spans) {
    if (!s.isTrial || s.startsAt < start || s.startsAt > end) continue;
    const seen = trials.get(s.clinicId);
    if (!seen || s.startsAt < seen) trials.set(s.clinicId, s.startsAt);
  }
  let converted = 0;
  for (const [clinicId, trialStart] of trials) {
    const paidAfter = spans.some(
      (s) =>
        s.clinicId === clinicId &&
        s.isPaid &&
        !s.isTrial &&
        s.monthlyValue > 0 &&
        s.startsAt >= trialStart &&
        s.startsAt <= end
    );
    if (paidAfter) converted++;
  }
  return rate(converted, trials.size);
}

// Same set as the Clinics list (approved, not deleted), so a count and the list it opens agree.
const MANAGED_STATUSES = new Set(['Active', 'Inactive', 'Blocked']);
const isManaged = (f: ClinicFacts) =>
  !f.deleted && MANAGED_STATUSES.has(f.accountStatus);

/** Approved clinics on a running, unpaid trial now, soonest ending first. */
export function liveTrials(
  spans: SubscriptionSpan[],
  facts: ClinicFacts[],
  now: Date
) {
  const gone = new Set(
    facts.filter((f) => !isManaged(f)).map((f) => f.clinicId)
  );
  const out: {
    clinicId: string;
    planName: string;
    endsOn: string;
    daysLeft: number;
  }[] = [];
  for (const s of spans) {
    if (!s.isTrial || !s.expiresAt || !covers(s, now) || gone.has(s.clinicId))
      continue;
    if (billingAt(spans, s.clinicId, now).billing !== 'Trial') continue;
    out.push({
      clinicId: s.clinicId,
      planName: s.planName,
      // Spans are on the IST clock, so the ISO date part is the IST day.
      endsOn: s.expiresAt.toISOString().slice(0, 10),
      daysLeft: Math.max(
        0,
        Math.ceil((s.expiresAt.getTime() - now.getTime()) / DAY_MS)
      ),
    });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Current plan of every approved clinic, counted per plan and split paid / trial / free; biggest first. */
export function plansInUse(
  spans: SubscriptionSpan[],
  facts: ClinicFacts[],
  now: Date
) {
  const rows = new Map<
    string,
    {
      planName: string;
      paid: number;
      trial: number;
      free: number;
      total: number;
    }
  >();
  for (const f of facts) {
    if (!isManaged(f)) continue;
    const { billing, planName } = billingAt(spans, f.clinicId, now);
    if (!planName) continue;
    const r = rows.get(planName) ?? {
      planName,
      paid: 0,
      trial: 0,
      free: 0,
      total: 0,
    };
    r[billing === 'Paid' ? 'paid' : billing === 'Trial' ? 'trial' : 'free']++;
    r.total++;
    rows.set(planName, r);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total);
}
