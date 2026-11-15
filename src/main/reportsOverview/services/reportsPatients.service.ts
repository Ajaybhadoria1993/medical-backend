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
import {
  asOfEnd,
  buildComparisonRange,
  calcChange,
  DateRange,
  firstVisitJoin,
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
  spanLabel,
} from '../utils/reportsTrend.utils';

const CACHE_TTL = 120; // 2 min
const CACHE_TTL_TREND = 120; // 2 min

/** Fewer new patients than this and a weekday "pattern" is noise, so no insight is shown. */
const MIN_INSIGHT_SAMPLE = 5;
/** A patient with no appointment in this many days (as of the range end) is inactive. */
const INACTIVE_DAYS = 90;

type AnyPatientsQuery = ReportsPatientsQueryDto | ReportsPatientsTrendQueryDto;

// 'YYYY-MM-DD' day maths in UTC, so the server's own zone never shifts a day.
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const utcDay = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);
const addDays = (s: string, n: number) => {
  const d = utcDay(s);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
};
const ymdOf = (y: number, m0: number, d: number) =>
  ymd(new Date(Date.UTC(y, m0, d)));
const lastDayOf = (y: number, m0: number) =>
  new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const pct = (n: number, of: number) =>
  of ? parseFloat(((n / of) * 100).toFixed(1)) : 0;

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
    query.compareStartDate || 'auto',
    query.compareEndDate || 'auto',
    query.department || 'all',
    query.doctorId || 'all',
  ].join(':');
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
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[ReportsPatients] Redis read error', err);
    }

    const ranges = buildComparisonRange(query);
    const { primary, comparison } = ranges;

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
      wholeRangeValues(ranges, (current) =>
        this.getMetrics(clinicId, current, comparison, query)
      ),
      this.getPatientTrend(clinicId, primary, comparison, query, 'auto'),
      this.getAgeDistribution(clinicId, primary, query),
      this.getGenderDistribution(clinicId, primary, query),
      this.getTopCities(clinicId, primary, query),
      this.getNewVsReturning(clinicId, primary, query, 'auto'),
      this.getVisitFrequency(clinicId, primary, query),
      this.getLastVisitRecency(clinicId, primary, query),
      this.getGrowthSummary(clinicId, primary, query),
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
      // "As of" figures (active, inactive, recency) stop here: the range end, or today if sooner.
      asOf: spanLabel(
        calendarDay(asOfEnd(primary)),
        calendarDay(asOfEnd(primary))
      ),
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
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[ReportsPatients] Redis read error for trend', err);
    }

    const { primary, comparison } = buildComparisonRange(query);
    const result =
      query.type === 'patients'
        ? await this.getPatientTrend(
            clinicId,
            primary,
            comparison,
            query,
            query.period
          )
        : await this.getNewVsReturning(clinicId, primary, query, query.period);

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
    const join = serviceJoin(query);
    const scope = scopeFilter(query);

    // Totals count every status, as the Dashboard does; new = first visit at the clinic.
    const countsFor = (range: DateRange) =>
      database.execute(sql`
        SELECT
          COUNT(DISTINCT ${AppointmentModel.patientId}) as total_patients,
          COUNT(DISTINCT CASE WHEN fv.first_visit >= ${range.start} THEN ${AppointmentModel.patientId} END) as new_patients,
          COUNT(${AppointmentModel.id}) as appointments
        FROM ${AppointmentModel}
        ${join}
        ${firstVisitJoin(clinicId, query.doctorId)}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${range.start} AND ${range.end}
          ${scope}
      `) as Promise<any[]>;

    // Active = an appointment in the 90 days up to the as-of day (future bookings don't count).
    const activeAsOf = (asOf: string) =>
      database.execute(sql`
        SELECT COUNT(DISTINCT ${AppointmentModel.patientId}) as cnt
        FROM ${AppointmentModel}
        ${join}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${addDays(asOf, -INACTIVE_DAYS) + ' 00:00:00'} AND ${asOf + ' 23:59:59'}
          ${scope}
      `) as Promise<any[]>;

    // Inactive = seen before, but no appointment in the 90 days up to the as-of day.
    const inactiveAsOf = (asOf: string) =>
      database.execute(sql`
        SELECT COUNT(*) as cnt FROM (
          SELECT ${AppointmentModel.patientId}
          FROM ${AppointmentModel}
          ${join}
          WHERE ${AppointmentModel.clinicId} = ${clinicId}
            AND ${AppointmentModel.appointmentDate} <= ${asOf + ' 23:59:59'}
            ${scope}
          GROUP BY ${AppointmentModel.patientId}
          HAVING MAX(${AppointmentModel.appointmentDate}) < ${addDays(asOf, -INACTIVE_DAYS) + ' 00:00:00'}
        ) sub
      `) as Promise<any[]>;

    const asOf = asOfEnd(primary).slice(0, 10);
    const prevAsOf = comparison.end.slice(0, 10);
    const [cur, prev, active, prevActive, inactive, prevInactive] =
      await Promise.all([
        countsFor(primary),
        countsFor(comparison),
        activeAsOf(asOf),
        activeAsOf(prevAsOf),
        inactiveAsOf(asOf),
        inactiveAsOf(prevAsOf),
      ]);

    const n = (rows: any[], key: string) => Number(rows[0]?.[key] || 0);
    const curTotal = n(cur, 'total_patients');
    const prevTotal = n(prev, 'total_patients');
    const curNew = n(cur, 'new_patients');
    const prevNew = n(prev, 'new_patients');
    const curAvg = curTotal
      ? parseFloat((n(cur, 'appointments') / curTotal).toFixed(1))
      : 0;
    const prevAvg = prevTotal
      ? parseFloat((n(prev, 'appointments') / prevTotal).toFixed(1))
      : 0;
    const metric = (value: number, previous: number) => ({
      value,
      ...calcChange(value, previous),
    });

    return {
      totalPatients: metric(curTotal, prevTotal),
      newPatients: metric(curNew, prevNew),
      returningPatients: metric(curTotal - curNew, prevTotal - prevNew),
      activePatients: metric(n(active, 'cnt'), n(prevActive, 'cnt')),
      inactivePatients: metric(n(inactive, 'cnt'), n(prevInactive, 'cnt')),
      avgVisitsPerPatient: metric(curAvg, prevAvg),
    };
  }

  // ─── PATIENT TREND ───────────────────────────────────────────────────────────

  private static async getPatientTrend(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: AnyPatientsQuery,
    period: string
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

    const bucketsFor = (range: DateRange) =>
      database.execute(sql`
        SELECT
          date_trunc(${sql.raw(`'${truncUnit}'`)}, ${AppointmentModel.appointmentDate}) as dt,
          COUNT(DISTINCT ${AppointmentModel.patientId}) as cnt
        FROM ${AppointmentModel}
        ${serviceJoin(query)}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${range.start} AND ${range.end}
          ${scopeFilter(query)}
        GROUP BY dt
      `) as Promise<any[]>;

    const [current, previous] = await Promise.all([
      bucketsFor(primary),
      bucketsFor(comparison),
    ]);
    return {
      ...slotMeta(primarySlots, comparisonSlots, primary, comparison),
      currentPeriod: mapDataToSlots(current, primarySlots, truncUnit),
      previousPeriod: mapDataToSlots(previous, comparisonSlots, truncUnit),
    };
  }

  // ─── AGE / GENDER / CITY (patients seen in the range) ───────────────────────

  private static async getAgeDistribution(
    clinicId: string,
    primary: DateRange,
    query: ReportsPatientsQueryDto
  ) {
    // "Not Recorded" stays in, so the slices add up to Total Patients.
    const rows: any[] = await database.execute(sql`
      SELECT
        CASE
          WHEN ${UserProfileModel.age} IS NULL THEN 'Not Recorded'
          WHEN ${UserProfileModel.age} <= 18 THEN '0–18 Years'
          WHEN ${UserProfileModel.age} <= 30 THEN '19–30 Years'
          WHEN ${UserProfileModel.age} <= 45 THEN '31–45 Years'
          WHEN ${UserProfileModel.age} <= 60 THEN '46–60 Years'
          ELSE '60+ Years'
        END as age_group,
        CASE
          WHEN ${UserProfileModel.age} IS NULL THEN 6
          WHEN ${UserProfileModel.age} <= 18 THEN 1
          WHEN ${UserProfileModel.age} <= 30 THEN 2
          WHEN ${UserProfileModel.age} <= 45 THEN 3
          WHEN ${UserProfileModel.age} <= 60 THEN 4
          ELSE 5
        END as sort_order,
        COUNT(DISTINCT ${AppointmentModel.patientId}) as patients
      FROM ${AppointmentModel}
      ${serviceJoin(query)}
      LEFT JOIN ${UserProfileModel} ON ${UserProfileModel.userId} = ${AppointmentModel.patientId}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${scopeFilter(query)}
      GROUP BY age_group, sort_order
      ORDER BY sort_order
    `);
    const total = rows.reduce((sum, r) => sum + Number(r.patients), 0);
    return rows.map((r) => ({
      label: r.age_group,
      value: Number(r.patients),
      percentage: pct(Number(r.patients), total),
    }));
  }

  private static async getGenderDistribution(
    clinicId: string,
    primary: DateRange,
    query: ReportsPatientsQueryDto
  ) {
    // Spellings merged ("male"/"Male"); a blank gender is "Not Recorded", never "Other".
    const rows: any[] = await database.execute(sql`
      SELECT
        COALESCE(INITCAP(NULLIF(TRIM(${UserProfileModel.gender}), '')), 'Not Recorded') as gender,
        COUNT(DISTINCT ${AppointmentModel.patientId}) as patients
      FROM ${AppointmentModel}
      ${serviceJoin(query)}
      LEFT JOIN ${UserProfileModel} ON ${UserProfileModel.userId} = ${AppointmentModel.patientId}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${scopeFilter(query)}
      GROUP BY 1
      ORDER BY patients DESC
    `);
    const total = rows.reduce((sum, r) => sum + Number(r.patients), 0);
    return rows.map((r) => ({
      label: r.gender,
      value: Number(r.patients),
      percentage: pct(Number(r.patients), total),
    }));
  }

  private static async getTopCities(
    clinicId: string,
    primary: DateRange,
    query: ReportsPatientsQueryDto
  ) {
    const rows: any[] = await database.execute(sql`
      SELECT
        COALESCE(INITCAP(NULLIF(TRIM(${UserProfileModel.city}), '')), 'Not Recorded') as city,
        COUNT(DISTINCT ${AppointmentModel.patientId}) as patients
      FROM ${AppointmentModel}
      ${serviceJoin(query)}
      LEFT JOIN ${UserProfileModel} ON ${UserProfileModel.userId} = ${AppointmentModel.patientId}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${scopeFilter(query)}
      GROUP BY 1
      ORDER BY patients DESC
    `);
    const total = rows.reduce((sum, r) => sum + Number(r.patients), 0);
    const top = rows.slice(0, 4).map((r) => ({
      city: r.city,
      patients: Number(r.patients),
      percentage: pct(Number(r.patients), total),
    }));
    const otherCount = rows
      .slice(4)
      .reduce((sum, r) => sum + Number(r.patients), 0);
    if (otherCount > 0) {
      top.push({
        city: 'Other Cities',
        patients: otherCount,
        percentage: pct(otherCount, total),
      });
    }
    return top;
  }

  // ─── NEW VS RETURNING ────────────────────────────────────────────────────────

  private static async getNewVsReturning(
    clinicId: string,
    primary: DateRange,
    query: AnyPatientsQuery,
    period: string
  ) {
    const days = rangeDays(primary);
    const truncUnit = resolveTruncUnit(period, days);
    const slots = generateDateSlots(
      primary.start,
      primary.end,
      truncUnit,
      days
    );

    // Same rule as the New Patients card: new = first visit at the clinic falls in the range.
    const rows: any[] = await database.execute(sql`
      SELECT
        date_trunc(${sql.raw(`'${truncUnit}'`)}, ${AppointmentModel.appointmentDate}) as dt,
        COUNT(DISTINCT ${AppointmentModel.patientId}) FILTER (WHERE fv.first_visit >= ${primary.start}) as new_cnt,
        COUNT(DISTINCT ${AppointmentModel.patientId}) FILTER (WHERE fv.first_visit < ${primary.start}) as returning_cnt
      FROM ${AppointmentModel}
      ${serviceJoin(query)}
      ${firstVisitJoin(clinicId, query.doctorId)}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${scopeFilter(query)}
      GROUP BY dt
    `);

    return {
      labels: slots.map((s) => s.label),
      details: slots.map((s) => s.detail),
      newPatients: mapDataToSlots(
        rows.map((r) => ({ dt: r.dt, cnt: r.new_cnt })),
        slots,
        truncUnit
      ),
      returningPatients: mapDataToSlots(
        rows.map((r) => ({ dt: r.dt, cnt: r.returning_cnt })),
        slots,
        truncUnit
      ),
    };
  }

  // ─── HOW OFTEN PATIENTS BOOKED ───────────────────────────────────────────────

  /** Every bucket, zeros included, so a missing row never reads as a gap. */
  private static fixedBuckets(labels: string[], rows: any[]) {
    const counts = labels.map((_, i) =>
      Number(rows.find((r) => Number(r.bucket) === i)?.patients || 0)
    );
    const total = counts.reduce((sum, c) => sum + c, 0);
    return labels.map((label, i) => ({
      label,
      patients: counts[i],
      percentage: pct(counts[i], total),
    }));
  }

  private static async getVisitFrequency(
    clinicId: string,
    primary: DateRange,
    query: ReportsPatientsQueryDto
  ) {
    // Every status counts, like the totals, so these are bookings, not attended visits.
    const rows: any[] = await database.execute(sql`
      SELECT
        CASE WHEN visit_count = 1 THEN 0 WHEN visit_count <= 3 THEN 1 WHEN visit_count <= 6 THEN 2 ELSE 3 END as bucket,
        COUNT(*) as patients
      FROM (
        SELECT ${AppointmentModel.patientId}, COUNT(*) as visit_count
        FROM ${AppointmentModel}
        ${serviceJoin(query)}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
          ${scopeFilter(query)}
        GROUP BY ${AppointmentModel.patientId}
      ) sub
      GROUP BY bucket
    `);
    return this.fixedBuckets(
      ['Once', '2–3 times', '4–6 times', '7+ times'],
      rows
    ).map((b) => ({
      frequency: b.label,
      patients: b.patients,
      percentage: b.percentage,
    }));
  }

  // ─── WHEN PATIENTS LAST CAME ─────────────────────────────────────────────────

  private static async getLastVisitRecency(
    clinicId: string,
    primary: DateRange,
    query: ReportsPatientsQueryDto
  ) {
    // Every patient the clinic has seen, as of the range end (or today); future bookings ignored.
    // Over 90 days matches the Inactive card.
    const asOf = asOfEnd(primary).slice(0, 10);
    const gap = sql`(${asOf}::date - last_visit::date)`;
    const rows: any[] = await database.execute(sql`
      SELECT
        CASE WHEN ${gap} <= 30 THEN 0 WHEN ${gap} <= 90 THEN 1 WHEN ${gap} <= 180 THEN 2 ELSE 3 END as bucket,
        COUNT(*) as patients
      FROM (
        SELECT ${AppointmentModel.patientId}, MAX(${AppointmentModel.appointmentDate}) as last_visit
        FROM ${AppointmentModel}
        ${serviceJoin(query)}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} <= ${asOf + ' 23:59:59'}
          ${scopeFilter(query)}
        GROUP BY ${AppointmentModel.patientId}
      ) sub
      GROUP BY bucket
    `);
    return this.fixedBuckets(
      [
        'In the last 30 days',
        '31–90 days ago',
        '91–180 days ago (Inactive)',
        'Over 180 days ago (Inactive)',
      ],
      rows
    ).map((b) => ({
      lastVisit: b.label,
      patients: b.patients,
      percentage: b.percentage,
    }));
  }
  // ─── GROWTH SUMMARY ──────────────────────────────────────────────────────────

  /** Unique patients for the week, month and year the filter ends in, each against the same
   *  days of the unit before, so every % matches the two figures shown beside it. */
  private static async getGrowthSummary(
    clinicId: string,
    primary: DateRange,
    query: ReportsPatientsQueryDto
  ) {
    const join = serviceJoin(query);
    const scope = scopeFilter(query);
    const end = query.endDate;
    const [y, m, d] = end.split('-').map(Number);
    const m0 = m - 1;

    const uniquePatients = async (from: string, to: string) => {
      const rows: any[] = await database.execute(sql`
        SELECT COUNT(DISTINCT ${AppointmentModel.patientId}) as cnt
        FROM ${AppointmentModel}
        ${join}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${from + ' 00:00:00'} AND ${to + ' 23:59:59'}
          ${scope}
      `);
      return Number(rows[0]?.cnt || 0);
    };
    const span = (from: string, to: string) =>
      spanLabel(calendarDay(from), calendarDay(to));
    const tile = async (
      label: string,
      previousLabel: string,
      from: string,
      prevFrom: string,
      prevTo: string
    ) => {
      const [value, previousValue] = await Promise.all([
        uniquePatients(from, end),
        uniquePatients(prevFrom, prevTo),
      ]);
      return {
        label,
        range: span(from, end),
        value,
        previousLabel,
        previousRange: span(prevFrom, prevTo),
        previousValue,
        ...calcChange(value, previousValue),
      };
    };

    // Week (Monday-aligned), month and year, each cut at the filter's end day.
    const dow = utcDay(end).getUTCDay();
    const weekStart = addDays(end, dow === 0 ? -6 : 1 - dow);
    const weekDaysIn = Math.round(
      (utcDay(end).getTime() - utcDay(weekStart).getTime()) / 86400000
    );
    const prevWeekStart = addDays(weekStart, -7);
    const prevMonthY = m0 === 0 ? y - 1 : y;
    const prevMonth0 = m0 === 0 ? 11 : m0 - 1;

    const [week, month, year] = await Promise.all([
      tile(
        'Week',
        'Week Before',
        weekStart,
        prevWeekStart,
        addDays(prevWeekStart, weekDaysIn)
      ),
      tile(
        'Month',
        'Month Before',
        ymdOf(y, m0, 1),
        ymdOf(prevMonthY, prevMonth0, 1),
        ymdOf(
          prevMonthY,
          prevMonth0,
          Math.min(d, lastDayOf(prevMonthY, prevMonth0))
        )
      ),
      tile(
        'Year',
        'Year Before',
        ymdOf(y, 0, 1),
        ymdOf(y - 1, 0, 1),
        ymdOf(y - 1, m0, Math.min(d, lastDayOf(y - 1, m0)))
      ),
    ]);

    // Real unique patients per month for the 12 months ending in the filter's month.
    const monthsFrom = ymdOf(y, m0 - 11, 1) + ' 00:00:00';
    const monthsTo = ymdOf(y, m0, lastDayOf(y, m0)) + ' 23:59:59';
    const monthSlots = generateDateSlots(monthsFrom, monthsTo, 'month', 365);
    const monthRows: any[] = await database.execute(sql`
      SELECT
        date_trunc('month', ${AppointmentModel.appointmentDate}) as dt,
        COUNT(DISTINCT ${AppointmentModel.patientId}) as cnt
      FROM ${AppointmentModel}
      ${join}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${monthsFrom} AND ${monthsTo}
        ${scope}
      GROUP BY dt
    `);
    const monthValues = mapDataToSlots(monthRows, monthSlots, 'month');

    return {
      tiles: [week, month, year],
      monthly: monthSlots.map((s, i) => ({
        label: s.label,
        value: monthValues[i],
      })),
      insight: await this.getNewPatientInsight(clinicId, primary, query),
    };
  }

  /** The weekday most new patients first came, with its share; null below the sample or on a tie. */
  private static async getNewPatientInsight(
    clinicId: string,
    primary: DateRange,
    query: ReportsPatientsQueryDto
  ): Promise<string | null> {
    try {
      const rows: any[] = await database.execute(sql`
        SELECT
          EXTRACT(ISODOW FROM fv.first_visit)::int as dow,
          TO_CHAR(MIN(fv.first_visit), 'FMDay') as day_name,
          MIN(fv.first_visit)::date::text as first_day,
          COUNT(DISTINCT fv.first_visit::date)::int as days,
          COUNT(DISTINCT ${AppointmentModel.patientId})::int as cnt
        FROM ${AppointmentModel}
        ${serviceJoin(query)}
        ${firstVisitJoin(clinicId, query.doctorId)}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
          AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
          AND fv.first_visit BETWEEN ${primary.start} AND ${primary.end}
          ${scopeFilter(query)}
        GROUP BY dow
        ORDER BY cnt DESC
      `);
      const total = rows.reduce((sum, r) => sum + r.cnt, 0);
      const [top, second] = rows;
      if (
        !top ||
        total < MIN_INSIGHT_SAMPLE ||
        (second && second.cnt === top.cnt)
      )
        return null;
      const when =
        top.days > 1
          ? `${top.day_name}s`
          : calendarDay(top.first_day).toLocaleDateString('en-IN', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            });
      return `Most new patients first came on ${when} (${top.cnt} of ${total}).`;
    } catch (err) {
      logger.warn('[ReportsPatients] Error generating insight', err);
      return null;
    }
  }
}
