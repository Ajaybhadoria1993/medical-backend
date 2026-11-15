/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { ReportCardModel } from '../../reports/models/reports.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { ClinicServiceModel } from '../../clinic/models/clinic.model';
import { DoctorReviewsModel } from '../../doctor/models/doctorReview.model';
import {
  ReportsOverviewQueryDto,
  ReportsOverviewTrendQueryDto,
} from '../schemas/reportsOverview.schemas';
import logger from '../../../utils/logger';
import {
  asOfEnd,
  buildComparisonRange,
  firstVisitJoin,
  previousPeriod,
  wholeRangeValues,
} from '../utils/reportsPeriod.utils';
import {
  calendarDay,
  generateDateSlots,
  knownTimeOfDay,
  mapDataToSlots,
  padSlots,
  resolveTruncUnit,
  scopeFilter,
  serviceJoin,
  slotMeta,
  spanLabel,
} from '../utils/reportsTrend.utils';

import { ReportsMedicinesService } from './reportsMedicines.service';
import { MoneyReadService } from '../../money';
import { istDayBoundsUtc } from '../../../utils/istDateTime';
import {
  bucketRowsByHour,
  formatHour12,
} from '../../../utils/appointmentHours.utils';

/** The money ledger's range for these filters, as on the Revenue tab and Finance: appointments
 *  and treatment plans, by the IST day the money was received. A Service filter keeps
 *  appointments only (plan money has no clinic service). */
function moneyRange(
  clinicId: string,
  range: DateRange,
  query: ReportsOverviewQueryDto
) {
  return {
    clinicId,
    start: istDayBoundsUtc(range.start.slice(0, 10)).start.toISOString(),
    end: istDayBoundsUtc(range.end.slice(0, 10)).end.toISOString(),
    doctorIds: query.doctorId ? [query.doctorId] : undefined,
    serviceName: query.department || undefined,
  };
}
const netRupees = async (
  clinicId: string,
  range: DateRange,
  query: ReportsOverviewQueryDto
) =>
  (await MoneyReadService.totals(moneyRange(clinicId, range, query))).netPaise /
  100;

const CACHE_TTL_OVERVIEW = 120; // 2 min
const CACHE_TTL_TREND = 120; // 2 min
/** Fewer appointments than this and a "pattern" is noise, so the alert stays hidden. */
const MIN_ALERT_SAMPLE = 5;

interface DateRange {
  start: string; // ISO string for SQL compatibility
  end: string;
}

function calcChange(
  current: number,
  previous: number
): { change: number; changeType: string } {
  if (previous === 0) {
    return {
      change: 0,
      // Nothing to compare against: "new" rather than a misleading 100% rise.
      changeType: current > 0 ? 'new' : 'neutral',
    };
  }
  const change = parseFloat(
    (((current - previous) / previous) * 100).toFixed(1)
  );
  return {
    change: Math.abs(change),
    changeType: change > 0 ? 'increase' : change < 0 ? 'decrease' : 'neutral',
  };
}

function buildCacheKey(
  clinicId: string,
  query: ReportsOverviewQueryDto
): string {
  return [
    'reports:overview',
    clinicId,
    query.startDate,
    query.endDate,
    query.compareStartDate || 'auto',
    query.compareEndDate || 'auto',
    query.department || 'all',
    query.doctorId || 'all',
  ].join(':');
}

function buildTrendCacheKey(
  clinicId: string,
  query: ReportsOverviewTrendQueryDto
): string {
  return [
    'reports:trend',
    clinicId,
    query.type,
    query.period,
    query.startDate,
    query.endDate,
    query.compareStartDate || 'auto',
    query.compareEndDate || 'auto',
    query.department || 'all',
    query.doctorId || 'all',
  ].join(':');
}

export class ReportsOverviewService {
  /** The previous period every report compares a range with, for the filter bar's label. */
  static comparisonRange(query: { startDate: string; endDate: string }) {
    const { startDate, endDate } = previousPeriod(
      query.startDate,
      query.endDate
    );
    return { startDate, endDate };
  }

  /**
   * Main overview endpoint — returns all 12 data sections in one call.
   */
  static async getOverview(clinicId: string, query: ReportsOverviewQueryDto) {
    const cacheKey = buildCacheKey(clinicId, query);

    // Check cache first
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn(
        '[ReportsOverview] Redis read error, proceeding without cache',
        err
      );
    }

    const ranges = buildComparisonRange(query);
    const { primary, elapsed, comparison } = ranges;

