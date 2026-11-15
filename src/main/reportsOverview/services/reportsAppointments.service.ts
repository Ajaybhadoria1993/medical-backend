/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { UserModel } from '../../users/models/user.model';
import {
  ReportsAppointmentsQueryDto,
  ReportsAppointmentsTrendQueryDto,
} from '../schemas/reportsAppointments.schemas';
import logger from '../../../utils/logger';
import {
  buildComparisonRange,
  calcChange,
  rateChange,
  DateRange,
  wholeRangeValues,
} from '../utils/reportsPeriod.utils';
import {
  calendarDay,
  generateDateSlots,
  knownTimeOfDay,
  mapDataToSlots,
  padSlots,
  rangeDays,
  resolveTruncUnit,
  scopeFilter,
  serviceJoin,
  slotMeta,
} from '../utils/reportsTrend.utils';
import {
  bucketRowsByHour,
  formatHourClock12,
  formatHourSlot12,
  formatHourSlotShort,
} from '../../../utils/appointmentHours.utils';

const CACHE_TTL = 120; // 2 min
const CACHE_TTL_TREND = 120; // 2 min

type AnyAppointmentsQuery =
  ReportsAppointmentsQueryDto | ReportsAppointmentsTrendQueryDto;

const pct = (n: number, of: number) =>
  of ? parseFloat(((n / of) * 100).toFixed(1)) : 0;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Who marked a no-show, in words ("system" is the auto no-show job). */
const MARKED_BY_LABELS: Record<string, string> = {
  system: 'Auto (System)',
  doctor: 'Doctor',
  receptionist: 'Receptionist',
  admin: 'Admin',
};

/** Every calendar day of the range, grouped Monday-first (index 0 = Mon). */
function datesByWeekday(range: DateRange): Date[][] {
  const groups: Date[][] = DAY_NAMES.map(() => []);
  const last = calendarDay(range.end);
  for (
    const d = calendarDay(range.start);
    d <= last;
    d.setDate(d.getDate() + 1)
  ) {
    groups[(d.getDay() + 6) % 7].push(new Date(d));
  }
  return groups;
}

/** "Wed, 7 Oct 2026", "Wednesdays: 1, 8, 15 Oct 2026" or "5 Wednesdays, 2 Sep – 30 Sep 2026". */
function weekdayDetail(dates: Date[]): string {
  if (dates.length === 0) return 'Not in the selected dates';
  const full = (d: Date) =>
    d.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  if (dates.length === 1) return full(dates[0]);
  const plural = `${dates[0].toLocaleDateString('en-IN', { weekday: 'long' })}s`;
  const last = dates[dates.length - 1];
  const sameMonth = dates.every(
    (d) =>
      d.getMonth() === last.getMonth() && d.getFullYear() === last.getFullYear()
  );
  if (dates.length <= 5 && sameMonth) {
    const month = last.toLocaleDateString('en-IN', {
      month: 'short',
      year: 'numeric',
    });
    return `${plural}: ${dates.map((d) => d.getDate()).join(', ')} ${month}`;
  }
  const dm = (d: Date) =>
    d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  return `${dates.length} ${plural}, ${dm(dates[0])} – ${dm(last)}`;
}

/** Service + Doctor + Appointment Type, on top of the shared Service/Doctor scope. */
function scope(query: AnyAppointmentsQuery) {
  return sql`${scopeFilter(query)}
    ${query.appointmentType ? sql`AND ${AppointmentModel.appointmentType} = ${query.appointmentType}` : sql``}`;
}

/** WHERE clause every query here starts from: clinic, date range, filters. */
function inRange(
  clinicId: string,
  range: DateRange,
  query: AnyAppointmentsQuery
) {
  return sql`${AppointmentModel.clinicId} = ${clinicId}
    AND ${AppointmentModel.appointmentDate} BETWEEN ${range.start} AND ${range.end}
    ${scope(query)}`;
}

// Status groups shared by the cards and the donut, so their numbers always agree.
const STATUS_GROUP = sql`CASE
  WHEN ${AppointmentModel.appointmentStatus} = 'Completed' THEN 'Completed'
  WHEN ${AppointmentModel.appointmentStatus} IN ('Pending', 'Upcoming', 'Confirmed') THEN 'Pending'
  WHEN ${AppointmentModel.appointmentStatus} = 'Patient Arrived' THEN 'Arrived'
  WHEN ${AppointmentModel.appointmentStatus} = 'Rescheduled' THEN 'Rescheduled'
  WHEN ${AppointmentModel.appointmentStatus} = 'Cancelled' THEN 'Cancelled'
  ELSE 'No Show'
END`;
const STATUS_ORDER = [
  'Completed',
  'Pending',
  'Arrived',
  'Rescheduled',
  'Cancelled',
  'No Show',
];

