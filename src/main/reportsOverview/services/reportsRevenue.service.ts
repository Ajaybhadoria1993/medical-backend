/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql, SQL } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import { ClinicServiceModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import {
  ReportsRevenueQueryDto,
  ReportsRevenueTrendQueryDto,
} from '../schemas/reportsRevenue.schemas';
import {
  DateRange,
  buildComparisonRange,
  calcChange,
  generateSlots,
  mapValuesToSlots,
  padComparisonSlots,
  toPercentage,
} from '../utils/reportsPeriod.utils';
import {
  ReportsRevenueData,
  RevenueMetricItem,
} from '../types/reportsRevenue.types';

const CACHE_TTL = 120;

type AnyRevenueQuery = ReportsRevenueQueryDto | ReportsRevenueTrendQueryDto;

/**
 * `payment_status` is written with inconsistent casing and wording across the
 * booking flows ('Paid', 'paid', 'Already Paid', 'Credit'), so every status
 * comparison here is lower-cased rather than matched literally.
 */
const COLLECTED_STATUS = sql`LOWER(${AppointmentPaymentModel.paymentStatus}) IN ('paid', 'already paid')`;
const PENDING_STATUS = sql`LOWER(${AppointmentPaymentModel.paymentStatus}) IN ('pending', 'credit')`;
const BILLED_STATUS = sql`LOWER(COALESCE(${AppointmentPaymentModel.paymentStatus}, '')) NOT IN ('refunded', 'failed')`;

const PRICE = sql`CAST(COALESCE(${AppointmentPaymentModel.price}, '0') AS NUMERIC)`;
const REFUNDED = sql`CAST(NULLIF(COALESCE(${AppointmentPaymentModel.refundedAmount}, '0'), '') AS NUMERIC)`;

function buildFilters(query: AnyRevenueQuery): {
  doctorFilter: SQL;
  serviceJoin: SQL;
  serviceFilter: SQL;
  paymentModeFilter: SQL;
} {
  return {
    doctorFilter: query.doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}`
      : sql``,
    serviceJoin: query.department
      ? sql`INNER JOIN ${ClinicServiceModel} ON ${AppointmentModel.clinicServiceId} = ${ClinicServiceModel.id}`
      : sql``,
    serviceFilter: query.department
      ? sql`AND ${ClinicServiceModel.serviceName} = ${query.department}`
      : sql``,
    paymentModeFilter: query.paymentMode
      ? sql`AND ${AppointmentPaymentModel.paymentMode} = ${query.paymentMode}`
      : sql``,
  };
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
    query.department || 'all',
    query.doctorId || 'all',
    query.paymentMode || 'all',
  ].join(':');
}

function metric(current: number, previous: number): RevenueMetricItem {
  const { change, changeType } = calcChange(current, previous);
  return { value: Math.round(current), change, changeType };
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
        logger.info('[ReportsRevenue] Cache HIT');
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[ReportsRevenue] Redis read error', err);
    }

    const { primary, comparison } = buildComparisonRange(query);

    const [
      metrics,
      revenueTrend,
      revenueBreakdown,
      paymentModeDistribution,
      doctorWiseRevenue,
      appointmentTypeRevenue,
      outstandingAging,
      monthlyRevenue,
      ytd,
    ] = await Promise.all([
      this.getMetrics(clinicId, primary, comparison, query),
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
      this.getOutstandingAging(clinicId, query),
      this.getMonthlyRevenue(clinicId, query),
      this.getYtdSummary(clinicId, query),
    ]);

    const topServices = revenueBreakdown.map((item) => ({
      service: item.label,
      revenue: item.value,
      percentage: item.percentage,
    }));

    const result: ReportsRevenueData = {
      metrics,
      revenueTrend,
      revenueBreakdown,
      paymentModeDistribution,
      topServices,
      doctorWiseRevenue,
      appointmentTypeRevenue,
      outstandingAging,
      monthlyRevenue,
      ytd,
      insights: await this.getInsights(clinicId, primary, query, topServices),
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
        logger.info('[ReportsRevenue] Trend Cache HIT');
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

  private static async getMetrics(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsRevenueQueryDto
  ) {
    const [current, previous] = await Promise.all([
      this.getTotalsForRange(clinicId, primary, query),
      this.getTotalsForRange(clinicId, comparison, query),
    ]);

    return {
      totalRevenue: metric(current.billed, previous.billed),
      amountCollected: metric(current.collected, previous.collected),
      pendingAmount: metric(current.pending, previous.pending),
      avgInvoiceValue: metric(
        current.invoices ? current.billed / current.invoices : 0,
        previous.invoices ? previous.billed / previous.invoices : 0
      ),
      totalInvoices: metric(current.invoices, previous.invoices),
      refunds: metric(current.refunds, previous.refunds),
    };
  }

  private static async getTotalsForRange(
    clinicId: string,
    range: DateRange,
    query: ReportsRevenueQueryDto
  ) {
    const { doctorFilter, serviceJoin, serviceFilter, paymentModeFilter } =
      buildFilters(query);

    const rows: any[] = await database.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN ${BILLED_STATUS} THEN ${PRICE} ELSE 0 END), 0) as billed,
        COALESCE(SUM(CASE WHEN ${COLLECTED_STATUS} THEN ${PRICE} ELSE 0 END), 0) as collected,
        COALESCE(SUM(CASE WHEN ${PENDING_STATUS} THEN ${PRICE} ELSE 0 END), 0) as pending,
        COALESCE(SUM(${REFUNDED}), 0) as refunds,
        COUNT(*) FILTER (WHERE ${BILLED_STATUS}) as invoices
      FROM ${AppointmentPaymentModel}
      INNER JOIN ${AppointmentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      ${serviceJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${range.start} AND ${range.end}
        ${doctorFilter} ${serviceFilter} ${paymentModeFilter}
    `);

    const row = rows[0] || {};
    return {
      billed: Number(row.billed || 0),
      collected: Number(row.collected || 0),
      pending: Number(row.pending || 0),
      refunds: Number(row.refunds || 0),
      invoices: Number(row.invoices || 0),
    };
  }

  private static async getRevenueTrend(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: AnyRevenueQuery,
    period: string,
    type: 'revenue' | 'collected'
  ) {
    const durationDays = Math.ceil(
      (new Date(primary.end).getTime() - new Date(primary.start).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    const truncUnit =
      period === 'monthly' || (period === 'auto' && durationDays > 30)
        ? 'week'
        : 'day';

    const primarySlots = generateSlots(primary.start, primary.end, period);
    const comparisonSlots = padComparisonSlots(
      primarySlots,
      generateSlots(comparison.start, comparison.end, period)
    );

    const statusFilter =
      type === 'collected' ? COLLECTED_STATUS : BILLED_STATUS;
    const { doctorFilter, serviceJoin, serviceFilter, paymentModeFilter } =
      buildFilters(query);

    const rangeRows = (range: DateRange) =>
      database.execute(sql`
      SELECT
        date_trunc(${sql.raw(`'${truncUnit}'`)}, ${AppointmentModel.appointmentDate}) as dt,
        COALESCE(SUM(${PRICE}), 0) as value
      FROM ${AppointmentPaymentModel}
      INNER JOIN ${AppointmentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      ${serviceJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${range.start} AND ${range.end}
        AND ${statusFilter}
        ${doctorFilter} ${serviceFilter} ${paymentModeFilter}
      GROUP BY dt
      ORDER BY dt
    `);

    const [curRows, prevRows] = (await Promise.all([
      rangeRows(primary),
      rangeRows(comparison),
    ])) as any[][];

    return {
      labels: primarySlots.map((s) => s.label),
      currentPeriod: mapValuesToSlots(curRows, primarySlots, truncUnit),
      previousPeriod: mapValuesToSlots(prevRows, comparisonSlots, truncUnit),
    };
  }

  private static async getServiceRevenue(
    clinicId: string,
    primary: DateRange,
    query: ReportsRevenueQueryDto
  ) {
    const { doctorFilter, serviceFilter, paymentModeFilter } =
      buildFilters(query);

    const rows: any[] = await database.execute(sql`
      SELECT
        COALESCE(${ClinicServiceModel.serviceName}, 'Unassigned') as label,
        COALESCE(SUM(${PRICE}), 0) as value
      FROM ${AppointmentPaymentModel}
      INNER JOIN ${AppointmentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      LEFT JOIN ${ClinicServiceModel} ON ${AppointmentModel.clinicServiceId} = ${ClinicServiceModel.id}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${BILLED_STATUS}
        ${doctorFilter} ${serviceFilter} ${paymentModeFilter}
      GROUP BY label
      ORDER BY value DESC
    `);

    return this.toDistribution(rows, 5);
  }

  private static async getPaymentModeDistribution(
    clinicId: string,
    primary: DateRange,
    query: ReportsRevenueQueryDto
  ) {
    const { doctorFilter, serviceJoin, serviceFilter, paymentModeFilter } =
      buildFilters(query);

    const rows: any[] = await database.execute(sql`
      SELECT
        COALESCE(${AppointmentPaymentModel.paymentMode}, 'Other') as label,
        COALESCE(SUM(${PRICE}), 0) as value
      FROM ${AppointmentPaymentModel}
      INNER JOIN ${AppointmentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      ${serviceJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${COLLECTED_STATUS}
        ${doctorFilter} ${serviceFilter} ${paymentModeFilter}
      GROUP BY label
      ORDER BY value DESC
    `);

    return this.toDistribution(rows, 5);
  }

  private static async getDoctorWiseRevenue(
    clinicId: string,
    primary: DateRange,
    query: ReportsRevenueQueryDto
  ) {
    const { doctorFilter, serviceJoin, serviceFilter, paymentModeFilter } =
      buildFilters(query);

    const rows: any[] = await database.execute(sql`
      SELECT
        ${AppointmentModel.doctorId} as doctor_id,
        COALESCE(${UserModel.name}, 'Unassigned') as doctor,
        COALESCE(SUM(${PRICE}), 0) as value
      FROM ${AppointmentPaymentModel}
      INNER JOIN ${AppointmentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      LEFT JOIN ${UserModel} ON ${AppointmentModel.doctorId} = ${UserModel.id}
      ${serviceJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${BILLED_STATUS}
        ${doctorFilter} ${serviceFilter} ${paymentModeFilter}
      -- Qualified: the service filter joins clinics_service, which also has doctor_id.
      GROUP BY ${AppointmentModel.doctorId}, ${UserModel.name}
      ORDER BY value DESC
      LIMIT 5
    `);

    const total = rows.reduce((sum, r) => sum + Number(r.value), 0);

    return rows.map((r) => ({
      doctor: r.doctor,
      doctorId: r.doctor_id || '',
      revenue: Math.round(Number(r.value)),
      percentage: toPercentage(Number(r.value), total),
    }));
  }

  private static async getAppointmentTypeRevenue(
    clinicId: string,
    primary: DateRange,
    query: ReportsRevenueQueryDto
  ) {
    const { doctorFilter, serviceJoin, serviceFilter, paymentModeFilter } =
      buildFilters(query);

    const rows: any[] = await database.execute(sql`
      SELECT
        COALESCE(${AppointmentModel.appointmentType}, 'Other') as label,
        COALESCE(SUM(${PRICE}), 0) as value
      FROM ${AppointmentPaymentModel}
      INNER JOIN ${AppointmentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      ${serviceJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${BILLED_STATUS}
        ${doctorFilter} ${serviceFilter} ${paymentModeFilter}
      GROUP BY label
      ORDER BY value DESC
      LIMIT 5
    `);

    const total = rows.reduce((sum, r) => sum + Number(r.value), 0);

    return rows.map((r) => ({
      appointmentType: r.label,
      revenue: Math.round(Number(r.value)),
      percentage: toPercentage(Number(r.value), total),
    }));
  }

  /**
   * Aging runs from the appointment date to today, not from the report range,
   * so an outstanding balance keeps ageing after the period it was billed in.
   */
  private static async getOutstandingAging(
    clinicId: string,
    query: ReportsRevenueQueryDto
  ) {
    const { doctorFilter, serviceJoin, serviceFilter } = buildFilters(query);

    const rows: any[] = await database.execute(sql`
      SELECT
        CASE
          WHEN NOW() - ${AppointmentModel.appointmentDate} <= INTERVAL '30 days' THEN '0 - 30 Days'
          WHEN NOW() - ${AppointmentModel.appointmentDate} <= INTERVAL '60 days' THEN '31 - 60 Days'
          WHEN NOW() - ${AppointmentModel.appointmentDate} <= INTERVAL '90 days' THEN '61 - 90 Days'
          ELSE '90+ Days'
        END as bracket,
        COALESCE(SUM(${PRICE}), 0) as value
      FROM ${AppointmentPaymentModel}
      INNER JOIN ${AppointmentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      ${serviceJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} <= NOW()
        AND ${PENDING_STATUS}
        ${doctorFilter} ${serviceFilter}
      GROUP BY bracket
    `);

    const order = ['0 - 30 Days', '31 - 60 Days', '61 - 90 Days', '90+ Days'];
    const byBracket = new Map<string, number>(
      rows.map((r) => [String(r.bracket), Number(r.value)])
    );
    const total = order.reduce((sum, b) => sum + (byBracket.get(b) || 0), 0);

    return order.map((bracket) => {
      const amount = byBracket.get(bracket) || 0;
      return {
        bracket,
        amount: Math.round(amount),
        percentage: toPercentage(amount, total),
      };
    });
  }

  private static async getMonthlyRevenue(
    clinicId: string,
    query: ReportsRevenueQueryDto
  ) {
    const { doctorFilter, serviceJoin, serviceFilter, paymentModeFilter } =
      buildFilters(query);

    const year = new Date(query.endDate).getFullYear();
    const rangeStart = `${year - 1}-01-01 00:00:00`;
    const rangeEnd = `${year}-12-31 23:59:59`;

    const rows: any[] = await database.execute(sql`
      SELECT
        EXTRACT(YEAR FROM ${AppointmentModel.appointmentDate})::int as yr,
        EXTRACT(MONTH FROM ${AppointmentModel.appointmentDate})::int as mo,
        COALESCE(SUM(${PRICE}), 0) as value
      FROM ${AppointmentPaymentModel}
      INNER JOIN ${AppointmentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      ${serviceJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${rangeStart} AND ${rangeEnd}
        AND ${BILLED_STATUS}
        ${doctorFilter} ${serviceFilter} ${paymentModeFilter}
      GROUP BY yr, mo
    `);

    const byKey = new Map<string, number>(
      rows.map((r) => [`${r.yr}-${r.mo}`, Number(r.value)])
    );

    return Array.from({ length: 12 }, (_, index) => {
      const monthNo = index + 1;
      return {
        month: new Date(year, index, 1).toLocaleDateString('en-US', {
          month: 'short',
        }),
        thisYear: Math.round(byKey.get(`${year}-${monthNo}`) || 0),
        lastYear: Math.round(byKey.get(`${year - 1}-${monthNo}`) || 0),
      };
    });
  }

  private static async getYtdSummary(
    clinicId: string,
    query: ReportsRevenueQueryDto
  ) {
    const end = new Date(query.endDate);
    const year = end.getFullYear();

    const thisYear: DateRange = {
      start: `${year}-01-01 00:00:00`,
      end: `${query.endDate} 23:59:59`,
    };
    const lastYear: DateRange = {
      start: `${year - 1}-01-01 00:00:00`,
      end: `${year - 1}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(
        end.getDate()
      ).padStart(2, '0')} 23:59:59`,
    };

    const [current, previous] = await Promise.all([
      this.getTotalsForRange(clinicId, thisYear, query),
      this.getTotalsForRange(clinicId, lastYear, query),
    ]);

    const revenueChange = calcChange(current.billed, previous.billed);
    const collectedChange = calcChange(current.collected, previous.collected);

    return {
      revenue: Math.round(current.billed),
      lastYearRevenue: Math.round(previous.billed),
      change: revenueChange.change,
      changeType: revenueChange.changeType,
      collected: Math.round(current.collected),
      lastYearCollected: Math.round(previous.collected),
      collectedChange: collectedChange.change,
      collectedChangeType: collectedChange.changeType,
      label: `YTD (Jan 1 – ${end.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })})`,
    };
  }

  private static async getInsights(
    clinicId: string,
    primary: DateRange,
    query: ReportsRevenueQueryDto,
    topServices: Array<{ service: string; percentage: number }>
  ): Promise<string[]> {
    const { doctorFilter, serviceJoin, serviceFilter, paymentModeFilter } =
      buildFilters(query);

    const rows: any[] = await database.execute(sql`
      SELECT
        TRIM(TO_CHAR(${AppointmentModel.appointmentDate}, 'Day')) as day,
        COALESCE(SUM(${PRICE}), 0) as value
      FROM ${AppointmentPaymentModel}
      INNER JOIN ${AppointmentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      ${serviceJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${BILLED_STATUS}
        ${doctorFilter} ${serviceFilter} ${paymentModeFilter}
      GROUP BY day
      ORDER BY value DESC
      LIMIT 1
    `);

    const insights: string[] = [];
    if (rows[0]?.day && Number(rows[0].value) > 0) {
      insights.push(`Revenue is highest on ${rows[0].day}s.`);
    }
    if (topServices[0]) {
      insights.push(
        `${topServices[0].service} accounts for ${topServices[0].percentage}% of revenue.`
      );
    }
    return insights;
  }

  private static toDistribution(rows: any[], limit: number) {
    const total = rows.reduce((sum, r) => sum + Number(r.value), 0);
    const top = rows.slice(0, limit).map((r) => ({
      label: String(r.label),
      value: Math.round(Number(r.value)),
      percentage: toPercentage(Number(r.value), total),
    }));

    const restTotal = rows
      .slice(limit)
      .reduce((sum, r) => sum + Number(r.value), 0);

    if (restTotal > 0) {
      top.push({
        label: 'Others',
        value: Math.round(restTotal),
        percentage: toPercentage(restTotal, total),
      });
    }

    return top;
  }
}
