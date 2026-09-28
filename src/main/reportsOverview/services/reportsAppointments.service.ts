/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { ClinicServiceModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import {
  ReportsAppointmentsQueryDto,
  ReportsAppointmentsTrendQueryDto,
} from '../schemas/reportsAppointments.schemas';
import logger from '../../../utils/logger';
import {
  bucketRowsByHour,
  formatHourClock12,
  formatHourSlot12,
  formatHourSlotShort,
} from '../../../utils/appointmentHours.utils';

const CACHE_TTL = 120; // 2 minutes
const CACHE_TTL_TREND = 120; // 2 minutes

interface DateRange {
  start: string;
  end: string;
}

function buildComparisonRange(query: ReportsAppointmentsQueryDto): {
  primary: DateRange;
  comparison: DateRange;
} {
  const primary: DateRange = {
    start: query.startDate + ' 00:00:00',
    end: query.endDate + ' 23:59:59',
  };
  if (query.compareStartDate && query.compareEndDate) {
    return {
      primary,
      comparison: {
        start: query.compareStartDate + ' 00:00:00',
        end: query.compareEndDate + ' 23:59:59',
      },
    };
  }
  const startMs = new Date(query.startDate).getTime();
  const endMs = new Date(query.endDate).getTime();
  const durationMs = endMs - startMs;
  const compEnd = new Date(startMs - 1);
  const compStart = new Date(startMs - durationMs - 86400000);
  return {
    primary,
    comparison: {
      start: compStart.toISOString().split('T')[0] + ' 00:00:00',
      end: compEnd.toISOString().split('T')[0] + ' 23:59:59',
    },
  };
}

function calcChange(
  current: number,
  previous: number
): { change: number; changeType: string } {
  if (previous === 0)
    return {
      change: 0,
      // Nothing to compare against: "new" rather than a misleading 100% rise.
      changeType: current > 0 ? 'new' : 'neutral',
    };
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
    query.department || 'all',
    query.doctorId || 'all',
    query.appointmentType || 'all',
  ].join(':');
}

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
    current.setDate(current.getDate() + (dayOfWeek === 0 ? -6 : 1 - dayOfWeek));
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

