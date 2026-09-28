/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql, SQL } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import {
  ReportsStaffQueryDto,
  ReportsStaffTrendQueryDto,
} from '../schemas/reportsStaff.schemas';
import {
  DateRange,
  buildComparisonRange,
  calcChange,
  generateSlots,
  mapValuesToSlots,
  padComparisonSlots,
  toPercentage,
} from '../utils/reportsPeriod.utils';
import { ReportsStaffData, StaffMetricItem } from '../types/reportsStaff.types';

const CACHE_TTL = 120;

/**
 * Attendance, leave, shift and overtime have no tables in this schema, so the
 * staff report cannot answer them. They are named here and returned to the
 * client, which renders those panels as unavailable instead of showing numbers
 * that would have to be invented.
 */
const UNAVAILABLE_SECTIONS = [
  'attendance',
  'leaves',
  'overtime',
  'shiftRoster',
];

/** Appointments only ever reference a doctor, so per-staff output is doctors. */
const COMPLETED_STATUS = sql`${AppointmentModel.appointmentStatus} = 'Completed'`;

type AnyStaffQuery = ReportsStaffQueryDto | ReportsStaffTrendQueryDto;

function staffScope(clinicId: string, query: AnyStaffQuery): SQL {
  const roleFilter = query.role
    ? sql`AND ${UserModel.userType}::text = ${query.role}`
    : sql``;

  return sql`
    FROM ${ClinicAssignModel}
    INNER JOIN ${UserModel} ON ${UserModel.id} = ${ClinicAssignModel.userId}
    WHERE ${ClinicAssignModel.clinicId} = ${clinicId}
      AND ${UserModel.userType} <> 'Patient'
      ${roleFilter}
  `;
}

