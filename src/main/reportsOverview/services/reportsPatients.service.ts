/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import {
  ReportsPatientsQueryDto,
  ReportsPatientsTrendQueryDto,
} from '../schemas/reportsPatients.schemas';
import logger from '../../../utils/logger';

const CACHE_TTL = 120; // 2 minutes
const CACHE_TTL_TREND = 120; // 2 minutes

interface DateRange {
  start: string;
  end: string;
}

function buildComparisonRange(query: ReportsPatientsQueryDto): {
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
    const compStart = new Date(startMs - durationMs - 86400000);
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
  query: ReportsPatientsQueryDto
): string {
  return [
    'reports:patients',
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
  query: ReportsPatientsTrendQueryDto
): string {
  return [
    'reports:patients:trend',
    clinicId,
    query.type,
    query.period,
    query.startDate,
    query.endDate,
    query.department || 'all',
    query.doctorId || 'all',
  ].join(':');
}

/** Generate all daily slots for a date range */
function generateDailySlots(
  start: string,
  end: string
): { date: Date; label: string }[] {
  const slots: { date: Date; label: string }[] = [];
  const startDate = new Date(start);
  const endDate = new Date(end);
  const durationDays = Math.ceil(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );
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
  return slots;
}

function generateSlots(
  start: string,
  end: string,
  period: string
): { date: Date; label: string }[] {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const durationDays = Math.ceil(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (period === 'monthly' || (period === 'auto' && durationDays > 30)) {
    const slots: { date: Date; label: string }[] = [];
    const current = new Date(startDate);
    const dayOfWeek = current.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    current.setDate(current.getDate() + diff);
    let weekNum = 1;
    while (current <= endDate) {
      slots.push({ date: new Date(current), label: `Week ${weekNum}` });
      current.setDate(current.getDate() + 7);
      weekNum++;
    }
    return slots;
  }
  return generateDailySlots(start, end);
}

function getISOWeek(date: Date): number {
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

function mapDataToSlots(
  dbRows: any[],
  slots: { date: Date; label: string }[],
  truncUnit: string
): number[] {
  const dataMap = new Map<string, number>();
  for (const row of dbRows) {
    const d = new Date(row.dt);
    const key =
      truncUnit === 'week'
        ? `${d.getFullYear()}-W${getISOWeek(d)}`
        : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    dataMap.set(key, Number(row.cnt));
  }
  return slots.map((slot) => {
    const key =
      truncUnit === 'week'
        ? `${slot.date.getFullYear()}-W${getISOWeek(slot.date)}`
        : `${slot.date.getFullYear()}-${slot.date.getMonth()}-${slot.date.getDate()}`;
    return dataMap.get(key) || 0;
  });
}

export class ReportsPatientsService {
  static async getPatientReports(
    clinicId: string,
    query: ReportsPatientsQueryDto
  ) {
    const cacheKey = buildCacheKey(clinicId, query);

    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        logger.info(`[ReportsPatients] Cache HIT: ${cacheKey}`);
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[ReportsPatients] Redis read error', err);
    }

    const { primary, comparison } = buildComparisonRange(query);

    const [
      metrics,
      patientTrend,
      ageDistribution,
      genderDistribution,
      topCities,
      newVsReturning,
      visitFrequency,
      lastVisitRecency,
      growthSummary,
    ] = await Promise.all([
      this.getMetrics(clinicId, primary, comparison, query),
      this.getPatientTrend(clinicId, primary, comparison, query, 'auto'),
      this.getAgeDistribution(clinicId, primary, query),
      this.getGenderDistribution(clinicId, primary, query),
      this.getTopCities(clinicId, primary, query),
      this.getNewVsReturning(clinicId, primary, query, 'auto'),
      this.getVisitFrequency(clinicId, primary, query),
      this.getLastVisitRecency(clinicId, primary, query),
      this.getGrowthSummary(clinicId, query),
    ]);

    const result = {
      metrics,
      patientTrend,
      ageDistribution,
      genderDistribution,
      topCities,
      newVsReturning,
      visitFrequency,
      lastVisitRecency,
      growthSummary,
    };

    try {
      await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(result));
    } catch (err) {
      logger.warn('[ReportsPatients] Redis write error', err);
    }

    return result;
  }

  static async getPatientTrendData(
    clinicId: string,
    query: ReportsPatientsTrendQueryDto
  ) {
    const cacheKey = buildTrendCacheKey(clinicId, query);

    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        logger.info(`[ReportsPatients] Trend Cache HIT: ${cacheKey}`);
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[ReportsPatients] Redis read error for trend', err);
    }

    const { primary, comparison } = buildComparisonRange(query);
    let result;

    if (query.type === 'patients') {
      result = await this.getPatientTrend(
        clinicId,
        primary,
        comparison,
        query,
        query.period
      );
    } else {
      result = await this.getNewVsReturning(
        clinicId,
        primary,
        query,
        query.period
      );
    }

    try {
      await redisClient.setex(
        cacheKey,
        CACHE_TTL_TREND,
        JSON.stringify(result)
      );
    } catch (err) {
      logger.warn('[ReportsPatients] Redis write error for trend', err);
    }

    return result;
  }

  // ─── METRICS ─────────────────────────────────────────────────────────────────

  private static async getMetrics(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsPatientsQueryDto
  ) {
    const doctorFilter = query.doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}`
      : sql``;

    // Current period
    const curData: any[] = await database.execute(sql`
      SELECT
        COUNT(DISTINCT ${AppointmentModel.patientId}) as total_patients,
        COUNT(DISTINCT CASE
          WHEN ${AppointmentModel.createdAt} >= ${primary.start}
          THEN ${AppointmentModel.patientId}
        END) as new_patients
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter}
    `);

    const prevData: any[] = await database.execute(sql`
      SELECT
        COUNT(DISTINCT ${AppointmentModel.patientId}) as total_patients,
        COUNT(DISTINCT CASE
          WHEN ${AppointmentModel.createdAt} >= ${comparison.start}
          THEN ${AppointmentModel.patientId}
        END) as new_patients
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        ${doctorFilter}
    `);

    // Active patients (visited in last 90 days from end date)
    const endDate = new Date(primary.end);
    const ninetyDaysAgo = new Date(endDate);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const ninetyDaysAgoStr =
      ninetyDaysAgo.toISOString().split('T')[0] + ' 00:00:00';

    const activeData: any[] = await database.execute(sql`
      SELECT COUNT(DISTINCT ${AppointmentModel.patientId}) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} >= ${ninetyDaysAgoStr}
        ${doctorFilter}
    `);

    // Inactive patients (no visit in last 90 days)
    const inactiveData: any[] = await database.execute(sql`
      SELECT COUNT(DISTINCT sub.pid) as cnt FROM (
        SELECT ${AppointmentModel.patientId} as pid,
          MAX(${AppointmentModel.appointmentDate}) as last_visit
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          ${doctorFilter}
        GROUP BY ${AppointmentModel.patientId}
        HAVING MAX(${AppointmentModel.appointmentDate}) < ${ninetyDaysAgoStr}
      ) sub
    `);

    // Previous active/inactive for comparison
    const prevEndDate = new Date(comparison.end);
    const prevNinetyDaysAgo = new Date(prevEndDate);
    prevNinetyDaysAgo.setDate(prevNinetyDaysAgo.getDate() - 90);
    const prevNinetyStr =
      prevNinetyDaysAgo.toISOString().split('T')[0] + ' 00:00:00';

    const prevActiveData: any[] = await database.execute(sql`
      SELECT COUNT(DISTINCT ${AppointmentModel.patientId}) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} >= ${prevNinetyStr}
        AND ${AppointmentModel.appointmentDate} <= ${comparison.end}
        ${doctorFilter}
    `);

    const prevInactiveData: any[] = await database.execute(sql`
      SELECT COUNT(DISTINCT sub.pid) as cnt FROM (
        SELECT ${AppointmentModel.patientId} as pid,
          MAX(${AppointmentModel.appointmentDate}) as last_visit
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} <= ${comparison.end}
          ${doctorFilter}
        GROUP BY ${AppointmentModel.patientId}
        HAVING MAX(${AppointmentModel.appointmentDate}) < ${prevNinetyStr}
      ) sub
    `);

    // Avg visits per patient
    const avgVisits: any[] = await database.execute(sql`
      SELECT
        COALESCE(AVG(visit_count), 0) as avg_visits
      FROM (
        SELECT ${AppointmentModel.patientId}, COUNT(*) as visit_count
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
          ${doctorFilter}
        GROUP BY ${AppointmentModel.patientId}
      ) sub
    `);

    const prevAvgVisits: any[] = await database.execute(sql`
      SELECT
        COALESCE(AVG(visit_count), 0) as avg_visits
      FROM (
        SELECT ${AppointmentModel.patientId}, COUNT(*) as visit_count
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
          ${doctorFilter}
        GROUP BY ${AppointmentModel.patientId}
      ) sub
    `);

    const cur = curData[0] || {};
    const prev = prevData[0] || {};
    const curTotal = Number(cur.total_patients || 0);
    const prevTotal = Number(prev.total_patients || 0);
    const curNew = Number(cur.new_patients || 0);
    const prevNew = Number(prev.new_patients || 0);
    const curReturning = curTotal - curNew;
    const prevReturning = prevTotal - prevNew;
    const curActive = Number(activeData[0]?.cnt || 0);
    const prevActive = Number(prevActiveData[0]?.cnt || 0);
    const curInactive = Number(inactiveData[0]?.cnt || 0);
    const prevInactive = Number(prevInactiveData[0]?.cnt || 0);
    const curAvg = parseFloat(Number(avgVisits[0]?.avg_visits || 0).toFixed(1));
    const prevAvg = parseFloat(
      Number(prevAvgVisits[0]?.avg_visits || 0).toFixed(1)
    );

    return {
      totalPatients: { value: curTotal, ...calcChange(curTotal, prevTotal) },
      newPatients: { value: curNew, ...calcChange(curNew, prevNew) },
      returningPatients: {
        value: curReturning,
        ...calcChange(curReturning, prevReturning),
      },
      activePatients: {
        value: curActive,
        ...calcChange(curActive, prevActive),
      },
      inactivePatients: {
        value: curInactive,
        ...calcChange(curInactive, prevInactive),
      },
      avgVisitsPerPatient: { value: curAvg, ...calcChange(curAvg, prevAvg) },
    };
  }

  // ─── PATIENT TREND ───────────────────────────────────────────────────────────

  private static async getPatientTrend(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsPatientsQueryDto | ReportsPatientsTrendQueryDto,
    period: string
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
    const comparisonSlots = generateSlots(
      comparison.start,
      comparison.end,
      period
    );
    while (comparisonSlots.length < primarySlots.length) {
      comparisonSlots.push(
        comparisonSlots[comparisonSlots.length - 1] || primarySlots[0]
      );
    }

    const doctorFilter = (query as any).doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${(query as any).doctorId}`
      : sql``;

    const currentData: any[] = await database.execute(sql`
      SELECT
        date_trunc(${sql.raw(`'${truncUnit}'`)}, ${AppointmentModel.appointmentDate}) as dt,
        COUNT(DISTINCT ${AppointmentModel.patientId}) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter}
      GROUP BY dt
      ORDER BY dt
    `);

    const prevDataRows: any[] = await database.execute(sql`
      SELECT
        date_trunc(${sql.raw(`'${truncUnit}'`)}, ${AppointmentModel.appointmentDate}) as dt,
        COUNT(DISTINCT ${AppointmentModel.patientId}) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        ${doctorFilter}
      GROUP BY dt
      ORDER BY dt
    `);

    return {
      labels: primarySlots.map((s) => s.label),
      currentPeriod: mapDataToSlots(currentData, primarySlots, truncUnit),
      previousPeriod: mapDataToSlots(prevDataRows, comparisonSlots, truncUnit),
    };
  }

  // ─── AGE DISTRIBUTION ────────────────────────────────────────────────────────

  private static async getAgeDistribution(
    clinicId: string,
    primary: DateRange,
    query: ReportsPatientsQueryDto
  ) {
    const doctorFilter = query.doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}`
      : sql``;

    const result: any[] = await database.execute(sql`
      SELECT
        CASE
          WHEN ${UserProfileModel.age} IS NULL THEN 'Unknown'
          WHEN ${UserProfileModel.age} BETWEEN 0 AND 18 THEN '0 - 18 Years'
          WHEN ${UserProfileModel.age} BETWEEN 19 AND 30 THEN '19 - 30 Years'
          WHEN ${UserProfileModel.age} BETWEEN 31 AND 45 THEN '31 - 45 Years'
          WHEN ${UserProfileModel.age} BETWEEN 46 AND 60 THEN '46 - 60 Years'
          ELSE '60+ Years'
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
        label: r.age_group,
        value: Number(r.patients),
        percentage: parseFloat(((Number(r.patients) / total) * 100).toFixed(1)),
      }));
  }

  // ─── GENDER DISTRIBUTION ─────────────────────────────────────────────────────

  private static async getGenderDistribution(
    clinicId: string,
    primary: DateRange,
    query: ReportsPatientsQueryDto
  ) {
    const doctorFilter = query.doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}`
      : sql``;

    const result: any[] = await database.execute(sql`
      SELECT
        COALESCE(${UserProfileModel.gender}, 'Other') as gender,
        COUNT(DISTINCT ${AppointmentModel.patientId}) as patients
      FROM ${AppointmentModel}
      INNER JOIN ${UserProfileModel} ON ${UserProfileModel.userId} = ${AppointmentModel.patientId}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter}
      GROUP BY gender
      ORDER BY patients DESC
    `);

    const total = result.reduce((sum, r) => sum + Number(r.patients), 0) || 1;
    return result.map((r) => ({
      label: r.gender,
      value: Number(r.patients),
      percentage: parseFloat(((Number(r.patients) / total) * 100).toFixed(1)),
    }));
  }

  // ─── TOP CITIES ──────────────────────────────────────────────────────────────

  private static async getTopCities(
    clinicId: string,
    primary: DateRange,
    query: ReportsPatientsQueryDto
  ) {
    const doctorFilter = query.doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}`
      : sql``;

    const result: any[] = await database.execute(sql`
      SELECT
        COALESCE(${UserProfileModel.city}, 'Unknown') as city,
        COUNT(DISTINCT ${AppointmentModel.patientId}) as patients
      FROM ${AppointmentModel}
      INNER JOIN ${UserProfileModel} ON ${UserProfileModel.userId} = ${AppointmentModel.patientId}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter}
      GROUP BY city
      ORDER BY patients DESC
    `);

    const total = result.reduce((sum, r) => sum + Number(r.patients), 0) || 1;
    const top4 = result.slice(0, 4);
    const others = result.slice(4);
    const otherCount = others.reduce((sum, r) => sum + Number(r.patients), 0);

    const cities = top4.map((r) => ({
      city: r.city,
      patients: Number(r.patients),
      percentage: parseFloat(((Number(r.patients) / total) * 100).toFixed(1)),
    }));

    if (otherCount > 0) {
      cities.push({
        city: 'Other',
        patients: otherCount,
        percentage: parseFloat(((otherCount / total) * 100).toFixed(1)),
      });
    }

    return cities;
  }

  // ─── NEW VS RETURNING ────────────────────────────────────────────────────────

  private static async getNewVsReturning(
    clinicId: string,
    primary: DateRange,
    query: ReportsPatientsQueryDto | ReportsPatientsTrendQueryDto,
    period: string
  ) {
    const durationDays = Math.ceil(
      (new Date(primary.end).getTime() - new Date(primary.start).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    const truncUnit =
      period === 'monthly' || (period === 'auto' && durationDays > 30)
        ? 'week'
        : 'day';
    const slots = generateSlots(primary.start, primary.end, period);

    const doctorFilter = (query as any).doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${(query as any).doctorId}`
      : sql``;

    // New patients per slot (first appointment in this clinic was within primary range)
    const newData: any[] = await database.execute(sql`
      SELECT
        date_trunc(${sql.raw(`'${truncUnit}'`)}, ${AppointmentModel.appointmentDate}) as dt,
        COUNT(DISTINCT ${AppointmentModel.patientId}) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentModel.patientId} IN (
          SELECT ${AppointmentModel.patientId}
          FROM ${AppointmentModel}
          WHERE ${AppointmentModel.clinicId} = ${clinicId}
          GROUP BY ${AppointmentModel.patientId}
          HAVING MIN(${AppointmentModel.appointmentDate}) >= ${primary.start}
        )
        ${doctorFilter}
      GROUP BY dt
      ORDER BY dt
    `);

    // Returning patients per slot
    const returningData: any[] = await database.execute(sql`
      SELECT
        date_trunc(${sql.raw(`'${truncUnit}'`)}, ${AppointmentModel.appointmentDate}) as dt,
        COUNT(DISTINCT ${AppointmentModel.patientId}) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentModel.patientId} IN (
          SELECT ${AppointmentModel.patientId}
          FROM ${AppointmentModel}
          WHERE ${AppointmentModel.clinicId} = ${clinicId}
          GROUP BY ${AppointmentModel.patientId}
          HAVING MIN(${AppointmentModel.appointmentDate}) < ${primary.start}
        )
        ${doctorFilter}
      GROUP BY dt
      ORDER BY dt
    `);

    const newMapped = mapDataToSlots(newData, slots, truncUnit);
    const returningMapped = mapDataToSlots(returningData, slots, truncUnit);

    return {
      labels: slots.map((s) => s.label),
      currentPeriod: newMapped,
      previousPeriod: returningMapped,
    };
  }

  // ─── VISIT FREQUENCY ─────────────────────────────────────────────────────────

  private static async getVisitFrequency(
    clinicId: string,
    primary: DateRange,
    query: ReportsPatientsQueryDto
  ) {
    const doctorFilter = query.doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}`
      : sql``;

    const result: any[] = await database.execute(sql`
      SELECT
        CASE
          WHEN visit_count = 1 THEN '1 Visit'
          WHEN visit_count BETWEEN 2 AND 3 THEN '2 - 3 Visits'
          WHEN visit_count BETWEEN 4 AND 6 THEN '4 - 6 Visits'
          ELSE '7+ Visits'
        END as frequency,
        CASE
          WHEN visit_count = 1 THEN 1
          WHEN visit_count BETWEEN 2 AND 3 THEN 2
          WHEN visit_count BETWEEN 4 AND 6 THEN 3
          ELSE 4
        END as sort_order,
        COUNT(*) as patients
      FROM (
        SELECT ${AppointmentModel.patientId}, COUNT(*) as visit_count
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
          ${doctorFilter}
        GROUP BY ${AppointmentModel.patientId}
      ) sub
      GROUP BY frequency, sort_order
      ORDER BY sort_order
    `);

    const total = result.reduce((sum, r) => sum + Number(r.patients), 0) || 1;
    return result.map((r) => ({
      frequency: r.frequency,
      patients: Number(r.patients),
      percentage: parseFloat(((Number(r.patients) / total) * 100).toFixed(1)),
    }));
  }

  // ─── LAST VISIT RECENCY ──────────────────────────────────────────────────────

  private static async getLastVisitRecency(
    clinicId: string,
    primary: DateRange,
    query: ReportsPatientsQueryDto
  ) {
    const doctorFilter = query.doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}`
      : sql``;

    const endDateStr = primary.end.split(' ')[0];

    const result: any[] = await database.execute(sql`
      SELECT
        CASE
          WHEN (${sql.raw(`'${endDateStr}'::date`)} - last_visit::date) <= 30 THEN 'Within 30 Days'
          WHEN (${sql.raw(`'${endDateStr}'::date`)} - last_visit::date) BETWEEN 31 AND 90 THEN '31 - 90 Days'
          WHEN (${sql.raw(`'${endDateStr}'::date`)} - last_visit::date) BETWEEN 91 AND 180 THEN '91 - 180 Days'
          ELSE '180+ Days'
        END as last_visit_group,
        CASE
          WHEN (${sql.raw(`'${endDateStr}'::date`)} - last_visit::date) <= 30 THEN 1
          WHEN (${sql.raw(`'${endDateStr}'::date`)} - last_visit::date) BETWEEN 31 AND 90 THEN 2
          WHEN (${sql.raw(`'${endDateStr}'::date`)} - last_visit::date) BETWEEN 91 AND 180 THEN 3
          ELSE 4
        END as sort_order,
        COUNT(*) as patients
      FROM (
        SELECT ${AppointmentModel.patientId},
          MAX(${AppointmentModel.appointmentDate}) as last_visit
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          ${doctorFilter}
        GROUP BY ${AppointmentModel.patientId}
      ) sub
      GROUP BY last_visit_group, sort_order
      ORDER BY sort_order
    `);

    const total = result.reduce((sum, r) => sum + Number(r.patients), 0) || 1;
    return result.map((r) => ({
      lastVisit: r.last_visit_group,
      patients: Number(r.patients),
      percentage: parseFloat(((Number(r.patients) / total) * 100).toFixed(1)),
    }));
  }

  // ─── GROWTH SUMMARY ──────────────────────────────────────────────────────────

  private static async getGrowthSummary(
    clinicId: string,
    query: ReportsPatientsQueryDto
  ) {
    const doctorFilter = query.doctorId
      ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}`
      : sql``;

    const now = new Date(query.endDate);

    // This week (Mon-Sun)
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(now.getDate() + mondayOffset);
    const thisWeekStartStr =
      thisWeekStart.toISOString().split('T')[0] + ' 00:00:00';
    const thisWeekEndStr = query.endDate + ' 23:59:59';

    // Last week
    const lastWeekEnd = new Date(thisWeekStart);
    lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
    const lastWeekStart = new Date(lastWeekEnd);
    lastWeekStart.setDate(lastWeekStart.getDate() - 6);
    const lastWeekStartStr =
      lastWeekStart.toISOString().split('T')[0] + ' 00:00:00';
    const lastWeekEndStr =
      lastWeekEnd.toISOString().split('T')[0] + ' 23:59:59';

    // This month
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthStartStr =
      thisMonthStart.toISOString().split('T')[0] + ' 00:00:00';

    // Last month
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthStartStr =
      lastMonthStart.toISOString().split('T')[0] + ' 00:00:00';
    const lastMonthEndStr =
      lastMonthEnd.toISOString().split('T')[0] + ' 23:59:59';

    // This year
    const thisYearStartStr = `${now.getFullYear()}-01-01 00:00:00`;

    // Last year
    const lastYearStartStr = `${now.getFullYear() - 1}-01-01 00:00:00`;
    const lastYearEndStr = `${now.getFullYear() - 1}-12-31 23:59:59`;

    const [thisWeek, lastWeek, thisMonth, lastMonth, thisYear, lastYear] =
      await Promise.all([
        database.execute(sql`
        SELECT COUNT(DISTINCT ${AppointmentModel.patientId}) as cnt
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${thisWeekStartStr} AND ${thisWeekEndStr}
          ${doctorFilter}
      `),
        database.execute(sql`
        SELECT COUNT(DISTINCT ${AppointmentModel.patientId}) as cnt
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${lastWeekStartStr} AND ${lastWeekEndStr}
          ${doctorFilter}
      `),
        database.execute(sql`
        SELECT COUNT(DISTINCT ${AppointmentModel.patientId}) as cnt
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${thisMonthStartStr} AND ${thisWeekEndStr}
          ${doctorFilter}
      `),
        database.execute(sql`
        SELECT COUNT(DISTINCT ${AppointmentModel.patientId}) as cnt
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${lastMonthStartStr} AND ${lastMonthEndStr}
          ${doctorFilter}
      `),
        database.execute(sql`
        SELECT COUNT(DISTINCT ${AppointmentModel.patientId}) as cnt
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${thisYearStartStr} AND ${thisWeekEndStr}
          ${doctorFilter}
      `),
        database.execute(sql`
        SELECT COUNT(DISTINCT ${AppointmentModel.patientId}) as cnt
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${lastYearStartStr} AND ${lastYearEndStr}
          ${doctorFilter}
      `),
      ]);

    const thisWeekVal = Number((thisWeek as any[])[0]?.cnt || 0);
    const lastWeekVal = Number((lastWeek as any[])[0]?.cnt || 0);
    const thisMonthVal = Number((thisMonth as any[])[0]?.cnt || 0);
    const lastMonthVal = Number((lastMonth as any[])[0]?.cnt || 0);
    const thisYearVal = Number((thisYear as any[])[0]?.cnt || 0);
    const lastYearVal = Number((lastYear as any[])[0]?.cnt || 0);

    const yearlyGrowth = calcChange(thisYearVal, lastYearVal);

    // Generate insight based on new patient patterns
    let insight = 'Patient growth is steady across the week.';
    try {
      const dayPattern: any[] = await database.execute(sql`
        SELECT
          TO_CHAR(${AppointmentModel.appointmentDate}, 'Dy') as day_name,
          COUNT(DISTINCT ${AppointmentModel.patientId}) as cnt
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${query.startDate + ' 00:00:00'} AND ${query.endDate + ' 23:59:59'}
          AND ${AppointmentModel.patientId} IN (
            SELECT ${AppointmentModel.patientId}
            FROM ${AppointmentModel}
            WHERE ${AppointmentModel.clinicId} = ${clinicId}
            GROUP BY ${AppointmentModel.patientId}
            HAVING MIN(${AppointmentModel.appointmentDate}) >= ${query.startDate + ' 00:00:00'}
          )
          ${doctorFilter}
        GROUP BY day_name
        ORDER BY cnt DESC
        LIMIT 2
      `);

      if (dayPattern.length >= 2) {
        insight = `New patient growth is higher on ${dayPattern[0].day_name.trim()}s and ${dayPattern[1].day_name.trim()}s.`;
      } else if (dayPattern.length === 1) {
        insight = `New patient growth is highest on ${dayPattern[0].day_name.trim()}s.`;
      }
    } catch (err) {
      logger.warn('[ReportsPatients] Error generating insight', err);
    }

    return {
      thisWeek: {
        value: thisWeekVal,
        change: calcChange(thisWeekVal, lastWeekVal).change,
      },
      lastWeek: { value: lastWeekVal },
      thisMonth: {
        value: thisMonthVal,
        change: calcChange(thisMonthVal, lastMonthVal).change,
      },
      lastMonth: { value: lastMonthVal },
      thisYear: { value: thisYearVal, change: yearlyGrowth.change },
      lastYear: { value: lastYearVal },
      yearlyGrowth: {
        value: yearlyGrowth.change,
        label: 'Patient growth this year',
      },
      insight,
    };
  }
}
