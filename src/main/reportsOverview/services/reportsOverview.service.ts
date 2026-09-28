/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import {
  ReportCardModel,
  PrescriptionModel,
} from '../../reports/models/reports.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { ClinicServiceModel } from '../../clinic/models/clinic.model';
import { FeedbackModel } from '../../feedback/models/feedback.model';
import {
  ReportsOverviewQueryDto,
  ReportsOverviewTrendQueryDto,
} from '../schemas/reportsOverview.schemas';
import logger from '../../../utils/logger';
import {
  bucketRowsByHour,
  formatHour12,
} from '../../../utils/appointmentHours.utils';

// Cache TTL constants (in seconds)
const CACHE_TTL_OVERVIEW = 120; // 2 minutes
const CACHE_TTL_TREND = 120; // 2 minutes

interface DateRange {
  start: string; // ISO string for SQL compatibility
  end: string;
}

/**
 * Build comparison date range. If not provided, auto-calculate
 * based on the primary range duration (shift back by same number of days).
 */
function buildComparisonRange(query: ReportsOverviewQueryDto): {
  primary: DateRange;
  comparison: DateRange;
} {
  const primary: DateRange = {
    start: query.startDate + ' 00:00:00',
    end: query.endDate + ' 23:59:59',
  };

  let comparison: DateRange;
  if (query.compareStartDate && query.compareEndDate) {
    comparison = {
      start: query.compareStartDate + ' 00:00:00',
      end: query.compareEndDate + ' 23:59:59',
    };
  } else {
    const startMs = new Date(query.startDate).getTime();
    const endMs = new Date(query.endDate).getTime();
    const durationMs = endMs - startMs;
    const compEnd = new Date(startMs - 1);
    const compStart = new Date(startMs - durationMs - 86400000); // shift back by same duration
    comparison = {
      start: compStart.toISOString().split('T')[0] + ' 00:00:00',
      end: compEnd.toISOString().split('T')[0] + ' 23:59:59',
    };
  }

  return { primary, comparison };
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
  /**
   * Main overview endpoint — returns all 12 data sections in one call.
   */
  static async getOverview(clinicId: string, query: ReportsOverviewQueryDto) {
    const cacheKey = buildCacheKey(clinicId, query);

    // Check cache first
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        logger.info(`[ReportsOverview] Cache HIT: ${cacheKey}`);
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn(
        '[ReportsOverview] Redis read error, proceeding without cache',
        err
      );
    }

    logger.info(`[ReportsOverview] Cache MISS: ${cacheKey}`);
    const { primary, comparison } = buildComparisonRange(query);

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
      this.getMetrics(clinicId, primary, comparison, query),
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
      this.getRevenueOverview(clinicId, primary, comparison, query),
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
      this.getNoShowAnalysis(clinicId, primary, comparison, query),
      this.getPatientDemographics(clinicId, primary, query),
      this.getMonthlyComparison(clinicId, primary, comparison, query),
      this.getAlerts(clinicId, primary, query),
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
      monthlyComparison,
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
        logger.info(`[ReportsOverview] Trend Cache HIT: ${cacheKey}`);
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
    const baseJoin = query.department
      ? sql`INNER JOIN ${ClinicServiceModel} ON ${AppointmentModel.clinicServiceId} = ${ClinicServiceModel.id}`
      : sql``;
    const doctorFilter = query.doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}`
      : sql``;
    const deptFilter = query.department
      ? sql`AND ${ClinicServiceModel.serviceName} = ${query.department}`
      : sql``;

    const currentMetrics: any[] = await database.execute(sql`
      SELECT
        COUNT(DISTINCT ${AppointmentModel.patientId}) as total_patients,
        COUNT(${AppointmentModel.id}) as total_appointments,
        COUNT(DISTINCT CASE
          WHEN ${AppointmentModel.createdAt} >= ${primary.start}
          THEN ${AppointmentModel.patientId}
        END) as new_patients
      FROM ${AppointmentModel}
      ${baseJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter}
        ${deptFilter}
    `);

    const prevMetrics: any[] = await database.execute(sql`
      SELECT
        COUNT(DISTINCT ${AppointmentModel.patientId}) as total_patients,
        COUNT(${AppointmentModel.id}) as total_appointments,
        COUNT(DISTINCT CASE
          WHEN ${AppointmentModel.createdAt} >= ${comparison.start}
          THEN ${AppointmentModel.patientId}
        END) as new_patients
      FROM ${AppointmentModel}
      ${baseJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        ${doctorFilter}
        ${deptFilter}
    `);

    const currentPrescriptions: any[] = await database.execute(sql`
      -- One report card per prescription; rows in prescriptions are medicine lines.
      SELECT COUNT(DISTINCT ${ReportCardModel.id}) as total
      FROM ${ReportCardModel}
      INNER JOIN ${AppointmentModel} ON ${ReportCardModel.appointmentId} = ${AppointmentModel.id}
      ${baseJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${ReportCardModel.createdAt} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter}
        ${deptFilter}
    `);

    const prevPrescriptions: any[] = await database.execute(sql`
      -- One report card per prescription; rows in prescriptions are medicine lines.
      SELECT COUNT(DISTINCT ${ReportCardModel.id}) as total
      FROM ${ReportCardModel}
      INNER JOIN ${AppointmentModel} ON ${ReportCardModel.appointmentId} = ${AppointmentModel.id}
      ${baseJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${ReportCardModel.createdAt} BETWEEN ${comparison.start} AND ${comparison.end}
        ${doctorFilter}
        ${deptFilter}
    `);

    const currentRevenue: any[] = await database.execute(sql`
      SELECT COALESCE(SUM(CAST(${AppointmentPaymentModel.price} AS NUMERIC)), 0) as total
      FROM ${AppointmentPaymentModel}
      INNER JOIN ${AppointmentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      ${baseJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentPaymentModel.paymentStatus} = 'Paid'
        AND ${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow')
        ${doctorFilter}
        ${deptFilter}
    `);

    const prevRevenue: any[] = await database.execute(sql`
      SELECT COALESCE(SUM(CAST(${AppointmentPaymentModel.price} AS NUMERIC)), 0) as total
      FROM ${AppointmentPaymentModel}
      INNER JOIN ${AppointmentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      ${baseJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        AND ${AppointmentPaymentModel.paymentStatus} = 'Paid'
        AND ${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow')
        ${doctorFilter}
        ${deptFilter}
    `);

    const currentRating: any[] = await database.execute(sql`
      SELECT COALESCE(AVG(${FeedbackModel.rating}), 0) as avg_rating
      FROM ${FeedbackModel}
      WHERE ${FeedbackModel.clinicId} = ${clinicId}
        AND ${FeedbackModel.createdAt} BETWEEN ${primary.start} AND ${primary.end}
    `);

    const prevRating: any[] = await database.execute(sql`
      SELECT COALESCE(AVG(${FeedbackModel.rating}), 0) as avg_rating
      FROM ${FeedbackModel}
      WHERE ${FeedbackModel.clinicId} = ${clinicId}
        AND ${FeedbackModel.createdAt} BETWEEN ${comparison.start} AND ${comparison.end}
    `);

    const cur = currentMetrics[0] || {};
    const prev = prevMetrics[0] || {};
    const curPresc = Number(currentPrescriptions[0]?.total || 0);
    const prevPresc = Number(prevPrescriptions[0]?.total || 0);
    const curRev = Number(currentRevenue[0]?.total || 0);
    const prevRev = Number(prevRevenue[0]?.total || 0);
    const curRate = parseFloat(currentRating[0]?.avg_rating || '0');
    const prevRate = parseFloat(prevRating[0]?.avg_rating || '0');

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
        ...calcChange(curRate, prevRate),
      },
    };
  }

  // ─── TREND DATA ──────────────────────────────────────────────────────────────

  /**
   * Generate all date slots for a range based on granularity.
   * Returns array of { date: Date, label: string } for each slot.
   */
  private static generateDateSlots(
    start: string,
    end: string,
    truncUnit: string,
    durationDays: number
  ): { date: Date; label: string }[] {
    const slots: { date: Date; label: string }[] = [];
    const startDate = new Date(start);
    const endDate = new Date(end);

    if (truncUnit === 'month') {
      // Generate monthly slots, aligned to the 1st of each month
      const current = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        1
      );
      while (current <= endDate) {
        slots.push({
          date: new Date(current),
          label: current.toLocaleDateString('en-US', { month: 'short' }),
        });
        current.setMonth(current.getMonth() + 1);
      }
    } else if (truncUnit === 'week') {
      // Generate weekly slots
      const current = new Date(startDate);
      // Align to start of week (Monday)
      const dayOfWeek = current.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      current.setDate(current.getDate() + diff);
      let weekNum = 1;
      while (current <= endDate) {
        slots.push({ date: new Date(current), label: `Week ${weekNum}` });
        current.setDate(current.getDate() + 7);
        weekNum++;
      }
    } else {
      // Generate daily slots
      const current = new Date(startDate);
      while (current <= endDate) {
        const label =
          durationDays <= 7
            ? current.toLocaleDateString('en-US', { weekday: 'short' })
            : current.toLocaleDateString('en-US', {
                day: '2-digit',
                month: 'short',
              });
        slots.push({ date: new Date(current), label });
        current.setDate(current.getDate() + 1);
      }
    }

    return slots;
  }

  /**
   * Map DB results (with dt column) into a fixed-length array matching slots.
   * Missing slots get 0.
   */
  private static mapDataToSlots(
    dbRows: any[],
    slots: { date: Date; label: string }[],
    truncUnit: string
  ): number[] {
    const dataMap = new Map<string, number>();
    const slotKey = (d: Date) => {
      if (truncUnit === 'month') return `${d.getFullYear()}-M${d.getMonth()}`;
      if (truncUnit === 'week')
        return `${d.getFullYear()}-W${this.getISOWeek(d)}`;
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };

    for (const row of dbRows) {
      dataMap.set(slotKey(new Date(row.dt)), Number(row.cnt));
    }

    return slots.map((slot) => dataMap.get(slotKey(slot.date)) || 0);
  }

  /**
   * Map a requested period to a date_trunc unit. Explicit periods are honoured
   * literally so a chart never contradicts the period the user selected.
   */
  private static resolveTruncUnit(
    period: string,
    durationDays: number
  ): 'day' | 'week' | 'month' {
    if (period === 'monthly') return 'month';
    if (period === 'weekly') return 'week';
    if (period === 'daily') return 'day';
    // 'auto' (or anything unrecognised) — scale with the span
    if (durationDays > 180) return 'month';
    if (durationDays > 31) return 'week';
    return 'day';
  }

  private static getISOWeek(date: Date): number {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const week1 = new Date(d.getFullYear(), 0, 4);
    return (
      1 +
      Math.round(
        ((d.getTime() - week1.getTime()) / 86400000 -
          3 +
          ((week1.getDay() + 6) % 7)) /
          7
      )
    );
  }

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
    const truncUnit = this.resolveTruncUnit(period, durationDays);

    // Generate all slots for both periods
    const primarySlots = this.generateDateSlots(
      primary.start,
      primary.end,
      truncUnit,
      durationDays
    );
    const comparisonSlots = this.generateDateSlots(
      comparison.start,
      comparison.end,
      truncUnit,
      durationDays
    );

    // Ensure previousPeriod has same length as currentPeriod
    // If comparison range produces fewer slots, pad with extra slots
    while (comparisonSlots.length < primarySlots.length) {
      comparisonSlots.push(
        comparisonSlots[comparisonSlots.length - 1] || primarySlots[0]
      );
    }

    const doctorFilter = (query as any).doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${(query as any).doctorId}`
      : sql``;

    if (type === 'appointments') {
      const currentData: any[] = await database.execute(sql`
        SELECT
          date_trunc(${sql.raw(`'${truncUnit}'`)}, ${AppointmentModel.appointmentDate}) as dt,
          COUNT(*) as cnt
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
          ${doctorFilter}
        GROUP BY dt
        ORDER BY dt
      `);

      const prevData: any[] = await database.execute(sql`
        SELECT
          date_trunc(${sql.raw(`'${truncUnit}'`)}, ${AppointmentModel.appointmentDate}) as dt,
          COUNT(*) as cnt
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
          ${doctorFilter}
        GROUP BY dt
        ORDER BY dt
      `);

      return {
        labels: primarySlots.map((s) => s.label),
        currentPeriod: this.mapDataToSlots(
          currentData,
          primarySlots,
          truncUnit
        ),
        previousPeriod: this.mapDataToSlots(
          prevData,
          comparisonSlots,
          truncUnit
        ),
      };
    }

    if (type === 'revenue') {
      // Revenue trend — sum of paid appointment prices per period slot
      const currentData: any[] = await database.execute(sql`
        SELECT
          date_trunc(${sql.raw(`'${truncUnit}'`)}, ${AppointmentModel.appointmentDate}) as dt,
          COALESCE(SUM(CAST(${AppointmentPaymentModel.price} AS NUMERIC)), 0)::int as cnt
        FROM ${AppointmentPaymentModel}
        INNER JOIN ${AppointmentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
          AND ${AppointmentPaymentModel.paymentStatus} = 'Paid'
          AND ${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow')
          ${doctorFilter}
        GROUP BY dt
        ORDER BY dt
      `);

      const prevData: any[] = await database.execute(sql`
        SELECT
          date_trunc(${sql.raw(`'${truncUnit}'`)}, ${AppointmentModel.appointmentDate}) as dt,
          COALESCE(SUM(CAST(${AppointmentPaymentModel.price} AS NUMERIC)), 0)::int as cnt
        FROM ${AppointmentPaymentModel}
        INNER JOIN ${AppointmentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
          AND ${AppointmentPaymentModel.paymentStatus} = 'Paid'
          AND ${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow')
          ${doctorFilter}
        GROUP BY dt
        ORDER BY dt
      `);

      return {
        labels: primarySlots.map((s) => s.label),
        currentPeriod: this.mapDataToSlots(
          currentData,
          primarySlots,
          truncUnit
        ),
        previousPeriod: this.mapDataToSlots(
          prevData,
          comparisonSlots,
          truncUnit
        ),
      };
    }

    // Prescriptions trend
    const currentData: any[] = await database.execute(sql`
      SELECT
        date_trunc(${sql.raw(`'${truncUnit}'`)}, ${ReportCardModel.createdAt}) as dt,
        COUNT(DISTINCT ${ReportCardModel.id}) as cnt
      FROM ${ReportCardModel}
      INNER JOIN ${AppointmentModel} ON ${ReportCardModel.appointmentId} = ${AppointmentModel.id}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${ReportCardModel.createdAt} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter}
      GROUP BY dt
      ORDER BY dt
    `);

    const prevData: any[] = await database.execute(sql`
      SELECT
        date_trunc(${sql.raw(`'${truncUnit}'`)}, ${ReportCardModel.createdAt}) as dt,
        COUNT(DISTINCT ${ReportCardModel.id}) as cnt
      FROM ${ReportCardModel}
      INNER JOIN ${AppointmentModel} ON ${ReportCardModel.appointmentId} = ${AppointmentModel.id}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${ReportCardModel.createdAt} BETWEEN ${comparison.start} AND ${comparison.end}
        ${doctorFilter}
      GROUP BY dt
      Order BY dt
    `);

    return {
      labels: primarySlots.map((s) => s.label),
      currentPeriod: this.mapDataToSlots(currentData, primarySlots, truncUnit),
      previousPeriod: this.mapDataToSlots(prevData, comparisonSlots, truncUnit),
    };
  }

  // ─── PATIENT DISTRIBUTION ────────────────────────────────────────────────────

  private static async getPatientDistribution(
    clinicId: string,
    primary: DateRange,
    query: ReportsOverviewQueryDto
  ) {
    const doctorFilter = query.doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}`
      : sql``;

    const result: any[] = await database.execute(sql`
      WITH patient_data AS (
        SELECT DISTINCT ${AppointmentModel.patientId},
          CASE
            WHEN ${AppointmentModel.createdAt} >= ${primary.start} THEN 'new'
            ELSE 'returning'
          END as patient_type
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
          ${doctorFilter}
      ),
      inactive AS (
        SELECT COUNT(DISTINCT p.patient_id) as cnt
        FROM (
          SELECT ${AppointmentModel.patientId} as patient_id,
            MAX(${AppointmentModel.appointmentDate}) as last_visit
          FROM ${AppointmentModel}
          WHERE ${AppointmentModel.clinicId} = ${clinicId}
          GROUP BY ${AppointmentModel.patientId}
          HAVING MAX(${AppointmentModel.appointmentDate}) < ${primary.start}
        ) p
      )
      SELECT
        (SELECT COUNT(*) FROM patient_data WHERE patient_type = 'new') as new_patients,
        (SELECT COUNT(*) FROM patient_data WHERE patient_type = 'returning') as returning_patients,
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
    const doctorFilter = query.doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}`
      : sql``;

    // Revenue here must mean the same thing it means everywhere else on the
    // page: money actually collected on appointments that went ahead. The
    // previous query summed every joined payment row regardless of
    // paymentStatus and counted cancelled/no-show appointments, so a service
    // could show revenue it had never been paid.
    const result: any[] = await database.execute(sql`
      SELECT
        ${ClinicServiceModel.serviceName} as department,
        COUNT(DISTINCT ${AppointmentModel.id}) as appointments,
        COALESCE(SUM(
          CASE WHEN ${AppointmentPaymentModel.paymentStatus} = 'Paid'
            THEN CAST(${AppointmentPaymentModel.price} AS NUMERIC)
            ELSE 0 END
        ), 0) as revenue
      FROM ${AppointmentModel}
      INNER JOIN ${ClinicServiceModel} ON ${AppointmentModel.clinicServiceId} = ${ClinicServiceModel.id}
      LEFT JOIN ${AppointmentPaymentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow')
        ${doctorFilter}
      GROUP BY ${ClinicServiceModel.serviceName}
      ORDER BY appointments DESC
      LIMIT 5
    `);

    return result.map((r) => ({
      department: r.department,
      appointments: Number(r.appointments),
      revenue: Math.round(Number(r.revenue)), // rupees
    }));
  }

  // ─── REVENUE OVERVIEW ────────────────────────────────────────────────────────

  private static async getRevenueOverview(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsOverviewQueryDto
  ) {
    const doctorFilter = query.doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}`
      : sql``;

    // The headline total and the bars must describe the SAME window, or the
    // card contradicts itself (it previously paired a filter-range total with
    // a fixed trailing-6-month chart). Both are now derived from the selected
    // range, bucketed at a granularity that scales with its length.
    const durationDays = Math.ceil(
      (new Date(primary.end).getTime() - new Date(primary.start).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    const truncUnit = this.resolveTruncUnit('auto', durationDays);
    const slots = this.generateDateSlots(
      primary.start,
      primary.end,
      truncUnit,
      durationDays
    );

    const bucketRows: any[] = await database.execute(sql`
      SELECT
        date_trunc(${sql.raw(`'${truncUnit}'`)}, ${AppointmentModel.appointmentDate}) as dt,
        COALESCE(SUM(CAST(${AppointmentPaymentModel.price} AS NUMERIC)), 0) as cnt
      FROM ${AppointmentModel}
      INNER JOIN ${AppointmentPaymentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentPaymentModel.paymentStatus} = 'Paid'
        AND ${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow')
        ${doctorFilter}
      GROUP BY dt
      ORDER BY dt
    `);

    const values = this.mapDataToSlots(bucketRows, slots, truncUnit).map((v) =>
      Math.round(v)
    );
    const chartData = slots.map((s, i) => ({
      label: s.label,
      value: values[i] ?? 0,
    }));

    // Summing the rendered series (rather than issuing a separate total query)
    // makes the headline provably equal to the bars above it.
    const curRev = values.reduce((a, b) => a + b, 0);

    const prevRevResult: any[] = await database.execute(sql`
      SELECT COALESCE(SUM(CAST(${AppointmentPaymentModel.price} AS NUMERIC)), 0) as total
      FROM ${AppointmentPaymentModel}
      INNER JOIN ${AppointmentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        AND ${AppointmentPaymentModel.paymentStatus} = 'Paid'
        AND ${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow')
        ${doctorFilter}
    `);

    const prevRev = Number(prevRevResult[0]?.total || 0);
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
    const doctorFilter = query.doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}`
      : sql``;

    const result: any[] = await database.execute(sql`
      SELECT
        COALESCE(${AppointmentPaymentModel.paymentMode}, 'Other') as label,
        COALESCE(SUM(CAST(${AppointmentPaymentModel.price} AS NUMERIC)), 0) as value
      FROM ${AppointmentPaymentModel}
      INNER JOIN ${AppointmentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentPaymentModel.paymentStatus} = 'Paid'
        ${doctorFilter}
      GROUP BY ${AppointmentPaymentModel.paymentMode}
      ORDER BY value DESC
    `);

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

    _query: ReportsOverviewQueryDto
  ) {
    const result: any[] = await database.execute(sql`
      SELECT
        ${PrescriptionModel.medicineName} as medicine,
        COUNT(${PrescriptionModel.id}) as units,
        COALESCE(SUM(CAST(${AppointmentPaymentModel.price} AS NUMERIC)), 0) as revenue
      FROM ${PrescriptionModel}
      INNER JOIN ${ReportCardModel} ON ${PrescriptionModel.reportCardId} = ${ReportCardModel.id}
      INNER JOIN ${AppointmentModel} ON ${ReportCardModel.appointmentId} = ${AppointmentModel.id}
      LEFT JOIN ${AppointmentPaymentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${PrescriptionModel.createdAt} BETWEEN ${primary.start} AND ${primary.end}
      GROUP BY ${PrescriptionModel.medicineName}
      ORDER BY units DESC
      LIMIT 5
    `);

    return result.map((r) => ({
      medicine: r.medicine,
      units: Number(r.units),
      revenue: Math.round(Number(r.revenue || 0)), // rupees
    }));
  }

  // ─── NO SHOW ANALYSIS ────────────────────────────────────────────────────────

  private static async getNoShowAnalysis(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsOverviewQueryDto
  ) {
    const doctorFilter = query.doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}`
      : sql``;

    const result: any[] = await database.execute(sql`
      SELECT
        ${AppointmentModel.appointmentStatus} as status,
        COUNT(*) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter}
      GROUP BY ${AppointmentModel.appointmentStatus}
    `);

    const prevNoShow: any[] = await database.execute(sql`
      SELECT COUNT(*) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        AND ${AppointmentModel.appointmentStatus} = 'NoShow'
        ${doctorFilter}
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
    const doctorFilter = query.doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}`
      : sql``;

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
      INNER JOIN ${UserProfileModel} ON ${UserProfileModel.userId} = ${AppointmentModel.patientId}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter}
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

  // ─── MONTHLY COMPARISON ──────────────────────────────────────────────────────

  private static async getMonthlyComparison(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsOverviewQueryDto
  ) {
    const doctorFilter = query.doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}`
      : sql``;

    const curStats: any[] = await database.execute(sql`
      SELECT
        COUNT(DISTINCT ${AppointmentModel.patientId}) as patients,
        COUNT(${AppointmentModel.id}) as appointments
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter}
    `);

    const prevStats: any[] = await database.execute(sql`
      SELECT
        COUNT(DISTINCT ${AppointmentModel.patientId}) as patients,
        COUNT(${AppointmentModel.id}) as appointments
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        ${doctorFilter}
    `);

    const curPrescriptions: any[] = await database.execute(sql`
      SELECT COUNT(DISTINCT ${ReportCardModel.id}) as total
      FROM ${ReportCardModel}
      INNER JOIN ${AppointmentModel} ON ${ReportCardModel.appointmentId} = ${AppointmentModel.id}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${ReportCardModel.createdAt} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter}
    `);

    const prevPrescriptions: any[] = await database.execute(sql`
      SELECT COUNT(DISTINCT ${ReportCardModel.id}) as total
      FROM ${ReportCardModel}
      INNER JOIN ${AppointmentModel} ON ${ReportCardModel.appointmentId} = ${AppointmentModel.id}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${ReportCardModel.createdAt} BETWEEN ${comparison.start} AND ${comparison.end}
        ${doctorFilter}
    `);

    const curRevenue: any[] = await database.execute(sql`
      SELECT COALESCE(SUM(CAST(${AppointmentPaymentModel.price} AS NUMERIC)), 0) as total
      FROM ${AppointmentPaymentModel}
      INNER JOIN ${AppointmentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentPaymentModel.paymentStatus} = 'Paid'
        ${doctorFilter}
    `);

    const prevRevenue: any[] = await database.execute(sql`
      SELECT COALESCE(SUM(CAST(${AppointmentPaymentModel.price} AS NUMERIC)), 0) as total
      FROM ${AppointmentPaymentModel}
      INNER JOIN ${AppointmentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        AND ${AppointmentPaymentModel.paymentStatus} = 'Paid'
        ${doctorFilter}
    `);

    const cur = curStats[0] || {};
    const prev = prevStats[0] || {};
    const curP = Number(curPrescriptions[0]?.total || 0);
    const prevP = Number(prevPrescriptions[0]?.total || 0);
    const curR = Number(curRevenue[0]?.total || 0);
    const prevR = Number(prevRevenue[0]?.total || 0);

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
      row('Patients', Number(cur.patients || 0), Number(prev.patients || 0)),
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

    _query: ReportsOverviewQueryDto
  ) {
    const alerts: { type: string; title: string; date: string }[] = [];
    const today = primary.end.split(' ')[0];

    try {
      // Peak hours detection. Grouped by appointment_time (the only column
      // that carries a time of day) and bucketed in JS — appointment_date is
      // always midnight, so EXTRACT(HOUR) from it reported 12 AM every time.
      const timeRows: any[] = await database.execute(sql`
        SELECT
          ${AppointmentModel.appointmentTime} as time,
          COUNT(*) as cnt
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
          AND ${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow')
          AND ${AppointmentModel.appointmentTime} IS NOT NULL
        GROUP BY ${AppointmentModel.appointmentTime}
      `);
      const peakHours = bucketRowsByHour(timeRows).slice(0, 3);

      if (peakHours.length > 0) {
        // These are the two busiest hours by volume, not the ends of a
        // continuous span — "between 9 AM and 3 AM" was never a real range.
        // Sorted chronologically and listed, so the wording matches the data.
        const topHours = peakHours
          .slice(0, 2)
          .map((r) => r.hour)
          .sort((a, b) => a - b)
          .map(formatHour12);
        alerts.push({
          type: 'warning',
          title:
            topHours.length > 1
              ? `Busiest hours are ${topHours[0]} and ${topHours[1]}`
              : `Busiest hour is ${topHours[0]}`,
          date: today,
        });
      }

      // Top revenue department alert
      const deptRevChange: any[] = await database.execute(sql`
        SELECT
          ${ClinicServiceModel.serviceName} as dept,
          COALESCE(SUM(
            CASE WHEN ${AppointmentPaymentModel.paymentStatus} = 'Paid'
              THEN CAST(${AppointmentPaymentModel.price} AS NUMERIC)
              ELSE 0 END
          ), 0) as revenue
        FROM ${AppointmentModel}
        INNER JOIN ${ClinicServiceModel} ON ${AppointmentModel.clinicServiceId} = ${ClinicServiceModel.id}
        LEFT JOIN ${AppointmentPaymentModel} ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
          AND ${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow')
        GROUP BY ${ClinicServiceModel.serviceName}
        ORDER BY revenue DESC
        LIMIT 1
      `);

      if (deptRevChange.length > 0) {
        // Informational, not a problem — 'danger' painted the best-performing
        // service in alarm red.
        alerts.push({
          type: 'info',
          title: `${deptRevChange[0].dept} earned the most in this period`,
          date: today,
        });
      }

      // No-show day detection
      const noShowByDay: any[] = await database.execute(sql`
        SELECT
          TO_CHAR(${AppointmentModel.appointmentDate}, 'Day') as day_name,
          COUNT(*) as cnt
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
          AND (${AppointmentModel.appointmentStatus} = 'NoShow'
            OR ${AppointmentModel.appointmentStatus} = 'Missed')
        GROUP BY day_name
        ORDER BY cnt DESC
        LIMIT 1
      `);

      if (noShowByDay.length > 0) {
        alerts.push({
          type: 'info',
          title: `No show rate is higher on ${noShowByDay[0].day_name.trim()}s`,
          date: today,
        });
      }
    } catch (err) {
      logger.warn('[ReportsOverview] Error generating alerts', err);
    }

    return alerts;
  }
}
