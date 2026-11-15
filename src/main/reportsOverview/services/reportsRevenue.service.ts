/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import { UserModel } from '../../users/models/user.model';
import {
  ReportsRevenueQueryDto,
  ReportsRevenueTrendQueryDto,
} from '../schemas/reportsRevenue.schemas';
import {
  DateRange,
  buildComparisonRange,
  calcChange,
  toPercentage,
  wholeRangeValues,
} from '../utils/reportsPeriod.utils';
import {
  calendarDay,
  generateDateSlots,
  mapDataToSlots,
  padSlots,
  rangeDays,
  resolveTruncUnit,
  scopeFilter,
  serviceJoin,
  slotMeta,
} from '../utils/reportsTrend.utils';
import {
  ReportsRevenueData,
  RevenueMetricItem,
} from '../types/reportsRevenue.types';
import { DUE_AMOUNT, PAYMENT_MODE } from '../../dashboard/utils/revenueSql';
import { MoneyReadService } from '../../money';
import {
  NOT_ATTENDED,
  UNPAID_PAYMENT,
} from '../../dashboard/services/clinicInsights.service';
import { getISTDateString, istDayBoundsUtc } from '../../../utils/istDateTime';

/** A Reports range for the money reader, with the Doctor, Service and Payment Mode filters. */
function moneyRange(
  clinicId: string,
  range: DateRange,
  query: AnyRevenueQuery
) {
  return {
    clinicId,
    start: istDayBoundsUtc(range.start.slice(0, 10)).start.toISOString(),
    end: istDayBoundsUtc(range.end.slice(0, 10)).end.toISOString(),
    doctorIds: query.doctorId ? [query.doctorId] : undefined,
    paymentMode: query.paymentMode || undefined,
    serviceName: query.department || undefined,
  };
}

/** Payment mode as shown: all-lowercase "cash" → "Cash" ("UPI" stays); missing is "Not Recorded". */
const modeLabel = (m: string) =>
  !m || m === 'Unknown'
    ? 'Not Recorded'
    : m === m.toLowerCase()
      ? m.replace(/\b\w/g, (c) => c.toUpperCase())
      : m;

const CACHE_TTL = 120; // 2 min

/** Fewer paid appointments than this and a weekday "pattern" is noise, so no insight is shown. */
const MIN_INSIGHT_SAMPLE = 5;

type AnyRevenueQuery = ReportsRevenueQueryDto | ReportsRevenueTrendQueryDto;

// Dues = unpaid bill on visits that weren't cancelled or no-shows (the aging chart, which stays on visits).
const DUES = sql`CASE WHEN ${UNPAID_PAYMENT} AND NOT ${NOT_ATTENDED} THEN ${DUE_AMOUNT} ELSE 0 END`;

/** Service + Doctor (shared scope) + Payment Mode. */
function scope(query: AnyRevenueQuery) {
  return sql`${scopeFilter(query)}
    ${query.paymentMode ? sql`AND ${PAYMENT_MODE} = ${query.paymentMode}` : sql``}`;
}

/** Payment rows of the clinic's appointments in a range, with every filter applied. */
function paymentsIn(
  clinicId: string,
  range: DateRange,
  query: AnyRevenueQuery,
  extraJoin = sql``
) {
  return sql`FROM ${AppointmentPaymentModel}
    INNER JOIN ${AppointmentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
    ${extraJoin}
    ${serviceJoin(query)}
    WHERE ${AppointmentModel.clinicId} = ${clinicId}
      AND ${AppointmentModel.appointmentDate} BETWEEN ${range.start} AND ${range.end}
      ${scope(query)}`;
}

function buildCacheKey(
  clinicId: string,
  query: ReportsRevenueQueryDto
): string {
  return [
    'reports:revenue',
    clinicId,
    query.startDate,
    query.endDate,
    query.compareStartDate || 'auto',
    query.compareEndDate || 'auto',
    query.department || 'all',
    query.doctorId || 'all',
    query.paymentMode || 'all',
  ].join(':');
}

function buildTrendCacheKey(
  clinicId: string,
  query: ReportsRevenueTrendQueryDto
): string {
  return [
    'reports:revenue:trend',
    clinicId,
    query.type,
    query.period,
    query.startDate,
    query.endDate,
    query.compareStartDate || 'auto',
    query.compareEndDate || 'auto',
    query.department || 'all',
    query.doctorId || 'all',
    query.paymentMode || 'all',
  ].join(':');
}

function metric(current: number, previous: number): RevenueMetricItem {
  const { change, changeType } = calcChange(current, previous);
  return { value: Math.round(current), change, changeType };
}