function buildBaseFilters(
  clinicId: string,
  range: DateRange,
  query: ReportsAppointmentsQueryDto | ReportsAppointmentsTrendQueryDto
) {
  const doctorFilter = query.doctorId
    ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}`
    : sql``;
  const typeFilter = query.appointmentType
    ? sql`AND ${AppointmentModel.appointmentType} = ${query.appointmentType}`
    : sql``;
  const deptJoin = query.department
    ? sql`INNER JOIN ${ClinicServiceModel} ON ${AppointmentModel.clinicServiceId} = ${ClinicServiceModel.id}`
    : sql``;
  const deptFilter = query.department
    ? sql`AND ${ClinicServiceModel.serviceName} = ${query.department}`
    : sql``;
  return { doctorFilter, typeFilter, deptJoin, deptFilter };
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
        logger.info(`[ReportsAppointments] Cache HIT`);
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[ReportsAppointments] Redis read error', err);
    }

    const { primary, comparison } = buildComparisonRange(query);
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
    ] = await Promise.all([
      this.getMetrics(clinicId, primary, comparison, query),
      this.getAppointmentsTrend(clinicId, primary, comparison, query, 'auto'),
      this.getStatusDistribution(clinicId, primary, query),
      this.getTypeDistribution(clinicId, primary, query),
      this.getTopBookingTimeSlots(clinicId, primary, query),
      this.getAppointmentsByDay(clinicId, primary, query),
      this.getTopDoctors(clinicId, primary, query),
      this.getNoShowAnalysis(clinicId, primary, comparison, query),
      this.getBottomMetrics(clinicId, primary, comparison, query),
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
        logger.info(`[ReportsAppointments] Trend Cache HIT`);
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[ReportsAppointments] Redis read error', err);
    }

    const { primary, comparison } = buildComparisonRange(query);
    let result;
    switch (query.type) {
      case 'appointments':
        result = await this.getAppointmentsTrend(
          clinicId,
          primary,
          comparison,
          query,
          query.period
        );
        break;
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
    const { doctorFilter, typeFilter, deptJoin, deptFilter } = buildBaseFilters(
      clinicId,
      primary,
      query
    );

    const curData: any[] = await database.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE ${AppointmentModel.appointmentStatus} = 'Completed') as completed,
        COUNT(*) FILTER (WHERE ${AppointmentModel.appointmentStatus} IN ('Pending', 'Upcoming', 'Confirmed')) as pending,
        COUNT(*) FILTER (WHERE ${AppointmentModel.appointmentStatus} = 'Cancelled') as cancelled,
        COUNT(*) FILTER (WHERE ${AppointmentModel.appointmentStatus} IN ('NoShow', 'Missed')) as no_show
      FROM ${AppointmentModel}
      ${deptJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter} ${typeFilter} ${deptFilter}
    `);

    const prevData: any[] = await database.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE ${AppointmentModel.appointmentStatus} = 'Completed') as completed,
        COUNT(*) FILTER (WHERE ${AppointmentModel.appointmentStatus} IN ('Pending', 'Upcoming', 'Confirmed')) as pending,
        COUNT(*) FILTER (WHERE ${AppointmentModel.appointmentStatus} = 'Cancelled') as cancelled,
        COUNT(*) FILTER (WHERE ${AppointmentModel.appointmentStatus} IN ('NoShow', 'Missed')) as no_show
      FROM ${AppointmentModel}
      ${deptJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        ${doctorFilter} ${typeFilter} ${deptFilter}
    `);

    // Avg duration
    const avgDur: any[] = await database.execute(sql`
      SELECT COALESCE(AVG(CAST(${AppointmentModel.appointmentDurationMinutes} AS INTEGER)), 0) as avg_dur
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentModel.appointmentDurationMinutes} IS NOT NULL
        ${doctorFilter} ${typeFilter}
    `);
    const prevAvgDur: any[] = await database.execute(sql`
      SELECT COALESCE(AVG(CAST(${AppointmentModel.appointmentDurationMinutes} AS INTEGER)), 0) as avg_dur
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        AND ${AppointmentModel.appointmentDurationMinutes} IS NOT NULL
        ${doctorFilter} ${typeFilter}
    `);

    const c = curData[0] || {};
    const p = prevData[0] || {};
    const curAvgD = Math.round(Number(avgDur[0]?.avg_dur || 0));
    const prevAvgD = Math.round(Number(prevAvgDur[0]?.avg_dur || 0));

    return {
      totalAppointments: {
        value: Number(c.total || 0),
        ...calcChange(Number(c.total || 0), Number(p.total || 0)),
      },
      completed: {
        value: Number(c.completed || 0),
        ...calcChange(Number(c.completed || 0), Number(p.completed || 0)),
      },
      pending: {
        value: Number(c.pending || 0),
        ...calcChange(Number(c.pending || 0), Number(p.pending || 0)),
      },
      cancelled: {
        value: Number(c.cancelled || 0),
        ...calcChange(Number(c.cancelled || 0), Number(p.cancelled || 0)),
      },
      noShow: {
        value: Number(c.no_show || 0),
        ...calcChange(Number(c.no_show || 0), Number(p.no_show || 0)),
      },
      avgDuration: { value: curAvgD, ...calcChange(curAvgD, prevAvgD) },
    };
  }

  // ─── APPOINTMENTS TREND ──────────────────────────────────────────────────────

  private static async getAppointmentsTrend(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsAppointmentsQueryDto | ReportsAppointmentsTrendQueryDto,
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
    while (comparisonSlots.length < primarySlots.length)
      comparisonSlots.push(
        comparisonSlots[comparisonSlots.length - 1] || primarySlots[0]
      );

    const { doctorFilter, typeFilter } = buildBaseFilters(
      clinicId,
      primary,
      query
    );

    const curRows: any[] = await database.execute(sql`
      SELECT date_trunc(${sql.raw(`'${truncUnit}'`)}, ${AppointmentModel.appointmentDate}) as dt, COUNT(*) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId} AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter} ${typeFilter}
      GROUP BY dt ORDER BY dt
    `);
    const prevRows: any[] = await database.execute(sql`
      SELECT date_trunc(${sql.raw(`'${truncUnit}'`)}, ${AppointmentModel.appointmentDate}) as dt, COUNT(*) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId} AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        ${doctorFilter} ${typeFilter}
      GROUP BY dt ORDER BY dt
    `);

    return {
      labels: primarySlots.map((s) => s.label),
      currentPeriod: mapDataToSlots(curRows, primarySlots, truncUnit),
      previousPeriod: mapDataToSlots(prevRows, comparisonSlots, truncUnit),
    };
  }

  // ─── STATUS DISTRIBUTION ─────────────────────────────────────────────────────

  private static async getStatusDistribution(
    clinicId: string,
    primary: DateRange,
    query: ReportsAppointmentsQueryDto
  ) {
    const { doctorFilter, typeFilter, deptJoin, deptFilter } = buildBaseFilters(
      clinicId,
      primary,
      query
    );

    const result: any[] = await database.execute(sql`
      SELECT ${AppointmentModel.appointmentStatus} as status, COUNT(*) as cnt
      FROM ${AppointmentModel} ${deptJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter} ${typeFilter} ${deptFilter}
      GROUP BY status
    `);

    const statusMap: Record<string, number> = {};
    let total = 0;
    result.forEach((r) => {
      statusMap[r.status] = Number(r.cnt);
      total += Number(r.cnt);
    });
    total = total || 1;

    const completed = statusMap['Completed'] || 0;
    const pending =
      (statusMap['Pending'] || 0) +
      (statusMap['Upcoming'] || 0) +
      (statusMap['Confirmed'] || 0);
    const cancelled = statusMap['Cancelled'] || 0;
    const noShow = (statusMap['NoShow'] || 0) + (statusMap['Missed'] || 0);

    return [
      {
        label: 'Completed',
        value: completed,
        percentage: parseFloat(((completed / total) * 100).toFixed(1)),
      },
      {
        label: 'Pending',
        value: pending,
        percentage: parseFloat(((pending / total) * 100).toFixed(1)),
      },
      {
        label: 'Cancelled',
        value: cancelled,
        percentage: parseFloat(((cancelled / total) * 100).toFixed(1)),
      },
      {
        label: 'No Show',
        value: noShow,
        percentage: parseFloat(((noShow / total) * 100).toFixed(1)),
      },
    ];
  }

  // ─── TYPE DISTRIBUTION ───────────────────────────────────────────────────────

  private static async getTypeDistribution(
    clinicId: string,
    primary: DateRange,
    query: ReportsAppointmentsQueryDto
  ) {
    const { doctorFilter, deptJoin, deptFilter } = buildBaseFilters(
      clinicId,
      primary,
      query
    );

    const result: any[] = await database.execute(sql`
      SELECT ${AppointmentModel.appointmentType} as type, COUNT(*) as cnt
      FROM ${AppointmentModel} ${deptJoin}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter} ${deptFilter}
      GROUP BY type ORDER BY cnt DESC
    `);

    const total = result.reduce((s, r) => s + Number(r.cnt), 0) || 1;
    return result.map((r) => ({
      label: r.type,
      value: Number(r.cnt),
      percentage: parseFloat(((Number(r.cnt) / total) * 100).toFixed(1)),
    }));
  }

  // ─── TOP BOOKING TIME SLOTS ──────────────────────────────────────────────────

  private static async getTopBookingTimeSlots(
    clinicId: string,
    primary: DateRange,
    query: ReportsAppointmentsQueryDto
  ) {
    const { doctorFilter, typeFilter } = buildBaseFilters(
      clinicId,
      primary,
      query
    );

    // Hour of day lives in appointment_time, not appointment_date (which the
    // booking flow always sets to midnight) — see appointmentHours.utils.
    const timeRows: any[] = await database.execute(sql`
      SELECT ${AppointmentModel.appointmentTime} as time, COUNT(*) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentModel.appointmentTime} IS NOT NULL
        ${doctorFilter} ${typeFilter}
      GROUP BY ${AppointmentModel.appointmentTime}
    `);
    const result = bucketRowsByHour(timeRows);

    const total = result.reduce((s, r) => s + Number(r.cnt), 0) || 1;
    const top5 = result.slice(0, 5);
    const othersCount = result.slice(5).reduce((s, r) => s + Number(r.cnt), 0);

    const slots = top5.map((r) => ({
      timeSlot: formatHourSlot12(r.hour),
      appointments: Number(r.cnt),
      percentage: parseFloat(((Number(r.cnt) / total) * 100).toFixed(1)),
    }));

    if (othersCount > 0) {
      slots.push({
        timeSlot: 'Others',
        appointments: othersCount,
        percentage: parseFloat(((othersCount / total) * 100).toFixed(1)),
      });
    }

    return slots;
  }

  // ─── APPOINTMENTS BY DAY ─────────────────────────────────────────────────────

  private static async getAppointmentsByDay(
    clinicId: string,
    primary: DateRange,
    query: ReportsAppointmentsQueryDto
  ) {
    const { doctorFilter, typeFilter } = buildBaseFilters(
      clinicId,
      primary,
      query
    );

    const result: any[] = await database.execute(sql`
      SELECT
        EXTRACT(DOW FROM ${AppointmentModel.appointmentDate}) as dow,
        COUNT(*) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter} ${typeFilter}
      GROUP BY dow ORDER BY dow
    `);

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayMap = new Map<number, number>();
    result.forEach((r) => dayMap.set(Number(r.dow), Number(r.cnt)));

    // Return Mon-Sun order
    const ordered = [1, 2, 3, 4, 5, 6, 0];
    return ordered.map((dow) => ({
      day: dayNames[dow],
      appointments: dayMap.get(dow) || 0,
    }));
  }

  // ─── TOP DOCTORS ─────────────────────────────────────────────────────────────

  private static async getTopDoctors(
    clinicId: string,
    primary: DateRange,
    query: ReportsAppointmentsQueryDto
  ) {
    const { typeFilter } = buildBaseFilters(clinicId, primary, query);

    const result: any[] = await database.execute(sql`
      SELECT
        ${AppointmentModel.doctorId} as doctor_id,
        ${UserModel.name} as doctor_name,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE ${AppointmentModel.appointmentStatus} = 'Completed') as completed
      FROM ${AppointmentModel}
      INNER JOIN ${UserModel} ON ${UserModel.id} = ${AppointmentModel.doctorId}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentModel.doctorId} IS NOT NULL
        ${typeFilter}
      GROUP BY ${AppointmentModel.doctorId}, ${UserModel.name}
      ORDER BY total DESC
      LIMIT 5
    `);

    return result.map((r) => ({
      doctor: r.doctor_name,
      doctorId: r.doctor_id,
      appointments: Number(r.total),
      completed: Number(r.completed),
      completionRate:
        Number(r.total) > 0
          ? parseFloat(
              ((Number(r.completed) / Number(r.total)) * 100).toFixed(1)
            )
          : 0,
    }));
  }

  // ─── NO SHOW ANALYSIS ────────────────────────────────────────────────────────

  private static async getNoShowAnalysis(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsAppointmentsQueryDto
  ) {
    const { doctorFilter, typeFilter } = buildBaseFilters(
      clinicId,
      primary,
      query
    );

    const curTotal: any[] = await database.execute(sql`
      SELECT COUNT(*) as total FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter} ${typeFilter}
    `);

    const curNoShow: any[] = await database.execute(sql`
      SELECT COUNT(*) as cnt FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentModel.appointmentStatus} IN ('NoShow', 'Missed')
        ${doctorFilter} ${typeFilter}
    `);

    const prevTotal: any[] = await database.execute(sql`
      SELECT COUNT(*) as total FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        ${doctorFilter} ${typeFilter}
    `);

    const prevNoShow: any[] = await database.execute(sql`
      SELECT COUNT(*) as cnt FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        AND ${AppointmentModel.appointmentStatus} IN ('NoShow', 'Missed')
        ${doctorFilter} ${typeFilter}
    `);

    const totalVal = Number(curTotal[0]?.total || 0) || 1;
    const noShowVal = Number(curNoShow[0]?.cnt || 0);
    const prevTotalVal = Number(prevTotal[0]?.total || 0) || 1;
    const prevNoShowVal = Number(prevNoShow[0]?.cnt || 0);
    const curRate = parseFloat(((noShowVal / totalVal) * 100).toFixed(1));
    const prevRate = parseFloat(
      ((prevNoShowVal / prevTotalVal) * 100).toFixed(1)
    );
    const rateChange = calcChange(curRate, prevRate);

    // Breakdown by noShowMarkedBy
    const breakdown: any[] = await database.execute(sql`
      SELECT
        COALESCE(${AppointmentModel.noShowMarkedBy}, 'system') as marked_by,
        COUNT(*) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentModel.appointmentStatus} IN ('NoShow', 'Missed')
        ${doctorFilter} ${typeFilter}
      GROUP BY marked_by ORDER BY cnt DESC
    `);

    const breakdownTotal =
      breakdown.reduce((s, r) => s + Number(r.cnt), 0) || 1;

    return {
      total: noShowVal,
      rate: curRate,
      rateChange: rateChange.change,
      rateChangeType: rateChange.changeType,
      breakdown: breakdown.map((r) => ({
        label: r.marked_by,
        value: Number(r.cnt),
        percentage: parseFloat(
          ((Number(r.cnt) / breakdownTotal) * 100).toFixed(1)
        ),
      })),
    };
  }

  // ─── BOTTOM METRICS ──────────────────────────────────────────────────────────

  private static async getBottomMetrics(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsAppointmentsQueryDto
  ) {
    const { doctorFilter, typeFilter } = buildBaseFilters(
      clinicId,
      primary,
      query
    );

    // Total appointments
    const totalResult: any[] = await database.execute(sql`
      SELECT COUNT(*) as total FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter} ${typeFilter}
    `);
    const totalAppts = Number(totalResult[0]?.total || 0) || 1;

    // Advance bookings (created before appointment date)
    const advanceResult: any[] = await database.execute(sql`
      SELECT COUNT(*) as cnt FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentModel.createdAt}::date < ${AppointmentModel.appointmentDate}::date
        ${doctorFilter} ${typeFilter}
    `);
    const advanceCount = Number(advanceResult[0]?.cnt || 0);
    const walkInCount = totalAppts - advanceCount;

    // Rescheduled
    const rescheduledResult: any[] = await database.execute(sql`
      SELECT COUNT(*) as cnt FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentModel.appointmentStatus} = 'Rescheduled'
        ${doctorFilter} ${typeFilter}
    `);
    const rescheduledCount = Number(rescheduledResult[0]?.cnt || 0);

    // Avg advance days
    const avgAdvanceResult: any[] = await database.execute(sql`
      SELECT COALESCE(AVG(${AppointmentModel.appointmentDate}::date - ${AppointmentModel.createdAt}::date), 0) as avg_days
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentModel.createdAt}::date < ${AppointmentModel.appointmentDate}::date
        ${doctorFilter} ${typeFilter}
    `);
    const prevAvgAdvanceResult: any[] = await database.execute(sql`
      SELECT COALESCE(AVG(${AppointmentModel.appointmentDate}::date - ${AppointmentModel.createdAt}::date), 0) as avg_days
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        AND ${AppointmentModel.createdAt}::date < ${AppointmentModel.appointmentDate}::date
        ${doctorFilter} ${typeFilter}
    `);
    const curAvgDays = parseFloat(
      Number(avgAdvanceResult[0]?.avg_days || 0).toFixed(1)
    );
    const prevAvgDays = parseFloat(
      Number(prevAvgAdvanceResult[0]?.avg_days || 0).toFixed(1)
    );

    // Peak day
    const peakDayResult: any[] = await database.execute(sql`
      SELECT TO_CHAR(${AppointmentModel.appointmentDate}, 'Day') as day_name, COUNT(*) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter} ${typeFilter}
      GROUP BY day_name ORDER BY cnt DESC LIMIT 1
    `);

    // Peak time — bucketed from appointment_time, not appointment_date.
    const peakTimeRows: any[] = await database.execute(sql`
      SELECT ${AppointmentModel.appointmentTime} as time, COUNT(*) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentModel.appointmentTime} IS NOT NULL
        ${doctorFilter} ${typeFilter}
      GROUP BY ${AppointmentModel.appointmentTime}
    `);
    const peakTimeResult = bucketRowsByHour(peakTimeRows).slice(0, 1);

    // Utilization rate (completed / total)
    const completedResult: any[] = await database.execute(sql`
      SELECT COUNT(*) as cnt FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentModel.appointmentStatus} = 'Completed'
        ${doctorFilter} ${typeFilter}
    `);
    const prevCompletedResult: any[] = await database.execute(sql`
      SELECT COUNT(*) as cnt FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        AND ${AppointmentModel.appointmentStatus} = 'Completed'
        ${doctorFilter} ${typeFilter}
    `);
    const prevTotalResult: any[] = await database.execute(sql`
      SELECT COUNT(*) as total FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        ${doctorFilter} ${typeFilter}
    `);

    const curUtilization = parseFloat(
      ((Number(completedResult[0]?.cnt || 0) / totalAppts) * 100).toFixed(1)
    );
    const prevTotalAppts = Number(prevTotalResult[0]?.total || 0) || 1;
    const prevUtilization = parseFloat(
      (
        (Number(prevCompletedResult[0]?.cnt || 0) / prevTotalAppts) *
        100
      ).toFixed(1)
    );

    // No bookings with a recorded time means there is no peak — reporting a
    // hardcoded "10:00 AM" fallback invented a statistic that did not exist.
    const peakTimeStr = peakTimeResult[0]
      ? formatHourClock12(peakTimeResult[0].hour)
      : 'N/A';

    return {
      advanceBookings: {
        value: advanceCount,
        percentage: parseFloat(((advanceCount / totalAppts) * 100).toFixed(1)),
      },
      walkIn: {
        value: walkInCount,
        percentage: parseFloat(((walkInCount / totalAppts) * 100).toFixed(1)),
      },
      rescheduled: {
        value: rescheduledCount,
        percentage: parseFloat(
          ((rescheduledCount / totalAppts) * 100).toFixed(1)
        ),
      },
      avgAdvanceDays: {
        value: curAvgDays,
        ...calcChange(curAvgDays, prevAvgDays),
      },
      peakDay: {
        day: (peakDayResult[0]?.day_name || 'N/A').trim(),
        appointments: Number(peakDayResult[0]?.cnt || 0),
      },
      peakTime: {
        time: peakTimeStr,
        appointments: Number(peakTimeResult[0]?.cnt || 0),
      },
      utilizationRate: {
        value: curUtilization,
        ...calcChange(curUtilization, prevUtilization),
      },
    };
  }

  // ─── TREND SUB-ENDPOINTS ─────────────────────────────────────────────────────

  private static async getByDayTrend(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsAppointmentsTrendQueryDto
  ) {
    const { doctorFilter, typeFilter } = buildBaseFilters(
      clinicId,
      primary,
      query
    );
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const ordered = [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun

    const curResult: any[] = await database.execute(sql`
      SELECT EXTRACT(DOW FROM ${AppointmentModel.appointmentDate}) as dow, COUNT(*) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        ${doctorFilter} ${typeFilter}
      GROUP BY dow
    `);
    const prevResult: any[] = await database.execute(sql`
      SELECT EXTRACT(DOW FROM ${AppointmentModel.appointmentDate}) as dow, COUNT(*) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        ${doctorFilter} ${typeFilter}
      GROUP BY dow
    `);

    const curMap = new Map<number, number>();
    curResult.forEach((r) => curMap.set(Number(r.dow), Number(r.cnt)));
    const prevMap = new Map<number, number>();
    prevResult.forEach((r) => prevMap.set(Number(r.dow), Number(r.cnt)));

    return {
      labels: ordered.map((d) => dayNames[d]),
      currentPeriod: ordered.map((d) => curMap.get(d) || 0),
      previousPeriod: ordered.map((d) => prevMap.get(d) || 0),
    };
  }

  private static async getTimeSlotsTrend(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsAppointmentsTrendQueryDto
  ) {
    const { doctorFilter, typeFilter } = buildBaseFilters(
      clinicId,
      primary,
      query
    );

    // Hour buckets come from appointment_time; appointment_date is midnight.
    const curRows: any[] = await database.execute(sql`
      SELECT ${AppointmentModel.appointmentTime} as time, COUNT(*) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentModel.appointmentTime} IS NOT NULL
        ${doctorFilter} ${typeFilter}
      GROUP BY ${AppointmentModel.appointmentTime}
    `);
    const prevRows: any[] = await database.execute(sql`
      SELECT ${AppointmentModel.appointmentTime} as time, COUNT(*) as cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        AND ${AppointmentModel.appointmentTime} IS NOT NULL
        ${doctorFilter} ${typeFilter}
      GROUP BY ${AppointmentModel.appointmentTime}
    `);
    const curResult = bucketRowsByHour(curRows);
    const prevResult = bucketRowsByHour(prevRows);

    // Use top 5 hours from current period as labels
    const top5Hours = curResult.slice(0, 5).map((r) => Number(r.hour));
    const curMap = new Map<number, number>();
    curResult.forEach((r) => curMap.set(Number(r.hour), Number(r.cnt)));
    const prevMap = new Map<number, number>();
    prevResult.forEach((r) => prevMap.set(Number(r.hour), Number(r.cnt)));

    const othersHours = curResult.slice(5);
    const othersCur = othersHours.reduce((s, r) => s + Number(r.cnt), 0);
    const othersPrev = prevResult
      .filter((r) => !top5Hours.includes(Number(r.hour)))
      .reduce((s, r) => s + Number(r.cnt), 0);

    const labels = top5Hours.map(formatHourSlotShort);
    labels.push('Others');

    return {
      labels,
      currentPeriod: [...top5Hours.map((h) => curMap.get(h) || 0), othersCur],
      previousPeriod: [
        ...top5Hours.map((h) => prevMap.get(h) || 0),
        othersPrev,
      ],
    };
  }

  private static async getDoctorsTrend(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: ReportsAppointmentsTrendQueryDto
  ) {
    const { typeFilter } = buildBaseFilters(clinicId, primary, query);

    const curResult: any[] = await database.execute(sql`
      SELECT ${UserModel.name} as doctor_name, COUNT(*) as cnt
      FROM ${AppointmentModel}
      INNER JOIN ${UserModel} ON ${UserModel.id} = ${AppointmentModel.doctorId}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentModel.doctorId} IS NOT NULL
        ${typeFilter}
      GROUP BY ${UserModel.name} ORDER BY cnt DESC LIMIT 5
    `);

    const doctorNames = curResult.map((r) => r.doctor_name);

    const prevResult: any[] = await database.execute(sql`
      SELECT ${UserModel.name} as doctor_name, COUNT(*) as cnt
      FROM ${AppointmentModel}
      INNER JOIN ${UserModel} ON ${UserModel.id} = ${AppointmentModel.doctorId}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${comparison.start} AND ${comparison.end}
        AND ${AppointmentModel.doctorId} IS NOT NULL
        ${typeFilter}
      GROUP BY ${UserModel.name}
    `);

    const prevMap = new Map<string, number>();
    prevResult.forEach((r) => prevMap.set(r.doctor_name, Number(r.cnt)));

    return {
      labels: doctorNames.map((n) => n.split(' ').slice(0, 2).join(' ')), // Shorten names
      currentPeriod: curResult.map((r) => Number(r.cnt)),
      previousPeriod: doctorNames.map((n) => prevMap.get(n) || 0),
    };
  }
}