    // Run all queries in parallel for performance
    const [
      metrics,
      appointmentsTrend,
      patientDistribution,
      topDepartments,
      revenueOverview,
      paymentModeDistribution,
      medicineSales,
      prescriptionsTrend,
      noShowAnalysis,
      patientDemographics,
      monthlyComparison,
      alerts,
    ] = await Promise.all([
      wholeRangeValues(ranges, (current) =>
        this.getMetrics(clinicId, current, comparison, query)
      ),
      this.getTrendData(
        clinicId,
        primary,
        comparison,
        query,
        'appointments',
        'auto'
      ),
      this.getPatientDistribution(clinicId, primary, query),
      this.getTopDepartments(clinicId, primary, query),
      wholeRangeValues(ranges, (current) =>
        this.getRevenueOverview(clinicId, current, comparison, query)
      ),
      this.getPaymentModeDistribution(clinicId, primary, query),
      this.getMedicineSales(clinicId, primary, query),
      this.getTrendData(
        clinicId,
        primary,
        comparison,
        query,
        'prescriptions',
        'auto'
      ),
      wholeRangeValues(ranges, (current) =>
        this.getNoShowAnalysis(clinicId, current, comparison, query)
      ),
      this.getPatientDemographics(clinicId, primary, query),
      this.getPeriodComparison(clinicId, ranges, query),
      // Alerts are dated "as of" the range end, so they stop at today.
      this.getAlerts(clinicId, elapsed, query),
    ]);

    const result = {
      metrics,
      appointmentsTrend,
      patientDistribution,
      topDepartments,
      revenueOverview,
      paymentModeDistribution,
      medicineSales,
      prescriptionsTrend,
      noShowAnalysis,
      patientDemographics,
      monthlyComparison: monthlyComparison.rows,
      monthlyComparisonRange: monthlyComparison.range,
      alerts,
    };

    // Store in cache
    try {
      await redisClient.setex(
        cacheKey,
        CACHE_TTL_OVERVIEW,
        JSON.stringify(result)
      );
    } catch (err) {
      logger.warn('[ReportsOverview] Redis write error', err);
    }