function buildCacheKey(
  clinicId: string,
  query: ReportsAppointmentsQueryDto
): string {
  return [
    'reports:appointments',
    clinicId,
    query.startDate,
    query.endDate,
    query.compareStartDate || 'auto',
    query.compareEndDate || 'auto',
    query.department || 'all',
    query.doctorId || 'all',
    query.appointmentType || 'all',
  ].join(':');
}

function buildTrendCacheKey(
  clinicId: string,
  query: ReportsAppointmentsTrendQueryDto
): string {
  return [
    'reports:appointments:trend',
    clinicId,
    query.type,
    query.period,
    query.startDate,
    query.endDate,
    query.compareStartDate || 'auto',
    query.compareEndDate || 'auto',
    query.department || 'all',
    query.doctorId || 'all',
    query.appointmentType || 'all',
  ].join(':');
}

export class ReportsAppointmentsService {
  static async getAppointmentReports(
    clinicId: string,
    query: ReportsAppointmentsQueryDto
  ) {
    const cacheKey = buildCacheKey(clinicId, query);
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[ReportsAppointments] Redis read error', err);
    }

    const ranges = buildComparisonRange(query);
    const { primary, elapsed, comparison } = ranges;
    const [
      metrics,
      appointmentsTrend,
      statusDistribution,
      typeDistribution,
      topBookingTimeSlots,
      appointmentsByDay,
      topDoctors,
      noShowAnalysis,
      bottomMetrics,
      typeOptions,
    ] = await Promise.all([
      wholeRangeValues(ranges, (current) =>
        this.getMetrics(clinicId, current, comparison, query)
      ),
      this.getAppointmentsTrend(clinicId, primary, comparison, query, 'auto'),
      this.getStatusDistribution(clinicId, primary, query),
      this.getTypeDistribution(clinicId, primary, query),
      this.getTopBookingTimeSlots(clinicId, primary, query),
      this.getAppointmentsByDay(clinicId, primary, query),
      this.getTopDoctors(clinicId, primary, query),
      // Rates: upcoming visits would only dilute them, so these stop at today.
      this.getNoShowAnalysis(clinicId, elapsed, comparison, query),
      this.getBottomMetrics(clinicId, primary, elapsed, comparison, query),
      this.getTypeOptions(clinicId),
    ]);