/** Rows as donut slices: non-positive groups dropped (a refund can exceed its row), top N + Others. */
function toDistribution(rows: any[], limit: number) {
  const positive = rows.filter((r) => Number(r.value) > 0);
  const total = positive.reduce((sum, r) => sum + Number(r.value), 0);
  const top = positive.slice(0, limit).map((r) => ({
    label: String(r.label),
    value: Math.round(Number(r.value)),
    percentage: toPercentage(Number(r.value), total),
  }));
  const rest = positive
    .slice(limit)
    .reduce((sum, r) => sum + Number(r.value), 0);
  if (rest > 0)
    top.push({
      label: 'Others',
      value: Math.round(rest),
      percentage: toPercentage(rest, total),
    });
  return top;
}

export class ReportsRevenueService {
  static async getRevenueReports(
    clinicId: string,
    query: ReportsRevenueQueryDto
  ): Promise<ReportsRevenueData> {
    const cacheKey = buildCacheKey(clinicId, query);
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[ReportsRevenue] Redis read error', err);
    }

    const ranges = buildComparisonRange(query);
    const { primary, comparison } = ranges;

    const [
      metrics,
      revenueTrend,
      revenueBreakdown,
      paymentModeDistribution,
      doctorWiseRevenue,
      appointmentTypeRevenue,
      outstandingAging,
      paymentModeOptions,
      insights,
    ] = await Promise.all([
      wholeRangeValues(ranges, (current) =>
        this.getMetrics(clinicId, current, comparison, query)
      ),
      this.getRevenueTrend(
        clinicId,
        primary,
        comparison,
        query,
        'auto',
        'revenue'
      ),
      this.getServiceRevenue(clinicId, primary, query),
      this.getPaymentModeDistribution(clinicId, primary, query),
      this.getDoctorWiseRevenue(clinicId, primary, query),
      this.getAppointmentTypeRevenue(clinicId, primary, query),
      this.getOutstandingAging(clinicId, primary, query),
      this.getPaymentModeOptions(clinicId),
      this.getInsights(clinicId, primary, query),
    ]);

    const result: ReportsRevenueData = {
      metrics,
      revenueTrend,
      revenueBreakdown,
      paymentModeDistribution,
      topServices: revenueBreakdown.map((s) => ({
        service: s.label,
        revenue: s.value,
        percentage: s.percentage,
      })),
      doctorWiseRevenue,
      appointmentTypeRevenue,
      outstandingAging,
      paymentModeOptions,
      insights,
    };