function doctorFilter(query: AnyStaffQuery): SQL {
  return query.doctorId
    ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}`
    : sql``;
}

function buildCacheKey(clinicId: string, query: ReportsStaffQueryDto): string {
  return [
    'reports:staff',
    clinicId,
    query.startDate,
    query.endDate,
    query.compareStartDate || 'auto',
    query.compareEndDate || 'auto',
    query.role || 'all',
    query.doctorId || 'all',
  ].join(':');
}

function buildTrendCacheKey(
  clinicId: string,
  query: ReportsStaffTrendQueryDto
): string {
  return [
    'reports:staff:trend',
    clinicId,
    query.type,
    query.period,
    query.startDate,
    query.endDate,
    query.role || 'all',
    query.doctorId || 'all',
  ].join(':');
}

function metric(current: number, previous: number): StaffMetricItem {
  const { change, changeType } = calcChange(current, previous);
  return { value: Math.round(current), change, changeType };
}

function snapshotMetric(value: number): StaffMetricItem {
  return { value: Math.round(value), change: 0, changeType: 'neutral' };
}

export class ReportsStaffService {
  static async getStaffReports(
    clinicId: string,
    query: ReportsStaffQueryDto
  ): Promise<ReportsStaffData> {
    const cacheKey = buildCacheKey(clinicId, query);
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        logger.info('[ReportsStaff] Cache HIT');
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[ReportsStaff] Redis read error', err);
    }

    const { primary, comparison } = buildComparisonRange(query);

    const [
      roster,
      currentWork,
      previousWork,
      appointmentsTrend,
      staffByRole,
      staffByStatus,
      perStaff,
    ] = await Promise.all([
      this.getRosterCounts(clinicId, query),
      this.getWorkTotals(clinicId, primary, query),
      this.getWorkTotals(clinicId, comparison, query),
      this.getAppointmentsTrend(
        clinicId,
        primary,
        comparison,
        query,
        'auto',
        'appointments'
      ),
      this.getStaffByRole(clinicId, query),
      this.getStaffByStatus(clinicId, query),
      this.getPerStaffAppointments(clinicId, primary, query),
    ]);

    const activeDoctors = perStaff.length || 1;
    const prevActiveDoctors = previousWork.doctors || 1;

    const result: ReportsStaffData = {
      metrics: {
        totalStaff: snapshotMetric(roster.total),
        activeStaff: snapshotMetric(roster.active),
        appointmentsHandled: metric(
          currentWork.appointments,
          previousWork.appointments
        ),
        completedAppointments: metric(
          currentWork.completed,
          previousWork.completed
        ),
        avgAppointmentsPerDoctor: metric(
          currentWork.appointments / activeDoctors,
          previousWork.appointments / prevActiveDoctors
        ),
        completionRate: metric(
          toPercentage(currentWork.completed, currentWork.appointments),
          toPercentage(previousWork.completed, previousWork.appointments)
        ),
      },
      appointmentsTrend,
      staffByRole,
      staffByStatus,
      topPerformingStaff: perStaff.slice(0, 5).map((row) => ({
        staffId: row.staffId,
        staffName: row.staffName,
        role: row.role,
        appointments: row.appointments,
        completed: row.completed,
        completionRate: toPercentage(row.completed, row.appointments),
      })),
      staffWorkload: perStaff.slice(0, 5).map((row) => ({
        staffId: row.staffId,
        staffName: row.staffName,
        role: row.role,
        appointments: row.appointments,
        shareOfClinic: toPercentage(row.appointments, currentWork.appointments),
      })),
      insights: this.buildInsights(roster, currentWork, previousWork, perStaff),
      unavailableSections: UNAVAILABLE_SECTIONS,
    };

    try {
      await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(result));
    } catch (err) {
      logger.warn('[ReportsStaff] Redis write error', err);
    }

    return result;
  }

  static async getStaffTrendData(
    clinicId: string,
    query: ReportsStaffTrendQueryDto
  ) {
    const cacheKey = buildTrendCacheKey(clinicId, query);
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        logger.info('[ReportsStaff] Trend Cache HIT');
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[ReportsStaff] Redis read error', err);
    }

    const { primary, comparison } = buildComparisonRange(query);
    const result = await this.getAppointmentsTrend(
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
      logger.warn('[ReportsStaff] Redis write error', err);
    }

    return result;
  }

  private static async getRosterCounts(
    clinicId: string,
    query: ReportsStaffQueryDto
  ) {
    const rows: any[] = await database.execute(sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE ${UserModel.userStatus} = 'Active')::int as active
      ${staffScope(clinicId, query)}
    `);

    return {
      total: Number(rows[0]?.total || 0),
      active: Number(rows[0]?.active || 0),
    };
  }

  private static async getWorkTotals(
    clinicId: string,
    range: DateRange,
    query: ReportsStaffQueryDto
  ) {
    const rows: any[] = await database.execute(sql`
      SELECT
        COUNT(*)::int as appointments,
        COUNT(*) FILTER (WHERE ${COMPLETED_STATUS})::int as completed,
        COUNT(DISTINCT ${AppointmentModel.doctorId})::int as doctors
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${range.start} AND ${range.end}
        ${doctorFilter(query)}
    `);

    return {
      appointments: Number(rows[0]?.appointments || 0),
      completed: Number(rows[0]?.completed || 0),
      doctors: Number(rows[0]?.doctors || 0),
    };
  }

  private static async getAppointmentsTrend(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: AnyStaffQuery,
    period: string,
    type: 'appointments' | 'completed'
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
      type === 'completed' ? sql`AND ${COMPLETED_STATUS}` : sql``;

    const rangeRows = (range: DateRange) =>
      database.execute(sql`
      SELECT
        date_trunc(${sql.raw(`'${truncUnit}'`)}, ${AppointmentModel.appointmentDate}) as dt,
        COUNT(*) as value
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${range.start} AND ${range.end}
        ${statusFilter} ${doctorFilter(query)}
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

  private static async getStaffByRole(
    clinicId: string,
    query: ReportsStaffQueryDto
  ) {
    const rows: any[] = await database.execute(sql`
      SELECT ${UserModel.userType} as label, COUNT(*)::int as value
      ${staffScope(clinicId, query)}
      GROUP BY label
      ORDER BY value DESC
    `);

    return this.toDistribution(rows);
  }

  private static async getStaffByStatus(
    clinicId: string,
    query: ReportsStaffQueryDto
  ) {
    const rows: any[] = await database.execute(sql`
      SELECT ${UserModel.userStatus} as label, COUNT(*)::int as value
      ${staffScope(clinicId, query)}
      GROUP BY label
      ORDER BY value DESC
    `);

    return this.toDistribution(rows);
  }

  private static async getPerStaffAppointments(
    clinicId: string,
    primary: DateRange,
    query: ReportsStaffQueryDto
  ) {
    const roleFilter = query.role
      ? sql`AND ${UserModel.userType}::text = ${query.role}`
      : sql``;

    const rows: any[] = await database.execute(sql`
      SELECT
        ${AppointmentModel.doctorId} as staff_id,
        COALESCE(${UserModel.name}, 'Unassigned') as staff_name,
        -- ::text first: 'Unknown' isn't a user_type enum value, so the enum COALESCE failed (22P02).
        COALESCE(${UserModel.userType}::text, 'Unknown') as role,
        COUNT(*)::int as appointments,
        COUNT(*) FILTER (WHERE ${COMPLETED_STATUS})::int as completed
      FROM ${AppointmentModel}
      LEFT JOIN ${UserModel} ON ${UserModel.id} = ${AppointmentModel.doctorId}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${primary.start} AND ${primary.end}
        AND ${AppointmentModel.doctorId} IS NOT NULL
        ${roleFilter} ${doctorFilter(query)}
      GROUP BY staff_id, staff_name, role
      ORDER BY appointments DESC
    `);

    return rows.map((r) => ({
      staffId: String(r.staff_id || ''),
      staffName: String(r.staff_name),
      role: String(r.role),
      appointments: Number(r.appointments || 0),
      completed: Number(r.completed || 0),
    }));
  }

  private static buildInsights(
    roster: { total: number; active: number },
    current: { appointments: number; completed: number },
    previous: { appointments: number },
    perStaff: Array<{ staffName: string; appointments: number }>
  ): string[] {
    const insights: string[] = [];

    if (perStaff[0]?.appointments > 0) {
      insights.push(
        `${perStaff[0].staffName} handled the most appointments (${perStaff[0].appointments}).`
      );
    }
    if (current.appointments > 0) {
      insights.push(
        `${toPercentage(current.completed, current.appointments)}% of appointments were completed.`
      );
    }
    if (current.appointments > 0 || previous.appointments > 0) {
      const { change, changeType } = calcChange(
        current.appointments,
        previous.appointments
      );
      const direction =
        changeType === 'decrease'
          ? 'decreased'
          : changeType === 'increase'
            ? 'increased'
            : 'held steady';
      insights.push(
        `Appointment volume ${direction} by ${change}% versus the comparison period.`
      );
    }
    if (roster.total > roster.active) {
      insights.push(
        `${roster.total - roster.active} of ${roster.total} staff accounts are not active.`
      );
    }

    return insights;
  }

  private static toDistribution(rows: any[]) {
    const total = rows.reduce((sum, r) => sum + Number(r.value), 0);
    return rows.map((r) => ({
      label: String(r.label),
      value: Number(r.value || 0),
      percentage: toPercentage(Number(r.value || 0), total),
    }));
  }
}