    const result = {
      metrics,
      appointmentsTrend,
      statusDistribution,
      typeDistribution,
      topBookingTimeSlots,
      appointmentsByDay,
      topDoctors,
      noShowAnalysis,
      bottomMetrics,
      typeOptions,
    };
    try {
      await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(result));
    } catch (err) {
      logger.warn('[ReportsAppointments] Redis write error', err);
    }
    return result;
  }

  static async getAppointmentTrendData(
    clinicId: string,
    query: ReportsAppointmentsTrendQueryDto
  ) {
    const cacheKey = buildTrendCacheKey(clinicId, query);
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[ReportsAppointments] Redis read error', err);
    }

    const { primary, comparison } = buildComparisonRange(query);
    let result;
    switch (query.type) {
      case 'byDay':
        result = await this.getByDayTrend(clinicId, primary, comparison, query);
        break;
      case 'timeSlots':
        result = await this.getTimeSlotsTrend(
          clinicId,
          primary,
          comparison,
          query
        );
        break;
      case 'doctors':
        result = await this.getDoctorsTrend(
          clinicId,
          primary,
          comparison,
          query
        );
        break;
      default:
        result = await this.getAppointmentsTrend(
          clinicId,
          primary,
          comparison,
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
      logger.warn('[ReportsAppointments] Redis write error', err);
    }
    return result;
  }

  // ─── METRICS ─────────────────────────────────────────────────────────────────

  private static async getMetrics(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsAppointmentsQueryDto
  ) {
    // Slot length is the booked length of a time-slot appointment; tokens have none.
    const countsFor = (range: DateRange) =>
      database.execute(sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE ${STATUS_GROUP} = 'Completed') as completed,
          COUNT(*) FILTER (WHERE ${STATUS_GROUP} = 'Pending') as pending,
          COUNT(*) FILTER (WHERE ${STATUS_GROUP} = 'Cancelled') as cancelled,
          COUNT(*) FILTER (WHERE ${STATUS_GROUP} = 'No Show') as no_show,
          AVG(NULLIF(TRIM(${AppointmentModel.appointmentDurationMinutes}), '')::numeric)
            FILTER (WHERE ${AppointmentModel.tokenNo} IS NULL) as avg_slot,
          COUNT(NULLIF(TRIM(${AppointmentModel.appointmentDurationMinutes}), ''))
            FILTER (WHERE ${AppointmentModel.tokenNo} IS NULL) as with_slot
        FROM ${AppointmentModel}
        ${serviceJoin(query)}
        WHERE ${inRange(clinicId, range, query)}
      `) as Promise<any[]>;

    const [[c = {}], [p = {}]] = await Promise.all([
      countsFor(primary),
      countsFor(comparison),
    ]);
    const metric = (key: string) => {
      const value = Number(c[key] || 0);
      return { value, ...calcChange(value, Number(p[key] || 0)) };
    };
    const slot = Math.round(Number(c.avg_slot || 0));
    const prevSlot = Math.round(Number(p.avg_slot || 0));

    return {
      totalAppointments: metric('total'),
      completed: metric('completed'),
      pending: metric('pending'),
      cancelled: metric('cancelled'),
      noShow: metric('no_show'),
      // null = no slot lengths recorded (token bookings), shown as "—", never "0 min".
      avgDuration: Number(c.with_slot || 0)
        ? { value: slot, ...calcChange(slot, prevSlot) }
        : { value: null, change: 0, changeType: 'neutral' as const },
    };
  }

  // ─── TREND ───────────────────────────────────────────────────────────────────

  private static async getAppointmentsTrend(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: AnyAppointmentsQuery,
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
        SELECT date_trunc(${sql.raw(`'${truncUnit}'`)}, ${AppointmentModel.appointmentDate}) as dt, COUNT(*) as cnt
        FROM ${AppointmentModel}
        ${serviceJoin(query)}
        WHERE ${inRange(clinicId, range, query)}
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

  // ─── STATUS / TYPE ───────────────────────────────────────────────────────────

  private static async getStatusDistribution(
    clinicId: string,
    primary: DateRange,
    query: ReportsAppointmentsQueryDto
  ) {
    // Every status lands in a group, so the slices add up to Total Appointments.
    const rows: any[] = await database.execute(sql`
      SELECT ${STATUS_GROUP} as status, COUNT(*) as cnt
      FROM ${AppointmentModel}
      ${serviceJoin(query)}
      WHERE ${inRange(clinicId, primary, query)}
      GROUP BY 1
    `);
    const total = rows.reduce((sum, r) => sum + Number(r.cnt), 0);
    return STATUS_ORDER.map((label) => {
      const value = Number(rows.find((r) => r.status === label)?.cnt || 0);
      return { label, value, percentage: pct(value, total) };
    }).filter(
      (s) =>
        s.value > 0 ||
        ['Completed', 'Pending', 'Cancelled', 'No Show'].includes(s.label)
    );
  }

  private static async getTypeDistribution(
    clinicId: string,
    primary: DateRange,
    query: ReportsAppointmentsQueryDto
  ) {
    const rows: any[] = await database.execute(sql`
      SELECT INITCAP(${AppointmentModel.appointmentType}) as type, COUNT(*) as cnt
      FROM ${AppointmentModel}
      ${serviceJoin(query)}
      WHERE ${inRange(clinicId, primary, query)}
      GROUP BY 1 ORDER BY cnt DESC
    `);
    const total = rows.reduce((sum, r) => sum + Number(r.cnt), 0);
    return rows.map((r) => ({
      label: r.type,
      value: Number(r.cnt),
      percentage: pct(Number(r.cnt), total),
    }));
  }

  /** The clinic's real appointment types, for the filter dropdown. */
  private static async getTypeOptions(clinicId: string) {
    const rows: any[] = await database.execute(sql`
      SELECT DISTINCT ${AppointmentModel.appointmentType} as type
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId} AND ${AppointmentModel.appointmentType} IS NOT NULL
      ORDER BY 1
    `);
    return rows.map((r) => ({
      label: String(r.type).replace(/^\w/, (ch) => ch.toUpperCase()),
      value: r.type,
    }));
  }

  // ─── BUSIEST HOURS ───────────────────────────────────────────────────────────

  private static async getTopBookingTimeSlots(
    clinicId: string,
    primary: DateRange,
    query: ReportsAppointmentsQueryDto
  ) {
    const rows: any[] = await database.execute(sql`
      SELECT ${knownTimeOfDay} as time, COUNT(*) as cnt
      FROM ${AppointmentModel}
      ${serviceJoin(query)}
      WHERE ${inRange(clinicId, primary, query)}
        AND ${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow', 'Missed')
      GROUP BY 1
    `);
    const hours = bucketRowsByHour(rows);
    const total = hours.reduce((sum, h) => sum + h.cnt, 0);
    const slots = hours.slice(0, 5).map((h) => ({
      timeSlot: formatHourSlot12(h.hour),
      appointments: h.cnt,
      percentage: pct(h.cnt, total),
    }));
    const others = hours.slice(5).reduce((sum, h) => sum + h.cnt, 0);
    if (others > 0)
      slots.push({
        timeSlot: 'Other Hours',
        appointments: others,
        percentage: pct(others, total),
      });
    return slots;
  }

  // ─── BY WEEKDAY ──────────────────────────────────────────────────────────────

  private static async getAppointmentsByDay(
    clinicId: string,
    primary: DateRange,
    query: ReportsAppointmentsQueryDto
  ) {
    const rows: any[] = await database.execute(sql`
      SELECT EXTRACT(ISODOW FROM ${AppointmentModel.appointmentDate})::int as dow, COUNT(*) as cnt
      FROM ${AppointmentModel}
      ${serviceJoin(query)}
      WHERE ${inRange(clinicId, primary, query)}
      GROUP BY 1
    `);
    const dates = datesByWeekday(primary);
    return DAY_NAMES.map((day, i) => ({
      day,
      appointments: Number(rows.find((r) => r.dow === i + 1)?.cnt || 0),
      // The real dates behind the bar, for the tooltip.
      detail: weekdayDetail(dates[i]),
    }));
  }

  // ─── TOP DOCTORS ─────────────────────────────────────────────────────────────

  private static async getTopDoctors(
    clinicId: string,
    primary: DateRange,
    query: ReportsAppointmentsQueryDto
  ) {
    const rows: any[] = await database.execute(sql`
      SELECT
        ${AppointmentModel.doctorId} as doctor_id,
        ${UserModel.name} as doctor_name,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE ${AppointmentModel.appointmentStatus} = 'Completed') as completed
      FROM ${AppointmentModel}
      INNER JOIN ${UserModel} ON ${UserModel.id} = ${AppointmentModel.doctorId}
      ${serviceJoin(query)}
      WHERE ${inRange(clinicId, primary, query)}
      GROUP BY ${AppointmentModel.doctorId}, ${UserModel.name}
      ORDER BY total DESC
      LIMIT 5
    `);
    return rows.map((r) => ({
      doctor: r.doctor_name,
      doctorId: r.doctor_id,
      appointments: Number(r.total),
      completed: Number(r.completed),
      completionRate: pct(Number(r.completed), Number(r.total)),
    }));
  }

  // ─── NO SHOWS ────────────────────────────────────────────────────────────────

  private static async getNoShowAnalysis(
    clinicId: string,
    elapsed: DateRange,
    comparison: DateRange,
    query: ReportsAppointmentsQueryDto
  ) {
    // Rate = no-shows ÷ appointments that weren't cancelled (a cancelled visit can't be a no-show).
    const rateFor = (range: DateRange) =>
      database.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE ${AppointmentModel.appointmentStatus} <> 'Cancelled') as eligible,
          COUNT(*) FILTER (WHERE ${AppointmentModel.appointmentStatus} IN ('NoShow', 'Missed')) as no_shows
        FROM ${AppointmentModel}
        ${serviceJoin(query)}
        WHERE ${inRange(clinicId, range, query)}
      `) as Promise<any[]>;

    const [[cur = {}], [prev = {}], breakdown] = await Promise.all([
      rateFor(elapsed),
      rateFor(comparison),
      database.execute(sql`
        SELECT COALESCE(${AppointmentModel.noShowMarkedBy}::text, 'system') as marked_by, COUNT(*) as cnt
        FROM ${AppointmentModel}
        ${serviceJoin(query)}
        WHERE ${inRange(clinicId, elapsed, query)}
          AND ${AppointmentModel.appointmentStatus} IN ('NoShow', 'Missed')
        GROUP BY 1 ORDER BY cnt DESC
      `) as Promise<any[]>,
    ]);

    const noShows = Number(cur.no_shows || 0);
    const eligible = Number(cur.eligible || 0);
    const rate = pct(noShows, eligible);
    const prevRate = pct(
      Number(prev.no_shows || 0),
      Number(prev.eligible || 0)
    );
    // A rate moves in percentage points, not a % of a %.
    const noShowRateChange = rateChange(
      rate,
      prevRate,
      Number(prev.eligible || 0) > 0
    );

    return {
      total: noShows,
      eligible,
      rate,
      rateChange: noShowRateChange.change,
      rateChangeType: noShowRateChange.changeType,
      breakdown: breakdown.map((r) => ({
        label: MARKED_BY_LABELS[r.marked_by] ?? r.marked_by,
        value: Number(r.cnt),
        percentage: pct(Number(r.cnt), noShows),
      })),
    };
  }

  // ─── BOOKING PATTERNS ────────────────────────────────────────────────────────

  private static async getBottomMetrics(
    clinicId: string,
    primary: DateRange,
    elapsed: DateRange,
    comparison: DateRange,
    query: ReportsAppointmentsQueryDto
  ) {
    // Advance = booked on an earlier day than the visit; same-day covers walk-ins and same-day online.
    const advance = sql`${AppointmentModel.createdAt}::date < ${AppointmentModel.appointmentDate}::date`;
    const patternsFor = (range: DateRange) =>
      database.execute(sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE ${advance}) as advance,
          COUNT(*) FILTER (WHERE ${AppointmentModel.appointmentStatus} = 'Rescheduled') as rescheduled,
          COALESCE(AVG(${AppointmentModel.appointmentDate}::date - ${AppointmentModel.createdAt}::date) FILTER (WHERE ${advance}), 0) as avg_days
        FROM ${AppointmentModel}
        ${serviceJoin(query)}
        WHERE ${inRange(clinicId, range, query)}
      `) as Promise<any[]>;

    // Completion rate is a rate, so it compares only the days so far.
    const completionFor = (range: DateRange) =>
      database.execute(sql`
        SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE ${AppointmentModel.appointmentStatus} = 'Completed') as completed
        FROM ${AppointmentModel}
        ${serviceJoin(query)}
        WHERE ${inRange(clinicId, range, query)}
      `) as Promise<any[]>;

    const [
      [cur = {}],
      [prev = {}],
      [done = {}],
      [prevDone = {}],
      peakDays,
      peakTimeRows,
    ] = await Promise.all([
      patternsFor(primary),
      patternsFor(comparison),
      completionFor(elapsed),
      completionFor(comparison),
      database.execute(sql`
        SELECT
          TO_CHAR(MIN(${AppointmentModel.appointmentDate}), 'FMDay') as day_name,
          MIN(${AppointmentModel.appointmentDate})::date::text as first_day,
          COUNT(DISTINCT ${AppointmentModel.appointmentDate}::date)::int as days,
          COUNT(*)::int as cnt
        FROM ${AppointmentModel}
        ${serviceJoin(query)}
        WHERE ${inRange(clinicId, primary, query)}
        GROUP BY EXTRACT(ISODOW FROM ${AppointmentModel.appointmentDate})
        ORDER BY cnt DESC LIMIT 1
      `) as Promise<any[]>,
      database.execute(sql`
        SELECT ${knownTimeOfDay} as time, COUNT(*) as cnt
        FROM ${AppointmentModel}
        ${serviceJoin(query)}
        WHERE ${inRange(clinicId, primary, query)}
          AND ${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow', 'Missed')
        GROUP BY 1
      `) as Promise<any[]>,
    ]);

    const total = Number(cur.total || 0);
    const advanceCount = Number(cur.advance || 0);
    const rescheduled = Number(cur.rescheduled || 0);
    const avgDays = parseFloat(Number(cur.avg_days || 0).toFixed(1));
    const prevAvgDays = parseFloat(Number(prev.avg_days || 0).toFixed(1));
    const completion = pct(
      Number(done.completed || 0),
      Number(done.total || 0)
    );
    const prevCompletion = pct(
      Number(prevDone.completed || 0),
      Number(prevDone.total || 0)
    );
    const [peakHour] = bucketRowsByHour(peakTimeRows);
    const peak = peakDays[0];

    return {
      advanceBookings: {
        value: advanceCount,
        percentage: pct(advanceCount, total),
      },
      walkIn: {
        value: total - advanceCount,
        percentage: pct(total - advanceCount, total),
      },
      rescheduled: { value: rescheduled, percentage: pct(rescheduled, total) },
      avgAdvanceDays: { value: avgDays, ...calcChange(avgDays, prevAvgDays) },
      // A weekday seen once in the range is named by its date, not as a habit ("Thursdays").
      peakDay: {
        day: !peak
          ? 'N/A'
          : peak.days > 1
            ? `${peak.day_name}s`
            : calendarDay(peak.first_day).toLocaleDateString('en-IN', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              }),
        appointments: Number(peak?.cnt || 0),
      },
      peakTime: {
        time: peakHour ? formatHourClock12(peakHour.hour) : 'N/A',
        appointments: peakHour?.cnt ?? 0,
      },
      utilizationRate: {
        value: completion,
        ...rateChange(
          completion,
          prevCompletion,
          Number(prevDone.total || 0) > 0
        ),
      },
    };
  }

  // ─── TREND SUB-ENDPOINTS (by weekday, hour, doctor) ──────────────────────────

  private static async getByDayTrend(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsAppointmentsTrendQueryDto
  ) {
    const countsFor = async (range: DateRange) => {
      const rows: any[] = await database.execute(sql`
        SELECT EXTRACT(ISODOW FROM ${AppointmentModel.appointmentDate})::int as dow, COUNT(*) as cnt
        FROM ${AppointmentModel}
        ${serviceJoin(query)}
        WHERE ${inRange(clinicId, range, query)}
        GROUP BY 1
      `);
      return DAY_NAMES.map((_, i) =>
        Number(rows.find((r) => r.dow === i + 1)?.cnt || 0)
      );
    };
    const [currentPeriod, previousPeriod] = await Promise.all([
      countsFor(primary),
      countsFor(comparison),
    ]);
    return { labels: DAY_NAMES, currentPeriod, previousPeriod };
  }

  private static async getTimeSlotsTrend(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsAppointmentsTrendQueryDto
  ) {
    const hoursFor = async (range: DateRange) =>
      bucketRowsByHour(
        await database.execute(sql`
          SELECT ${knownTimeOfDay} as time, COUNT(*) as cnt
          FROM ${AppointmentModel}
          ${serviceJoin(query)}
          WHERE ${inRange(clinicId, range, query)}
            AND ${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow', 'Missed')
          GROUP BY 1
        `)
      );
    const [cur, prev] = await Promise.all([
      hoursFor(primary),
      hoursFor(comparison),
    ]);
    const top = cur.slice(0, 5).map((h) => h.hour);
    const count = (list: typeof cur, hour: number) =>
      list.find((h) => h.hour === hour)?.cnt ?? 0;
    const othersOf = (list: typeof cur) =>
      list
        .filter((h) => !top.includes(h.hour))
        .reduce((sum, h) => sum + h.cnt, 0);
    return {
      labels: [...top.map(formatHourSlotShort), 'Other Hours'],
      currentPeriod: [...top.map((h) => count(cur, h)), othersOf(cur)],
      previousPeriod: [...top.map((h) => count(prev, h)), othersOf(prev)],
    };
  }

  private static async getDoctorsTrend(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsAppointmentsTrendQueryDto
  ) {
    const countsFor = (range: DateRange) =>
      database.execute(sql`
        SELECT ${AppointmentModel.doctorId} as doctor_id, ${UserModel.name} as doctor_name, COUNT(*) as cnt
        FROM ${AppointmentModel}
        INNER JOIN ${UserModel} ON ${UserModel.id} = ${AppointmentModel.doctorId}
        ${serviceJoin(query)}
        WHERE ${inRange(clinicId, range, query)}
        GROUP BY 1, 2 ORDER BY cnt DESC
      `) as Promise<any[]>;
    const [cur, prev] = await Promise.all([
      countsFor(primary),
      countsFor(comparison),
    ]);
    const top = cur.slice(0, 5);
    return {
      labels: top.map((r) => r.doctor_name),
      currentPeriod: top.map((r) => Number(r.cnt)),
      previousPeriod: top.map((r) =>
        Number(prev.find((p) => p.doctor_id === r.doctor_id)?.cnt || 0)
      ),
    };
  }
}