    try {
      await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(result));
    } catch (err) {
      logger.warn('[ReportsRevenue] Redis write error', err);
    }
    return result;
  }

  static async getRevenueTrendData(
    clinicId: string,
    query: ReportsRevenueTrendQueryDto
  ) {
    const cacheKey = buildTrendCacheKey(clinicId, query);
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[ReportsRevenue] Redis read error', err);
    }

    const { primary, comparison } = buildComparisonRange(query);
    const result = await this.getRevenueTrend(
      clinicId,
      primary,
      comparison,
      query,
      query.period,
      query.type
    );

    try {
      await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(result));
    } catch (err) {
      logger.warn('[ReportsRevenue] Redis write error', err);
    }
    return result;
  }

  // ─── METRICS (money from the ledger reader) ──────────────────────────────────

  private static async getMetrics(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsRevenueQueryDto
  ) {
    const totalsFor = async (range: DateRange) => {
      const r = moneyRange(clinicId, range, query);
      const [t, dues] = await Promise.all([
        MoneyReadService.totals(r),
        MoneyReadService.outstanding(r),
      ]);
      const net = t.netPaise / 100;
      const gross = t.grossPaise / 100;
      return {
        net,
        gross,
        refunds: gross - net,
        dues: dues.duePaise / 100,
        paid: t.payments,
        avg: t.payments ? net / t.payments : 0,
      };
    };
    const [cur, prev] = await Promise.all([
      totalsFor(primary),
      totalsFor(comparison),
    ]);
    return {
      totalRevenue: metric(cur.net, prev.net),
      amountCollected: metric(cur.gross, prev.gross),
      pendingAmount: metric(cur.dues, prev.dues),
      avgInvoiceValue: metric(cur.avg, prev.avg),
      totalInvoices: metric(cur.paid, prev.paid),
      refunds: metric(cur.refunds, prev.refunds),
    };
  }

  // ─── TREND ───────────────────────────────────────────────────────────────────

  /** 'revenue' = money received after refunds; 'collected' = gross, before refunds. */
  private static async getRevenueTrend(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: AnyRevenueQuery,
    period: string,
    type: 'revenue' | 'collected'
  ) {
    const days = rangeDays(primary);
    const truncUnit = resolveTruncUnit(period, days);
    const primarySlots = generateDateSlots(
      primary.start,
      primary.end,
      truncUnit,
      days
    );
    const comparisonSlots = padSlots(
      primarySlots,
      generateDateSlots(comparison.start, comparison.end, truncUnit, days)
    );
    // One row per bucket (summed here), the shape mapDataToSlots expects.
    const bucketsFor = async (range: DateRange) => {
      const rows = await MoneyReadService.buckets(
        moneyRange(clinicId, range, query),
        truncUnit as 'day' | 'week' | 'month',
        type === 'collected' ? 'gross' : 'net'
      );
      const byDt = new Map<string, number>();
      for (const x of rows)
        byDt.set(String(x.dt), (byDt.get(String(x.dt)) ?? 0) + x.paise);
      return [...byDt].map(([dt, paise]) => ({ dt, cnt: paise / 100 }));
    };
    const [current, previous] = await Promise.all([
      bucketsFor(primary),
      bucketsFor(comparison),
    ]);
    const round = (values: number[]) => values.map((v) => Math.round(v));
    return {
      ...slotMeta(primarySlots, comparisonSlots, primary, comparison),
      currentPeriod: round(mapDataToSlots(current, primarySlots, truncUnit)),
      previousPeriod: round(
        mapDataToSlots(previous, comparisonSlots, truncUnit)
      ),
    };
  }

  // ─── BREAKDOWNS (each adds up to Total Revenue) ──────────────────────────────

  /** Money grouped by service / day / type, summed across channels, top first. */
  private static async grouped(
    clinicId: string,
    primary: DateRange,
    query: ReportsRevenueQueryDto,
    by: 'service' | 'type'
  ) {
    const rows = await MoneyReadService.receivedGrouped(
      moneyRange(clinicId, primary, query),
      by
    );
    const byKey = new Map<string, number>();
    for (const x of rows)
      byKey.set(x.key, (byKey.get(x.key) ?? 0) + x.paise / 100);
    return [...byKey]
      .map(([label, value]) => ({
        label:
          by === 'service' && label === 'Unassigned' ? 'No Service' : label,
        value,
      }))
      .filter((r) => r.value !== 0)
      .sort((a, b) => b.value - a.value);
  }

  private static async getServiceRevenue(
    clinicId: string,
    primary: DateRange,
    query: ReportsRevenueQueryDto
  ) {
    return toDistribution(
      await this.grouped(clinicId, primary, query, 'service'),
      5
    );
  }

  private static async getPaymentModeDistribution(
    clinicId: string,
    primary: DateRange,
    query: ReportsRevenueQueryDto
  ) {
    const t = await MoneyReadService.totals(
      moneyRange(clinicId, primary, query)
    );
    const byLabel = new Map<string, number>();
    for (const [m, paise] of Object.entries(t.byModePaise))
      byLabel.set(modeLabel(m), (byLabel.get(modeLabel(m)) ?? 0) + paise / 100);
    const rows = [...byLabel]
      .map(([label, value]) => ({ label, value }))
      .filter((r) => r.value !== 0)
      .sort((a, b) => b.value - a.value);
    return toDistribution(rows, 5);
  }

  private static async getDoctorWiseRevenue(
    clinicId: string,
    primary: DateRange,
    query: ReportsRevenueQueryDto
  ) {
    const perDoctor = await MoneyReadService.byDoctor(
      moneyRange(clinicId, primary, query)
    );
    const ids = Object.keys(perDoctor).filter((id) => perDoctor[id] > 0);
    const names = ids.length
      ? await database
          .select({ id: UserModel.id, name: UserModel.name })
          .from(UserModel)
          .where(
            sql`${UserModel.id} IN (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `
            )})`
          )
      : [];
    const rows = ids
      .map((id) => ({
        doctorId: id,
        doctor: names.find((x) => x.id === id)?.name ?? 'Unassigned',
        value: perDoctor[id] / 100,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
    const total = rows.reduce((sum, r) => sum + r.value, 0);
    return rows.map((r) => ({
      doctor: r.doctor,
      doctorId: r.doctorId,
      revenue: Math.round(r.value),
      percentage: toPercentage(r.value, total),
    }));
  }

  private static async getAppointmentTypeRevenue(
    clinicId: string,
    primary: DateRange,
    query: ReportsRevenueQueryDto
  ) {
    const rows = (await this.grouped(clinicId, primary, query, 'type'))
      .filter((r) => r.value > 0)
      .slice(0, 5);
    const total = rows.reduce((sum, r) => sum + r.value, 0);
    return rows.map((r) => ({
      appointmentType: r.label,
      revenue: Math.round(r.value),
      percentage: toPercentage(r.value, total),
    }));
  }

  /** Dues for visits in the range, aged from the visit day to today (IST). Every bucket, zeros
   *  included; the total equals the Outstanding Dues card. */
  private static async getOutstandingAging(
    clinicId: string,
    primary: DateRange,
    query: ReportsRevenueQueryDto
  ) {
    const age = sql`(${getISTDateString()}::date - ${AppointmentModel.appointmentDate}::date)`;
    const rows: any[] = await database.execute(sql`
      SELECT CASE WHEN ${age} <= 30 THEN 0 WHEN ${age} <= 60 THEN 1 WHEN ${age} <= 90 THEN 2 ELSE 3 END as bucket,
        COALESCE(SUM(${DUES}), 0) as value
      ${paymentsIn(clinicId, primary, query)}
        AND ${UNPAID_PAYMENT} AND NOT ${NOT_ATTENDED}
      GROUP BY 1
    `);
    const labels = [
      'Up to 30 days',
      '31–60 days',
      '61–90 days',
      'Over 90 days',
    ];
    const amounts = labels.map((_, i) =>
      Number(rows.find((r) => Number(r.bucket) === i)?.value || 0)
    );
    const total = amounts.reduce((sum, a) => sum + a, 0);
    return labels.map((bracket, i) => ({
      bracket,
      amount: Math.round(amounts[i]),
      percentage: toPercentage(amounts[i], total),
    }));
  }

  /** The clinic's real payment modes, for the filter dropdown. */
  private static async getPaymentModeOptions(clinicId: string) {
    const rows: any[] = await database.execute(sql`
      SELECT DISTINCT payment_mode as mode
      FROM money_entries
      WHERE clinic_id = ${clinicId} AND account = 'clinic' AND payment_mode IS NOT NULL
      ORDER BY 1
    `);
    return rows.map((r) => ({
      label: String(r.mode).replace(/^\w/, (ch) => ch.toUpperCase()),
      value: r.mode,
    }));
  }

  // ─── INSIGHTS (each carries its numbers) ─────────────────────────────────────

  private static async getInsights(
    clinicId: string,
    primary: DateRange,
    query: ReportsRevenueQueryDto
  ) {
    const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
    const insights: string[] = [];

    const range = moneyRange(clinicId, primary, query);
    const [days, money, byService] = await Promise.all([
      MoneyReadService.byDay(range),
      MoneyReadService.totals(range),
      this.getServiceRevenue(clinicId, primary, query),
    ]);
    // Group the days by weekday, keeping the first day and how many distinct days each covers.
    const weekdays = new Map<
      number,
      {
        day_name: string;
        first_day: string;
        days: number;
        value: number;
        paid: number;
      }
    >();
    for (const [day, paise] of Object.entries(days).sort()) {
      const d = calendarDay(day);
      const w = weekdays.get(d.getDay()) ?? {
        day_name: d.toLocaleDateString('en-US', { weekday: 'long' }),
        first_day: day,
        days: 0,
        value: 0,
        paid: 0,
      };
      w.days++;
      w.value += paise / 100;
      weekdays.set(d.getDay(), w);
    }
    const byWeekday = [...weekdays.values()].sort((a, b) => b.value - a.value);
    if (byWeekday[0]) byWeekday[0].paid = money.payments;

    const total = byWeekday.reduce((sum, r) => sum + Number(r.value), 0);
    const paid = byWeekday.reduce((sum, r) => sum + r.paid, 0);
    const [top] = byWeekday;
    if (
      top &&
      total > 0 &&
      paid >= MIN_INSIGHT_SAMPLE &&
      Number(top.value) > 0
    ) {
      const when =
        top.days > 1
          ? `${top.day_name}s`
          : calendarDay(top.first_day).toLocaleDateString('en-IN', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            });
      insights.push(
        `Most revenue came on ${when}: ${inr(Number(top.value))} of ${inr(total)} (${toPercentage(Number(top.value), total)}%).`
      );
    }
    const [lead] = byService;
    if (lead && byService.length > 1) {
      insights.push(
        `${lead.label} brought in ${lead.percentage}% of revenue (${inr(lead.value)}).`
      );
    } else if (lead) {
      insights.push(`All revenue in this period came from ${lead.label}.`);
    }
    return insights;
  }
}