    return result;
  }

  /**
   * Trend sub-endpoint — returns chart data for a specific type/period.
   */
  static async getTrend(clinicId: string, query: ReportsOverviewTrendQueryDto) {
    const cacheKey = buildTrendCacheKey(clinicId, query);

    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[ReportsOverview] Redis read error for trend', err);
    }

    const { primary, comparison } = buildComparisonRange(query);
    const result = await this.getTrendData(
      clinicId,
      primary,
      comparison,
      query,
      query.type,
      query.period
    );

    try {
      await redisClient.setex(
        cacheKey,
        CACHE_TTL_TREND,
        JSON.stringify(result)
      );
    } catch (err) {
      logger.warn('[ReportsOverview] Redis write error for trend', err);
    }

    return result;
  }

  // ─── METRICS ─────────────────────────────────────────────────────────────────

  private static async getMetrics(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsOverviewQueryDto
  ) {
    const baseJoin = serviceJoin(query);
    const scope = scopeFilter(query);

    // Totals count every status, as the dashboard cards do.
    const patientCounts = (range: DateRange) =>
      database.execute(sql`
        SELECT
          COUNT(DISTINCT ${AppointmentModel.patientId}) as total_patients,
          COUNT(${AppointmentModel.id}) as total_appointments,
          COUNT(DISTINCT CASE
            WHEN fv.first_visit >= ${range.start}
            THEN ${AppointmentModel.patientId}
          END) as new_patients
        FROM ${AppointmentModel}
        ${baseJoin}
        ${firstVisitJoin(clinicId, query.doctorId)}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${range.start} AND ${range.end}
          ${scope}
      `) as Promise<any[]>;

    const currentMetrics = await patientCounts(primary);
    const prevMetrics = await patientCounts(comparison);

    const currentPrescriptions: any[] = await database.execute(sql`
      -- One report card per prescription; rows in prescriptions are medicine lines.
      SELECT COUNT(DISTINCT ${ReportCardModel.id}) as total
      FROM ${ReportCardModel}
      INNER JOIN ${AppointmentModel} ON ${ReportCardModel.appointmentId} = ${AppointmentModel.id}
      ${baseJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${ReportCardModel.createdAt} BETWEEN ${primary.start} AND ${primary.end}
        ${scope}
    `);

    const prevPrescriptions: any[] = await database.execute(sql`
      -- One report card per prescription; rows in prescriptions are medicine lines.
      SELECT COUNT(DISTINCT ${ReportCardModel.id}) as total
      FROM ${ReportCardModel}
      INNER JOIN ${AppointmentModel} ON ${ReportCardModel.appointmentId} = ${AppointmentModel.id}
      ${baseJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${ReportCardModel.createdAt} BETWEEN ${comparison.start} AND ${comparison.end}
        ${scope}
    `);

    const [curRev, prevRev] = await Promise.all([
      netRupees(clinicId, primary, query),
      netRupees(clinicId, comparison, query),
    ]);

    // Patients rate in doctor_reviews (one per appointment); `feedbacks` is an unused form.
    // Approved reviews only, dated by when written; clinic and filters come via the appointment.
    const ratingFor = (range: DateRange) =>
      database.execute(sql`
        SELECT COALESCE(AVG(${DoctorReviewsModel.rating}), 0) as avg_rating, COUNT(*) as reviews
        FROM ${DoctorReviewsModel}
        INNER JOIN ${AppointmentModel} ON ${DoctorReviewsModel.appointmentId} = ${AppointmentModel.id}
        ${baseJoin}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${DoctorReviewsModel.status} = 'approved'
          AND ${DoctorReviewsModel.createdAt} BETWEEN ${range.start} AND ${range.end}
          ${scope}
      `) as Promise<any[]>;

    const currentRating = await ratingFor(primary);
    const prevRating = await ratingFor(comparison);

    const cur = currentMetrics[0] || {};
    const prev = prevMetrics[0] || {};
    const curPresc = Number(currentPrescriptions[0]?.total || 0);
    const prevPresc = Number(prevPrescriptions[0]?.total || 0);
    const curRate = parseFloat(currentRating[0]?.avg_rating || '0');
    const prevRate = parseFloat(prevRating[0]?.avg_rating || '0');
    const reviews = Number(currentRating[0]?.reviews || 0);

    return {
      totalPatients: {
        value: Number(cur.total_patients || 0),
        ...calcChange(
          Number(cur.total_patients || 0),
          Number(prev.total_patients || 0)
        ),
      },
      appointments: {
        value: Number(cur.total_appointments || 0),
        ...calcChange(
          Number(cur.total_appointments || 0),
          Number(prev.total_appointments || 0)
        ),
      },
      newPatients: {
        value: Number(cur.new_patients || 0),
        ...calcChange(
          Number(cur.new_patients || 0),
          Number(prev.new_patients || 0)
        ),
      },
      prescriptions: {
        value: curPresc,
        ...calcChange(curPresc, prevPresc),
      },
      revenue: {
        value: Math.round(curRev), // rupees
        ...calcChange(curRev, prevRev),
      },
      avgRating: {
        value: parseFloat(curRate.toFixed(1)),
        maxValue: 5,
        count: reviews,
        // No ratings this period is "no data", not a 100% fall.
        ...(reviews
          ? calcChange(curRate, prevRate)
          : { change: 0, changeType: 'neutral' }),
      },
    };
  }

  // ─── TREND DATA ──────────────────────────────────────────────────────────────

  private static async getTrendData(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsOverviewQueryDto | ReportsOverviewTrendQueryDto,
    type: 'appointments' | 'prescriptions' | 'revenue',
    period: string
  ) {
    const durationDays = Math.ceil(
      (new Date(primary.end).getTime() - new Date(primary.start).getTime()) /
        (1000 * 60 * 60 * 24)
    );

    // The selector label and the bucket size must agree — "Monthly" that
    // silently returns weekly buckets is what made the chart disagree with
    // its own dropdown. 'auto' picks a granularity that keeps the bar count
    // readable for the requested span.
    const truncUnit = resolveTruncUnit(period, durationDays);

    // Generate all slots for both periods
    const primarySlots = generateDateSlots(
      primary.start,
      primary.end,
      truncUnit,
      durationDays
    );
    const comparisonSlots = padSlots(
      primarySlots,
      generateDateSlots(
        comparison.start,
        comparison.end,
        truncUnit,
        durationDays
      )
    );

    const scope = scopeFilter(query);
    const join = serviceJoin(query);

    if (type === 'appointments') {
      const currentData: any[] = await database.execute(sql`
        SELECT
          date_trunc(${sql.raw(`'${truncUnit}'`)}, ${AppointmentModel.appointmentDate}) as dt,
          COUNT(*) as cnt
        FROM ${AppointmentModel}
        ${join}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
          ${scope}
        GROUP BY dt
        ORDER BY dt
      `);

      const prevData: any[] = await database.execute(sql`
        SELECT
          date_trunc(${sql.raw(`'${truncUnit}'`)}, ${AppointmentModel.appointmentDate}) as dt,
          COUNT(*) as cnt
        FROM ${AppointmentModel}
        ${join}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
          ${scope}
        GROUP BY dt
        ORDER BY dt
      `);

      return {
        ...slotMeta(primarySlots, comparisonSlots, primary, comparison),
        currentPeriod: mapDataToSlots(currentData, primarySlots, truncUnit),
        previousPeriod: mapDataToSlots(prevData, comparisonSlots, truncUnit),
      };
    }

    if (type === 'revenue') {
      // Same ledger rule as the Revenue card and Revenue Overview (plans included, by day received), so the lines match the totals.
      const ledgerRows = async (range: DateRange) => {
        const byDt = new Map<string, number>();
        for (const x of await MoneyReadService.buckets(
          moneyRange(clinicId, range, query),
          truncUnit,
          'net'
        ))
          byDt.set(String(x.dt), (byDt.get(String(x.dt)) ?? 0) + x.paise);
        return [...byDt].map(([dt, paise]) => ({ dt, cnt: paise / 100 }));
      };
      const [currentData, prevData] = await Promise.all([
        ledgerRows(primary),
        ledgerRows(comparison),
      ]);

      return {
        ...slotMeta(primarySlots, comparisonSlots, primary, comparison),
        currentPeriod: mapDataToSlots(currentData, primarySlots, truncUnit),
        previousPeriod: mapDataToSlots(prevData, comparisonSlots, truncUnit),
      };
    }

    // Prescriptions trend
    const currentData: any[] = await database.execute(sql`
      SELECT
        date_trunc(${sql.raw(`'${truncUnit}'`)}, ${ReportCardModel.createdAt}) as dt,
        COUNT(DISTINCT ${ReportCardModel.id}) as cnt
      FROM ${ReportCardModel}
      INNER JOIN ${AppointmentModel} ON ${ReportCardModel.appointmentId} = ${AppointmentModel.id}
      ${join}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${ReportCardModel.createdAt} BETWEEN ${primary.start} AND ${primary.end}
        ${scope}
      GROUP BY dt
      ORDER BY dt
    `);

    const prevData: any[] = await database.execute(sql`
      SELECT
        date_trunc(${sql.raw(`'${truncUnit}'`)}, ${ReportCardModel.createdAt}) as dt,
        COUNT(DISTINCT ${ReportCardModel.id}) as cnt
      FROM ${ReportCardModel}
      INNER JOIN ${AppointmentModel} ON ${ReportCardModel.appointmentId} = ${AppointmentModel.id}
      ${join}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${ReportCardModel.createdAt} BETWEEN ${comparison.start} AND ${comparison.end}
        ${scope}
      GROUP BY dt
      Order BY dt
    `);

    return {
      ...slotMeta(primarySlots, comparisonSlots, primary, comparison),
      currentPeriod: mapDataToSlots(currentData, primarySlots, truncUnit),
      previousPeriod: mapDataToSlots(prevData, comparisonSlots, truncUnit),
    };
  }

  // ─── PATIENT DISTRIBUTION ────────────────────────────────────────────────────

  private static async getPatientDistribution(
    clinicId: string,
    primary: DateRange,
    query: ReportsOverviewQueryDto
  ) {
    const scope = scopeFilter(query);
    const join = serviceJoin(query);

    // Inactive = no visit in 90 days as of the range end (Patients tab rule), and none in the range.
    const asOf = new Date(`${asOfEnd(primary).slice(0, 10)}T00:00:00Z`);
    asOf.setUTCDate(asOf.getUTCDate() - 90);
    const cutoff = `${asOf.toISOString().slice(0, 10)} 00:00:00`;
    const inactiveBefore = cutoff < primary.start ? cutoff : primary.start;

    const result: any[] = await database.execute(sql`
      WITH seen AS (
        SELECT DISTINCT ${AppointmentModel.patientId} AS pid, fv.first_visit
        FROM ${AppointmentModel}
        ${join}
        ${firstVisitJoin(clinicId, query.doctorId)}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
          ${scope}
      ),
      inactive AS (
        SELECT COUNT(*) as cnt
        FROM (
          SELECT ${AppointmentModel.patientId}
          FROM ${AppointmentModel}
          WHERE ${AppointmentModel.clinicId} = ${clinicId}
            ${query.doctorId ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}` : sql``}
          GROUP BY ${AppointmentModel.patientId}
          HAVING MAX(${AppointmentModel.appointmentDate}) < ${inactiveBefore}
        ) p
      )
      SELECT
        (SELECT COUNT(*) FROM seen WHERE first_visit >= ${primary.start}) as new_patients,
        (SELECT COUNT(*) FROM seen WHERE first_visit < ${primary.start}) as returning_patients,
        (SELECT cnt FROM inactive) as inactive_patients
    `);

    const row = result[0] || {};
    const newP = Number(row.new_patients || 0);
    const retP = Number(row.returning_patients || 0);
    const inactP = Number(row.inactive_patients || 0);
    const total = newP + retP + inactP || 1;

    return [
      {
        label: 'New Patients',
        value: newP,
        percentage: parseFloat(((newP / total) * 100).toFixed(1)),
      },
      {
        label: 'Returning Patients',
        value: retP,
        percentage: parseFloat(((retP / total) * 100).toFixed(1)),
      },
      {
        label: 'Inactive Patients',
        value: inactP,
        percentage: parseFloat(((inactP / total) * 100).toFixed(1)),
      },
    ];
  }

  // ─── TOP DEPARTMENTS ─────────────────────────────────────────────────────────

  private static async getTopDepartments(
    clinicId: string,
    primary: DateRange,
    query: ReportsOverviewQueryDto
  ) {
    // clinic_services is already joined, so only the filter is added.
    const scope = scopeFilter(query);

    // Revenue is the shared received-money rule (as on the dashboard), so a paid
    // visit later cancelled still counts; the appointment count stays visits that went ahead.
    const result: any[] = await database.execute(sql`
      SELECT
        ${ClinicServiceModel.serviceName} as department,
        COUNT(DISTINCT ${AppointmentModel.id}) FILTER (
          WHERE ${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow')
        ) as appointments
      FROM ${AppointmentModel}
      INNER JOIN ${ClinicServiceModel} ON ${AppointmentModel.clinicServiceId} = ${ClinicServiceModel.id}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${scope}
      GROUP BY ${ClinicServiceModel.serviceName}
      ORDER BY appointments DESC
      LIMIT 5
    `);

    // Money received per service from the ledger (desk + online), as on the Revenue tab.
    const byService = new Map<string, number>();
    for (const x of await MoneyReadService.receivedGrouped(
      moneyRange(clinicId, primary, query),
      'service'
    ))
      byService.set(x.key, (byService.get(x.key) ?? 0) + x.paise);

    const rows = result.map((r) => ({
      department: r.department as string,
      appointments: Number(r.appointments),
      revenue: Math.round((byService.get(r.department) ?? 0) / 100), // rupees
    }));
    // Money with no visit in the period (e.g. treatment plan payments) still gets a row, so the table adds up to Revenue.
    const shown = new Set(rows.map((r) => r.department));
    const moneyOnly = [...byService]
      .filter(
        ([key, paise]) => !shown.has(key) && Math.round(paise / 100) !== 0
      )
      .sort((a, b) => b[1] - a[1])
      .map(([key, paise]) => ({
        department: key,
        appointments: 0,
        revenue: Math.round(paise / 100),
      }));
    return [...rows, ...moneyOnly];
  }

  // ─── REVENUE OVERVIEW ────────────────────────────────────────────────────────

  private static async getRevenueOverview(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsOverviewQueryDto
  ) {
    // The headline total and the bars must describe the SAME window, or the
    // card contradicts itself (it previously paired a filter-range total with
    // a fixed trailing-6-month chart). Both are now derived from the selected
    // range, bucketed at a granularity that scales with its length.
    const durationDays = Math.ceil(
      (new Date(primary.end).getTime() - new Date(primary.start).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    const truncUnit = resolveTruncUnit('auto', durationDays);
    const slots = generateDateSlots(
      primary.start,
      primary.end,
      truncUnit,
      durationDays
    );

    // One row per bucket (desk and online summed), the shape mapDataToSlots expects.
    const byDt = new Map<string, number>();
    for (const x of await MoneyReadService.buckets(
      moneyRange(clinicId, primary, query),
      truncUnit,
      'net'
    ))
      byDt.set(String(x.dt), (byDt.get(String(x.dt)) ?? 0) + x.paise);
    const bucketRows = [...byDt].map(([dt, paise]) => ({
      dt,
      cnt: paise / 100,
    }));

    const values = mapDataToSlots(bucketRows, slots, truncUnit).map((v) =>
      Math.round(v)
    );
    const chartData = slots.map((s, i) => ({
      label: s.label,
      value: values[i] ?? 0,
      detail: s.detail, // real dates for the tooltip
    }));

    // Summing the rendered series (rather than issuing a separate total query)
    // makes the headline provably equal to the bars above it.
    const curRev = values.reduce((a, b) => a + b, 0);

    const prevRev = await netRupees(clinicId, comparison, query);
    const { change, changeType } = calcChange(curRev, prevRev);

    return {
      totalRevenue: Math.round(curRev), // rupees
      change,
      changeType,
      comparisonLabel: 'vs previous period',
      chartData,
    };
  }

  // ─── PAYMENT MODE DISTRIBUTION ───────────────────────────────────────────────

  private static async getPaymentModeDistribution(
    clinicId: string,
    primary: DateRange,
    query: ReportsOverviewQueryDto
  ) {
    const byMode = new Map<string, number>();
    for (const x of await MoneyReadService.byDayAndMode(
      moneyRange(clinicId, primary, query)
    )) {
      const mode = !x.mode || x.mode === 'Unknown' ? 'Not Recorded' : x.mode;
      byMode.set(mode, (byMode.get(mode) ?? 0) + x.netPaise / 100);
    }
    const result = [...byMode]
      .filter(([, v]) => v !== 0)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

    const total = result.reduce((sum, r) => sum + Number(r.value), 0) || 1;

    return result.map((r) => ({
      label: r.label,
      value: Math.round(Number(r.value)), // rupees
      percentage: parseFloat(((Number(r.value) / total) * 100).toFixed(1)),
    }));
  }

  // ─── MEDICINE SALES ──────────────────────────────────────────────────────────

  private static async getMedicineSales(
    clinicId: string,
    primary: DateRange,

    query: ReportsOverviewQueryDto
  ) {
    // Same pharmacy sales (net of returns) as the Medicines tab; sales carry no doctor or service.
    const rows = await ReportsMedicinesService.getTopSellingMedicines(
      clinicId,
      primary,
      { startDate: query.startDate, endDate: query.endDate }
    );
    return rows.map((r) => ({
      medicine: r.medicineName,
      units: r.unitsSold,
      revenue: r.salesAmount, // rupees
    }));
  }

  // ─── NO SHOW ANALYSIS ────────────────────────────────────────────────────────

  private static async getNoShowAnalysis(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsOverviewQueryDto
  ) {
    const scope = scopeFilter(query);
    const join = serviceJoin(query);

    const result: any[] = await database.execute(sql`
      SELECT
        ${AppointmentModel.appointmentStatus} as status,
        COUNT(*) as cnt
      FROM ${AppointmentModel}
      ${join}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${scope}
      GROUP BY ${AppointmentModel.appointmentStatus}
    `);

    const prevNoShow: any[] = await database.execute(sql`
      SELECT COUNT(*) as cnt
      FROM ${AppointmentModel}
      ${join}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        AND ${AppointmentModel.appointmentStatus} = 'NoShow'
        ${scope}
    `);

    const statusMap: Record<string, number> = {};
    let totalAppointments = 0;
    result.forEach((r) => {
      statusMap[r.status] = Number(r.cnt);
      totalAppointments += Number(r.cnt);
    });

    const noShowCount = statusMap['NoShow'] || statusMap['Missed'] || 0;
    const completedCount = statusMap['Completed'] || 0;
    const cancelledCount = statusMap['Cancelled'] || 0;
    const rescheduledCount = statusMap['Rescheduled'] || 0;
    const pendingCount = statusMap['Pending'] || statusMap['Upcoming'] || 0;
    const prevNoShowCount = Number(prevNoShow[0]?.cnt || 0);
    const total = totalAppointments || 1;

    return {
      total: noShowCount,
      ...calcChange(noShowCount, prevNoShowCount),
      breakdown: [
        {
          label: 'No Show',
          value: noShowCount,
          percentage: parseFloat(((noShowCount / total) * 100).toFixed(1)),
        },
        {
          label: 'Completed',
          value: completedCount,
          percentage: parseFloat(((completedCount / total) * 100).toFixed(1)),
        },
        {
          label: 'Cancelled',
          value: cancelledCount,
          percentage: parseFloat(((cancelledCount / total) * 100).toFixed(1)),
        },
        {
          label: 'Rescheduled',
          value: rescheduledCount,
          percentage: parseFloat(((rescheduledCount / total) * 100).toFixed(1)),
        },
        {
          label: 'Pending',
          value: pendingCount,
          percentage: parseFloat(((pendingCount / total) * 100).toFixed(1)),
        },
      ],
    };
  }

  // ─── PATIENT DEMOGRAPHICS ────────────────────────────────────────────────────

  private static async getPatientDemographics(
    clinicId: string,
    primary: DateRange,
    query: ReportsOverviewQueryDto
  ) {
    const scope = scopeFilter(query);
    const join = serviceJoin(query);

    const result: any[] = await database.execute(sql`
      SELECT
        CASE
          WHEN ${UserProfileModel.age} IS NULL THEN 'Unknown'
          WHEN ${UserProfileModel.age} BETWEEN 0 AND 18 THEN '0 - 18'
          WHEN ${UserProfileModel.age} BETWEEN 19 AND 30 THEN '19 - 30'
          WHEN ${UserProfileModel.age} BETWEEN 31 AND 45 THEN '31 - 45'
          WHEN ${UserProfileModel.age} BETWEEN 46 AND 60 THEN '46 - 60'
          ELSE '60+'
        END as age_group,
        CASE
          WHEN ${UserProfileModel.age} IS NULL THEN 6
          WHEN ${UserProfileModel.age} BETWEEN 0 AND 18 THEN 1
          WHEN ${UserProfileModel.age} BETWEEN 19 AND 30 THEN 2
          WHEN ${UserProfileModel.age} BETWEEN 31 AND 45 THEN 3
          WHEN ${UserProfileModel.age} BETWEEN 46 AND 60 THEN 4
          ELSE 5
        END as sort_order,
        COUNT(DISTINCT ${AppointmentModel.patientId}) as patients
      FROM ${AppointmentModel}
      ${join}
      INNER JOIN ${UserProfileModel} ON ${UserProfileModel.userId} = ${AppointmentModel.patientId}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${scope}
      GROUP BY age_group, sort_order
      ORDER BY sort_order
    `);

    const total = result.reduce((sum, r) => sum + Number(r.patients), 0) || 1;

    return result
      .filter((r) => r.age_group !== 'Unknown')
      .map((r) => ({
        ageGroup: r.age_group,
        patients: Number(r.patients),
        percentage: parseFloat(((Number(r.patients) / total) * 100).toFixed(1)),
      }));
  }

  // ─── PERIOD COMPARISON ───────────────────────────────────────────────────────

  /** The selected period vs the previous period the cards use: same values, same %. When the range
   *  runs past today, the % counts only the days so far (the dashboard rule). */
  private static async getPeriodComparison(
    clinicId: string,
    ranges: ReturnType<typeof buildComparisonRange>,
    query: ReportsOverviewQueryDto
  ) {
    const { primary, elapsed, comparison } = ranges;
    const rows = await wholeRangeValues(ranges, (current) =>
      this.getMonthlyComparison(clinicId, current, comparison, query)
    );
    const span = (r: DateRange) =>
      spanLabel(calendarDay(r.start), calendarDay(r.end));
    return {
      rows,
      range: {
        current: span(primary),
        previous: span(comparison),
        // Set when the % uses only the elapsed days, e.g. "1–7 Oct 2026".
        elapsed: elapsed.end !== primary.end ? span(elapsed) : undefined,
      },
    };
  }

  private static async getMonthlyComparison(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsOverviewQueryDto
  ) {
    const scope = scopeFilter(query);
    const join = serviceJoin(query);

    const curStats: any[] = await database.execute(sql`
      SELECT
        COUNT(DISTINCT ${AppointmentModel.patientId}) as patients,
        COUNT(${AppointmentModel.id}) as appointments
      FROM ${AppointmentModel}
      ${join}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${scope}
    `);

    const prevStats: any[] = await database.execute(sql`
      SELECT
        COUNT(DISTINCT ${AppointmentModel.patientId}) as patients,
        COUNT(${AppointmentModel.id}) as appointments
      FROM ${AppointmentModel}
      ${join}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        ${scope}
    `);

    const curPrescriptions: any[] = await database.execute(sql`
      SELECT COUNT(DISTINCT ${ReportCardModel.id}) as total
      FROM ${ReportCardModel}
      INNER JOIN ${AppointmentModel} ON ${ReportCardModel.appointmentId} = ${AppointmentModel.id}
      ${join}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${ReportCardModel.createdAt} BETWEEN ${primary.start} AND ${primary.end}
        ${scope}
    `);

    const prevPrescriptions: any[] = await database.execute(sql`
      SELECT COUNT(DISTINCT ${ReportCardModel.id}) as total
      FROM ${ReportCardModel}
      INNER JOIN ${AppointmentModel} ON ${ReportCardModel.appointmentId} = ${AppointmentModel.id}
      ${join}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${ReportCardModel.createdAt} BETWEEN ${comparison.start} AND ${comparison.end}
        ${scope}
    `);

    // Same ledger total as the Revenue card, so this row never disagrees with it.
    const [curR, prevR] = await Promise.all([
      netRupees(clinicId, primary, query),
      netRupees(clinicId, comparison, query),
    ]);

    const cur = curStats[0] || {};
    const prev = prevStats[0] || {};
    const curP = Number(curPrescriptions[0]?.total || 0);
    const prevP = Number(prevPrescriptions[0]?.total || 0);

    // calcChange returns an unsigned magnitude — the direction only survives in
    // changeType, so it has to travel with every row or the UI cannot tell a
    // rise from a fall.
    const row = (metric: string, current: number, previous: number) => ({
      metric,
      thisMonth: Math.round(current),
      lastMonth: Math.round(previous),
      ...calcChange(current, previous),
    });

    return [
      row(
        'Unique Patients',
        Number(cur.patients || 0),
        Number(prev.patients || 0)
      ),
      row(
        'Appointments',
        Number(cur.appointments || 0),
        Number(prev.appointments || 0)
      ),
      row('Prescriptions', curP, prevP),
      row('Revenue', curR, prevR),
    ];
  }

  // ─── ALERTS (Anomaly Detection) ──────────────────────────────────────────────

  private static async getAlerts(
    clinicId: string,
    primary: DateRange,
    query: ReportsOverviewQueryDto
  ) {
    // `detail` carries the numbers behind each alert, so none is a bare claim.
    const alerts: {
      type: string;
      title: string;
      detail: string;
      date: string;
    }[] = [];
    const today = primary.end.split(' ')[0];
    const scope = scopeFilter(query);
    const join = serviceJoin(query);
    const pct = (n: number, of: number) => Math.round((n / of) * 100);
    const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

    try {
      // Busiest hour works per appointment, so token, slot and mixed days all count: the IST
      // check-in time (arrived_at is UTC), else the booked slot; a token not yet checked in has neither.
      const timeRows: any[] = await database.execute(sql`
        SELECT ${knownTimeOfDay} as time, COUNT(*) as cnt
        FROM ${AppointmentModel}
        ${join}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
          ${scope}
          AND ${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow', 'Missed')
        GROUP BY 1
      `);
      const hours = bucketRowsByHour(timeRows);
      const timedTotal = hours.reduce((sum, h) => sum + h.cnt, 0);

      if (timedTotal >= MIN_ALERT_SAMPLE) {
        // Two busiest hours by volume, listed in clock order (not a time span).
        const top = hours.slice(0, 2);
        const labels = top
          .map((h) => h.hour)
          .sort((a, b) => a - b)
          .map(formatHour12);
        const inTop = top.reduce((sum, h) => sum + h.cnt, 0);
        alerts.push({
          type: 'warning',
          title:
            labels.length > 1
              ? `Busiest hours are ${labels[0]} and ${labels[1]}`
              : `Busiest hour is ${labels[0]}`,
          detail: `${inTop} of ${timedTotal} appointments with a check-in or slot time (${pct(inTop, timedTotal)}%)`,
          date: today,
        });
      }

      // Top-earning service, with its share of the money collected.
      // From the ledger, so treatment plans count and the total matches the Revenue card.
      const byService = new Map<string, number>();
      for (const x of await MoneyReadService.receivedGrouped(
        moneyRange(clinicId, primary, query),
        'service'
      ))
        byService.set(x.key, (byService.get(x.key) ?? 0) + x.paise / 100);
      const earning = [...byService]
        .filter(([, rupees]) => rupees > 0)
        .sort((a, b) => b[1] - a[1]);
      const total = earning.reduce((sum, [, rupees]) => sum + rupees, 0);

      if (earning.length > 0) {
        const [dept, revenue] = earning[0];
        alerts.push({
          type: 'info',
          title:
            earning.length > 1
              ? `${dept} earned the most in this period`
              : `All revenue in this period came from ${dept}`,
          detail: `${inr(revenue)} of ${inr(total)} collected (${pct(revenue, total)}%)`,
          date: today,
        });
      }

      // No-show RATE per weekday (no-shows ÷ appointments that day, cancellations excluded),
      // reported only with enough data and when it beats the period average.
      const byWeekday: any[] = await database.execute(sql`
        SELECT
          EXTRACT(ISODOW FROM ${AppointmentModel.appointmentDate})::int as dow,
          TO_CHAR(MIN(${AppointmentModel.appointmentDate}), 'FMDay') as day_name,
          MIN(${AppointmentModel.appointmentDate})::date::text as first_day,
          COUNT(DISTINCT ${AppointmentModel.appointmentDate}::date)::int as days,
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE ${AppointmentModel.appointmentStatus} IN ('NoShow', 'Missed'))::int as no_shows
        FROM ${AppointmentModel}
        ${join}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
          ${scope}
          AND ${AppointmentModel.appointmentStatus} <> 'Cancelled'
        GROUP BY dow
      `);
      const allTotal = byWeekday.reduce((sum, r) => sum + r.total, 0);
      const allNoShows = byWeekday.reduce((sum, r) => sum + r.no_shows, 0);
      const worst = byWeekday
        .filter((r) => r.total >= MIN_ALERT_SAMPLE && r.no_shows >= 2)
        .sort((a, b) => b.no_shows / b.total - a.no_shows / a.total)[0];

      if (
        worst &&
        allTotal > 0 &&
        worst.no_shows / worst.total > allNoShows / allTotal
      ) {
        const [yy, mm, dd] = String(worst.first_day).split('-').map(Number);
        const when =
          worst.days > 1
            ? `${worst.day_name}s`
            : new Date(yy, mm - 1, dd).toLocaleDateString('en-IN', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              });
        alerts.push({
          type: 'info',
          title: `No-show rate is highest on ${when}`,
          detail: `${worst.no_shows} of ${worst.total} appointments (${pct(worst.no_shows, worst.total)}%) · period average ${pct(allNoShows, allTotal)}%`,
          date: today,
        });
      }
    } catch (err) {
      logger.warn('[ReportsOverview] Error generating alerts', err);
    }

    return alerts;
  }
}
