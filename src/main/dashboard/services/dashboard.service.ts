/* eslint-disable @typescript-eslint/no-explicit-any */
// services/dashboard.service.ts
import {
  and,
  asc,
  between,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  sql,
  or,
  gt,
  isNull,
  ne,
} from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { AuthUser } from '../../../middlewear/auth.middleware';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import { AppointmentClinicalModel } from '../../appointments/models/appointmentClinical.model';
import { AppointmentService } from '../../appointments/services/appointment.service';
import { DoctorArrivalService } from '../../appointment-engine/services/doctorArrival.service';
import { getCurrentAppointmentId } from '../../appointment-engine/services/queueHoldStore.service';
import { ScheduleShiftService } from '../../appointment-engine/services/scheduleShift.service';
import { SlotConfigService } from '../../appointment-engine/services/slotConfig.service';
import { getISTDateString } from '../../../utils/istDateTime';
import { DoctorTopSymptom } from '../types/doctorDashboard.types';
import { ClinicSymptomCountModel } from '../../clinic/models/clinic-symptom-count.model';
import { ClinicSymptomModel } from '../../clinic/models/clinic-symptom.model';
import {
  ClinicAppointmentPlainModel,
  ClinicAssignModel,
  ClinicModel,
} from '../../clinic/models/clinic.model';
import { resolveDoctorAvailabilityToday } from '../../clinic/services/doctorAvailability.service';
import {
  ClinicSubscriptionModel,
  SubscriptionPlanModel,
} from '../../subscription/models/subscription.model';
import {
  ClinicAddOnModel,
  AddOnModel,
} from '../../subscription/models/addon.model';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import {
  getISTHoursMinutes,
  istDayBoundsUtc,
} from '../../../utils/istDateTime';
import { CacheKeys, getOrSetCache } from '../../../utils/cache.util';
import { ReceptionOverview } from '../types/receptionOverview.types';
import {
  doctorScopeFilter,
  scopeCacheKey,
} from '../../permissions/utils/staffScope.utils';
import { ReceptionTodayStats } from '../types/todayStats.types';
import {
  ClinicInsightsService,
  NOT_ATTENDED,
  UNPAID_PAYMENT,
} from './clinicInsights.service';
import { getDashboardCacheVersion } from '../utils/dashboardCache.utils';
import { HAS_RECEIVED_MONEY, RECEIVED_AMOUNT } from '../utils/revenueSql';

/** Every change bumps the version the key embeds, so the TTL only bounds idle entries. */
const CLINIC_DASHBOARD_TTL_SECONDS = 60;
import {
  parseTimeToMinutes,
  minutesToTimeString,
  minutesToTime12h,
  formatDurationMinutes,
} from '../../../utils/timeWindow.util';

const cleanText = (value?: string | null) => {
  const text = value?.trim();
  return text && text.length > 0 ? text : null;
};

// Booking writes "Token 13 requested (09:00 session)" into appointmentNotes
// (NewAppointment.tsx), optionally " - <what the user typed>" after it.
const TOKEN_NOTE_PREFIX = /^Token\s+\d+\s+requested(\s*\([^)]*\))?\s*(-\s*)?/i;

/**
 * The reason a doctor should read, not the booking bookkeeping: strips the
 * token boilerplate so a real note wins, and falls back to symptoms.
 */
export function resolveReasonForVisit(
  appointmentNotes: string | null | undefined,
  symptoms: string | null,
  appointmentType: string | null
): string | null {
  const notes = cleanText(appointmentNotes);
  const authored = notes
    ? cleanText(notes.replace(TOKEN_NOTE_PREFIX, ''))
    : null;
  return authored ?? symptoms ?? appointmentType;
}

function filterTodaysAppointments(appointments: any[]): any[] {
  const { hours: istHours, minutes: istMinutes } = getISTHoursMinutes();
  const nowInMinutes = istHours * 60 + istMinutes;

  return appointments
    .filter((a) => {
      const isStatusAllowed =
        a.appointmentStatus === 'Pending' ||
        a.appointmentStatus === 'Confirmed';
      if (!isStatusAllowed) return false;

      const typeLower = a.appointmentType?.toLowerCase() || '';

      const isTokenBased =
        typeLower === 'token' ||
        typeLower === 'token_based' ||
        typeLower.includes('token') ||
        (a.tokenNo != null && !a.appointmentTime);

      const isTimeBased =
        typeLower === 'time' ||
        typeLower === 'time_based' ||
        typeLower.includes('time') ||
        (a.appointmentTime != null &&
          a.appointmentTime !== '' &&
          !isTokenBased);

      if (isTokenBased) {
        return true;
      }

      if (isTimeBased) {
        const apptMin = parseTimeToMinutes(a.appointmentTime);
        if (apptMin !== null) {
          return apptMin >= nowInMinutes;
        }
      }

      return true;
    })
    .slice(0, 4);
}

function startOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonths(d: Date, months: number) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return new Date(Date.UTC(y, m + months, 1));
}
function formatLabel(d: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}
function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export class DashboardService {
  /**
   * Completed appointments aggregated by date. `opts.days` looks back from now
   * (default 30); `startDate`/`endDate` override the range inclusively.
   */
  static async getCompletedAppointmentsByDate(
    clinicId: string,
    opts?: {
      days?: number;
      startDate?: string | Date;
      endDate?: string | Date;
    }
  ) {
    const days = opts?.days ?? 30;
    const now = new Date();
    const end = opts?.endDate ? new Date(opts.endDate) : now;
    end.setHours(23, 59, 59, 999);

    let start: Date;
    if (opts?.startDate) {
      start = new Date(opts.startDate);
      start.setHours(0, 0, 0, 0);
    } else {
      start = new Date(now);
      start.setDate(start.getDate() - (days - 1));
      start.setHours(0, 0, 0, 0);
    }

    // Query to get completed appointments grouped by date
    let rows: Array<any> = [];
    try {
      rows = await database
        .select({
          date: sql`DATE(${AppointmentModel.appointmentDate})`,
          count: sql`COUNT(*)::int`,
        })
        .from(AppointmentModel)
        .where(
          and(
            eq(AppointmentModel.appointmentStatus, 'Completed'),
            eq(AppointmentModel.clinicId, clinicId),
            gte(AppointmentModel.appointmentDate, start),
            lte(AppointmentModel.appointmentDate, end)
          )
        )
        .groupBy(sql`DATE(${AppointmentModel.appointmentDate})`)
        .orderBy(sql`DATE(${AppointmentModel.appointmentDate}) asc`);
    } catch (err) {
      // Fallback: use raw SQL if Drizzle SQL expression fails
      const fallbackSql = `
        SELECT
          DATE(appointment_date) AS date,
          COUNT(*)::int AS count
        FROM appointments
        WHERE appointment_status = 'Completed'
          AND clinic_id = $1
          AND appointment_date >= $2
          AND appointment_date <= $3
        GROUP BY DATE(appointment_date)
        ORDER BY DATE(appointment_date) ASC;
      `;
      const params = [clinicId, start.toISOString(), end.toISOString()];

      const dbAny = database as any;
      let res: any;
      if (typeof dbAny.query === 'function') {
        res = await dbAny.query(fallbackSql, params);
        rows = res.rows ?? [];
      } else if (typeof dbAny.execute === 'function') {
        res = await dbAny.execute(fallbackSql, params);
        rows = res.rows ?? [];
      } else {
        throw err;
      }
    }

    // Normalize results into a map keyed by "YYYY-MM-DD"
    const countsMap = new Map<string, number>();
    for (const r of rows) {
      const dateStr =
        r.date instanceof Date
          ? r.date.toISOString().split('T')[0]
          : String(r.date);
      countsMap.set(dateStr, Number(r.count ?? 0));
    }

    // Build continuous list of dates between start and end inclusive
    const labels: string[] = [];
    const data: number[] = [];
    const keys: string[] = [];
    const details: Array<{ date: string; count: number; label: string }> = [];

    for (
      let cur = new Date(start);
      cur <= end;
      cur.setDate(cur.getDate() + 1)
    ) {
      const key = cur.toISOString().split('T')[0];
      const label = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(cur);

      const count = countsMap.get(key) ?? 0;

      keys.push(key);
      labels.push(label);
      data.push(count);
      details.push({ date: key, count, label });
    }

    return {
      labels,
      data,
      keys,
      details,
      range: { start: start.toISOString(), end: end.toISOString() },
      raw: rows,
    };
  }

  /**
   * Return No Show appointments aggregated by date.
   */
  static async getNoShowAppointmentsByDate(
    clinicId: string,
    opts?: {
      days?: number;
      startDate?: string | Date;
      endDate?: string | Date;
    }
  ) {
    const days = opts?.days ?? 30;
    const now = new Date();
    const end = opts?.endDate ? new Date(opts.endDate) : now;
    end.setHours(23, 59, 59, 999);

    let start: Date;
    if (opts?.startDate) {
      start = new Date(opts.startDate);
      start.setHours(0, 0, 0, 0);
    } else {
      start = new Date(now);
      start.setDate(start.getDate() - (days - 1));
      start.setHours(0, 0, 0, 0);
    }

    let rows: Array<any> = [];
    try {
      rows = await database
        .select({
          date: sql`DATE(${AppointmentModel.appointmentDate})`,
          count: sql`COUNT(*)::int`,
        })
        .from(AppointmentModel)
        .where(
          and(
            eq(AppointmentModel.appointmentStatus, 'NoShow'),
            eq(AppointmentModel.clinicId, clinicId),
            gte(AppointmentModel.appointmentDate, start),
            lte(AppointmentModel.appointmentDate, end)
          )
        )
        .groupBy(sql`DATE(${AppointmentModel.appointmentDate})`)
        .orderBy(sql`DATE(${AppointmentModel.appointmentDate}) asc`);
    } catch (err) {
      const fallbackSql = `
          SELECT
            DATE(appointment_date) AS date,
            COUNT(*)::int AS count
          FROM appointments
          WHERE appointment_status = 'NoShow'
            AND clinic_id = $1
            AND appointment_date >= $2
            AND appointment_date <= $3
          GROUP BY DATE(appointment_date)
          ORDER BY DATE(appointment_date) ASC;
        `;
      const params = [clinicId, start.toISOString(), end.toISOString()];
      const dbAny = database as any;
      let res: any;
      if (typeof dbAny.query === 'function') {
        res = await dbAny.query(fallbackSql, params);
        rows = res.rows ?? [];
      } else if (typeof dbAny.execute === 'function') {
        res = await dbAny.execute(fallbackSql, params);
        rows = res.rows ?? [];
      } else {
        throw err;
      }
    }

    const countsMap = new Map<string, number>();
    for (const r of rows) {
      const dateStr =
        r.date instanceof Date
          ? r.date.toISOString().split('T')[0]
          : String(r.date);
      countsMap.set(dateStr, Number(r.count ?? 0));
    }

    const labels: string[] = [];
    const data: number[] = [];
    const keys: string[] = [];
    const details: Array<{ date: string; count: number; label: string }> = [];

    for (
      let cur = new Date(start);
      cur <= end;
      cur.setDate(cur.getDate() + 1)
    ) {
      const key = cur.toISOString().split('T')[0];
      const label = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(cur);

      const count = countsMap.get(key) ?? 0;
      keys.push(key);
      labels.push(label);
      data.push(count);
      details.push({ date: key, count, label });
    }

    return {
      labels,
      data,
      keys,
      details,
      range: { start: start.toISOString(), end: end.toISOString() },
      raw: rows,
    };
  }

  /**
   * Completed appointments aggregated by month. `opts.months` looks back from
   * now (default 12); `startDate`/`endDate` override the range inclusively.
   */
  static async getCompletedAppointmentsByMonth(
    clinicId: string,
    opts?: {
      months?: number;
      startDate?: string | Date;
      endDate?: string | Date;
    }
  ) {
    const months = opts?.months ?? 12;
    const now = new Date();
    let end = opts?.endDate ? new Date(opts.endDate) : startOfMonth(now);
    end = startOfMonth(end);
    let start: Date;
    if (opts?.startDate) {
      start = startOfMonth(new Date(opts.startDate));
    } else {
      start = addMonths(end, -(months - 1));
    }

    // Attempt native Drizzle query first (date_trunc via sql``).
    // If your Drizzle setup doesn't support running such sql expressions inside groupBy/orderBy,
    // the code falls back to raw SQL at the bottom.
    let rows: Array<any> = [];
    try {
      rows = await database
        .select({
          month: sql`date_trunc('month', ${AppointmentModel.appointmentDate} AT TIME ZONE 'UTC')`,
          year: sql`EXTRACT(YEAR FROM date_trunc('month', ${AppointmentModel.appointmentDate} AT TIME ZONE 'UTC'))::int`,
          month_num: sql`EXTRACT(MONTH FROM date_trunc('month', ${AppointmentModel.appointmentDate} AT TIME ZONE 'UTC'))::int`,
          count: sql`COUNT(*)::int`,
        })
        .from(AppointmentModel)
        .where(
          and(
            eq(AppointmentModel.appointmentStatus, 'Completed'),
            eq(AppointmentModel.clinicId, clinicId),
            gte(AppointmentModel.appointmentDate, new Date(start)),
            lt(AppointmentModel.appointmentDate, addMonths(end, 1))
          )
        )
        .groupBy(
          sql`date_trunc('month', ${AppointmentModel.appointmentDate} AT TIME ZONE 'UTC')`
        )
        .orderBy(
          sql`date_trunc('month', ${AppointmentModel.appointmentDate} AT TIME ZONE 'UTC') asc`
        );
      // `rows` should be an array of objects with keys: month, year, month_num, count
    } catch (err) {
      // Fallback: if Drizzle SQL expression fails in your environment, use raw SQL
      const fallbackSql = `
        SELECT
          date_trunc('month', appointment_date AT TIME ZONE 'UTC') AS month,
          EXTRACT(YEAR FROM date_trunc('month', appointment_date AT TIME ZONE 'UTC'))::int AS year,
          EXTRACT(MONTH FROM date_trunc('month', appointment_date AT TIME ZONE 'UTC'))::int AS month_num,
          COUNT(*)::int AS count
        FROM appointments
        WHERE appointment_status = 'Completed'
          AND clinic_id = $1
          AND appointment_date >= $2
          AND appointment_date < ($3 + INTERVAL '1 month')
        GROUP BY month
        ORDER BY month ASC;
      `;
      const params = [clinicId, start.toISOString(), end.toISOString()];

      // run raw SQL using Drizzle's underlying driver if available
      const dbAny = database as any;
      let res: any;
      if (typeof dbAny.query === 'function') {
        res = await dbAny.query(fallbackSql, params);
        rows = res.rows;
      } else if (typeof dbAny.execute === 'function') {
        res = await dbAny.execute(fallbackSql, params);
        rows = res.rows ?? res;
      } else {
        // as a last resort, throw the original error to surface it
        throw err;
      }
    }

    // Normalize results into a map keyed by "YYYY-MM"
    const countsMap = new Map<string, number>();
    for (const r of rows) {
      const yr = Number(r.year);
      const mn = Number(r.month_num);
      const key = `${yr}-${String(mn).padStart(2, '0')}`;
      countsMap.set(key, Number(r.count ?? 0));
    }

    // Build continuous list of months between start and end inclusive
    const labels: string[] = [];
    const data: number[] = [];
    const keys: string[] = [];
    for (let cur = new Date(start); cur <= end; cur = addMonths(cur, 1)) {
      const key = monthKey(cur);
      keys.push(key);
      labels.push(formatLabel(cur));
      data.push(countsMap.get(key) ?? 0);
    }

    return {
      labels,
      data,
      keys,
      range: { start: start.toISOString(), end: end.toISOString() },
      raw: rows,
    };
  }

  /**
   * Example: extend your existing getDashboardData using Drizzle queries.
   * This uses Drizzle-native selects for the simple counts and the above timeseries method.
   */
  static async getDashboardData(clinicId: string, user: AuthUser, opts?: any) {
    return await database.transaction(async (tx) => {
      // Unify date parameters: prioritize startDate/endDate, fallback to dateRangeStartCount/dateRangeEndCount
      const startDateVal = opts.startDate || opts.dateRangeStartCount;
      const endDateVal = opts.endDate || opts.dateRangeEndCount;

      const appointmentConditions = [];
      const earningConditions = [];
      const patientConditions = []; // For new/total patients based on assignment/creation

      if (user.userType === 'Doctor') {
        appointmentConditions.push(eq(AppointmentModel.doctorId, user.id));
        earningConditions.push(
          eq(ClinicAppointmentPlainModel.doctorId, user.id)
        );
      }

      if (startDateVal) {
        const d = new Date(startDateVal);
        appointmentConditions.push(gte(AppointmentModel.createdAt, d));
        earningConditions.push(gte(ClinicAppointmentPlainModel.createdAt, d));
        patientConditions.push(gte(ClinicAssignModel.createdAt, d));
      }

      if (endDateVal) {
        const d = new Date(endDateVal);
        d.setHours(23, 59, 59, 999);
        appointmentConditions.push(lte(AppointmentModel.createdAt, d));
        earningConditions.push(lte(ClinicAppointmentPlainModel.createdAt, d));
        patientConditions.push(lte(ClinicAssignModel.createdAt, d));
      }

      // Parallelize independent count queries
      const [
        newPatientsRes,
        totalNewAppointmentsRes,
        totalNoShowAppointmentsRes,
      ] = await Promise.all([
        tx
          .select({ count: sql`COUNT(${UserModel.id})::int` })
          .from(UserModel)
          .innerJoin(
            ClinicAssignModel,
            eq(UserModel.id, ClinicAssignModel.userId)
          )
          .where(
            and(
              eq(UserModel.userStatus, 'New'),
              eq(UserModel.userType, 'Patient'),
              eq(ClinicAssignModel.clinicId, clinicId),
              ...patientConditions
            )
          ),
        tx
          .select({ count: sql`COUNT(${AppointmentModel.id})::int` })
          .from(AppointmentModel)
          .where(
            and(
              eq(AppointmentModel.appointmentStatus, 'Confirmed'),
              eq(AppointmentModel.clinicId, clinicId),
              ...appointmentConditions
            )
          ),
        tx
          .select({ count: sql`COUNT(${AppointmentModel.id})::int` })
          .from(AppointmentModel)
          .where(
            and(
              eq(AppointmentModel.appointmentStatus, 'NoShow'),
              eq(AppointmentModel.clinicId, clinicId),
              ...appointmentConditions
            )
          ),
      ]);

      const newPatientsCount =
        (newPatientsRes &&
          newPatientsRes[0] &&
          Number((newPatientsRes[0] as any).count)) ||
        0;
      const totalAppointmentsCount =
        (totalNewAppointmentsRes &&
          totalNewAppointmentsRes[0] &&
          Number((totalNewAppointmentsRes[0] as any).count)) ||
        0;
      const totalNoShowCount =
        (totalNoShowAppointmentsRes &&
          totalNoShowAppointmentsRes[0] &&
          Number((totalNoShowAppointmentsRes[0] as any).count)) ||
        0;

      // completed appointments series (date-wise)
      // Ensure series respects the unified date range
      const series = await DashboardService.getCompletedAppointmentsByDate(
        clinicId,
        { ...opts, startDate: startDateVal, endDate: endDateVal }
      );

      // no show appointments series (date-wise)
      const noShowSeries = await DashboardService.getNoShowAppointmentsByDate(
        clinicId,
        { ...opts, startDate: startDateVal, endDate: endDateVal }
      );

      const upcomingAppointmentsRes = await tx
        .select({
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
          appointmentDate: AppointmentModel.appointmentDate,
          appointmentTime: AppointmentModel.appointmentTime,
          appointmentType: AppointmentModel.appointmentType,
          appointmentNotes: AppointmentClinicalModel.appointmentNotes,
          appointmentStatus: AppointmentModel.appointmentStatus,
        })
        .from(AppointmentModel)
        .innerJoin(UserModel, eq(AppointmentModel.patientId, UserModel.id))
        .leftJoin(
          AppointmentClinicalModel,
          eq(AppointmentModel.id, AppointmentClinicalModel.appointmentId)
        )
        .where(
          and(
            eq(AppointmentModel.appointmentStatus, 'Upcoming'),
            eq(AppointmentModel.clinicId, clinicId),
            ...appointmentConditions
          )
        );
      // Parallelize the second batch of independent queries
      const [
        [totalPatientsCount],
        [totalAppointmentsRes],
        patientData,
        [totalPendingAppointments],
        [totalUpcomingAppointments],
        [totalConfirmedAppointments],
        [totalCancelledAppointments],
        totalApoinmentPatient,
        [totalErning],
      ] = await Promise.all([
        tx
          .select({ count: sql`COUNT(${UserModel.id})::int` })
          .from(UserModel)
          .innerJoin(
            ClinicAssignModel,
            eq(UserModel.id, ClinicAssignModel.userId)
          )
          .where(
            and(
              eq(ClinicAssignModel.clinicId, clinicId),
              eq(UserModel.userType, 'Patient'),
              ...patientConditions
            )
          ),
        tx
          .select({ count: sql`COUNT(${AppointmentModel.id})::int` })
          .from(AppointmentModel)
          .where(
            and(
              eq(AppointmentModel.clinicId, clinicId),
              ...appointmentConditions
            )
          ),
        tx
          .select({
            id: UserModel.id,
            name: UserModel.name,
            email: UserModel.email,
            profileImage: UserProfileModel.profileImage,
            appoinmentId: AppointmentModel.id,
            appointmentDate: AppointmentModel.appointmentDate,
            appointmentTime: AppointmentModel.appointmentTime,
            appointmentType: AppointmentModel.appointmentType,
            appointmentStatus: AppointmentModel.appointmentStatus,
          })
          .from(AppointmentModel)
          .innerJoin(UserModel, eq(AppointmentModel.patientId, UserModel.id))
          .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
          .where(
            and(
              eq(AppointmentModel.clinicId, clinicId),
              ...appointmentConditions
            )
          )
          .orderBy(desc(AppointmentModel.appointmentDate))
          .limit(5),
        tx
          .select({ count: sql`COUNT(${AppointmentModel.id})::int` })
          .from(AppointmentModel)
          .where(
            and(
              eq(AppointmentModel.appointmentStatus, 'Pending'),
              eq(AppointmentModel.clinicId, clinicId),
              ...appointmentConditions
            )
          ),
        tx
          .select({ count: sql`COUNT(${AppointmentModel.id})::int` })
          .from(AppointmentModel)
          .where(
            and(
              eq(AppointmentModel.appointmentStatus, 'Upcoming'),
              eq(AppointmentModel.clinicId, clinicId),
              ...appointmentConditions
            )
          ),
        tx
          .select({ count: sql`COUNT(${AppointmentModel.id})::int` })
          .from(AppointmentModel)
          .where(
            and(
              eq(AppointmentModel.appointmentStatus, 'Confirmed'),
              eq(AppointmentModel.clinicId, clinicId),
              ...appointmentConditions
            )
          ),
        tx
          .select({ count: sql`COUNT(${AppointmentModel.id})::int` })
          .from(AppointmentModel)
          .where(
            and(
              eq(AppointmentModel.appointmentStatus, 'Cancelled'),
              eq(AppointmentModel.clinicId, clinicId),
              ...appointmentConditions
            )
          ),
        tx
          .select({ count: sql`COUNT(${AppointmentModel.id})::int` })
          .from(AppointmentModel)
          .where(
            and(
              eq(AppointmentModel.clinicId, clinicId),
              ...appointmentConditions
            )
          ),
        tx
          .select({
            count: sql`SUM(${ClinicAppointmentPlainModel.amount})::int`,
          })
          .from(ClinicAppointmentPlainModel)
          .where(
            and(
              eq(ClinicAppointmentPlainModel.clinicId, clinicId),
              ...earningConditions
            )
          ),
      ]);

      // Symptom statistics
      const symptomConditions = [eq(ClinicSymptomModel.clinicId, clinicId)];

      if (startDateVal) {
        const normalizedStart =
          AppointmentService.normalizeToDateOnly(startDateVal);
        if (normalizedStart) {
          symptomConditions.push(
            gte(ClinicSymptomCountModel.date, normalizedStart)
          );
        }
      }

      if (endDateVal) {
        const normalizedEnd =
          AppointmentService.normalizeToDateOnly(endDateVal);
        if (normalizedEnd) {
          symptomConditions.push(
            lte(ClinicSymptomCountModel.date, normalizedEnd)
          );
        }
      }

      const symptomStats = await tx
        .select({
          symptomId: ClinicSymptomModel.id,
          symptomName: ClinicSymptomModel.name,
          count: sql`SUM(${ClinicSymptomCountModel.count})::int`,
        })
        .from(ClinicSymptomCountModel)
        .innerJoin(
          ClinicSymptomModel,
          eq(ClinicSymptomCountModel.symptomId, ClinicSymptomModel.id)
        )
        .where(and(...symptomConditions))
        .groupBy(ClinicSymptomModel.id, ClinicSymptomModel.name)
        .orderBy(desc(sql`SUM(${ClinicSymptomCountModel.count})`));

      return {
        appointment: {
          totalPendingAppointments,
          totalUpcomingAppointments,
          totalConfirmedAppointments,
          totalCancelledAppointments,
          totalNoShowCount,
          totalApoinmentPatient,
          totalErning,
        },
        newPatients: newPatientsCount,
        totalNewAppointments: totalAppointmentsCount,
        completedAppointmentsSeries: series,
        noShowAppointmentsSeries: noShowSeries,
        upcomingAppointmentsRes,
        totalPatientsCount: totalPatientsCount.count,
        totalAppointmentsCount: totalAppointmentsRes.count,
        patientData,
        symptomStats,
      };
    });
  }

  static async getDoctorDashboardData(
    clinicId: string,
    doctorId: string,
    opts: {
      startDate?: string;
      endDate?: string;
    }
  ) {
    // 1. Determine Date Ranges
    const today = new Date();
    // Default to current month if not provided
    const currentStart = opts.startDate
      ? new Date(opts.startDate)
      : new Date(today.getFullYear(), today.getMonth(), 1);
    const currentEnd = opts.endDate
      ? new Date(opts.endDate)
      : new Date(today.getFullYear(), today.getMonth() + 1, 0);

    // If start/end provided via standard query params, prioritize them.
    // The user also mentioned dateRangestartCount/dateRangeEndCount, likely for specific counters.
    // For simplicity and consistency with the request "hikePersent ... calculate based on past X days",
    // we use one main range for the dashboard stats.

    // Ensure 23:59:59 for end date
    currentEnd.setHours(23, 59, 59, 999);
    currentStart.setHours(0, 0, 0, 0);

    const durationMs = currentEnd.getTime() - currentStart.getTime();
    // Previous range: ending just before current start, same duration
    const previousEnd = new Date(currentStart.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - durationMs);

    // Helper to calculate percentage and format string
    const calculateHike = (current: number, previous: number) => {
      let percent = 0;
      if (previous === 0) {
        percent = current > 0 ? 100 : 0;
      } else {
        percent = ((current - previous) / previous) * 100;
      }
      const formattedPercent =
        percent > 0 ? `+${percent.toFixed(0)}` : percent.toFixed(0);
      return `${formattedPercent} (${previous})`; // Format: +12 (10)
    };

    // Helper to run count queries for a specific range
    const getStatsForRange = async (start: Date, end: Date) => {
      return await database.transaction(async (tx) => {
        // Earning
        const [earningRes] = await tx
          .select({
            total: sql`SUM(${ClinicAppointmentPlainModel.amount})::int`,
          })
          .from(ClinicAppointmentPlainModel)
          .where(
            and(
              eq(ClinicAppointmentPlainModel.clinicId, clinicId),
              eq(ClinicAppointmentPlainModel.doctorId, doctorId),
              between(ClinicAppointmentPlainModel.createdAt, start, end)
            )
          );
        // Appointments (Total, Confirmed, Pending, NoShow)
        const counts = await tx
          .select({
            status: AppointmentModel.appointmentStatus,
            count: sql`COUNT(*)::int`,
          })
          .from(AppointmentModel)
          .where(
            and(
              eq(AppointmentModel.clinicId, clinicId),
              eq(AppointmentModel.doctorId, doctorId),
              between(AppointmentModel.appointmentDate, start, end)
            )
          )
          .groupBy(AppointmentModel.appointmentStatus);

        let totalAppoiment = 0;
        let totalConfirmedAppointments = 0;
        let totalPendigAppointments = 0;
        let totalNoShowAppointments = 0;

        counts.forEach((c) => {
          const cnt = Number(c.count);
          totalAppoiment += cnt;
          if (c.status === 'Confirmed') totalConfirmedAppointments += cnt;
          if (c.status === 'Pending') totalPendigAppointments += cnt;
          if (c.status === 'NoShow') totalNoShowAppointments += cnt;
        });

        // Unique Patients
        const [uniquePatients] = await tx
          .select({
            count: sql`COUNT(DISTINCT ${AppointmentModel.patientId})::int`,
          })
          .from(AppointmentModel)
          .where(
            and(
              eq(AppointmentModel.clinicId, clinicId),
              eq(AppointmentModel.doctorId, doctorId),
              between(AppointmentModel.appointmentDate, start, end)
            )
          );

        return {
          earning: Number(earningRes?.total || 0),
          totalAppoiment,
          totalConfirmedAppointments,
          totalPendigAppointments,
          totalNoShowAppointments,
          totalApoinmentPatient: Number(uniquePatients?.count || 0),
        };
      });
    };

    const currentStats = await getStatsForRange(currentStart, currentEnd);
    const prevStats = await getStatsForRange(previousStart, previousEnd);

    // Appointment Stats (Daily counts for the current range)
    // Using existing getCompletedAppointmentsByDate logic but filtered for Doctor
    // Note: getCompletedAppointmentsByDate is filtering by 'Completed' status.
    // The requirement says "appoinmentStats", usually implies all or a specific subset.
    // The example shows simple date/count. Let's assume ALL appointments for the doctor for now.

    const dailyStatsRes = await database
      .select({
        date: sql`DATE(${AppointmentModel.appointmentDate})`,
        count: sql`COUNT(*)::int`,
        noShowCount: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'NoShow' THEN 1 END)::int`,
      })
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.clinicId, clinicId),
          eq(AppointmentModel.doctorId, doctorId),
          between(AppointmentModel.appointmentDate, currentStart, currentEnd)
        )
      )
      .groupBy(sql`DATE(${AppointmentModel.appointmentDate})`)
      .orderBy(sql`DATE(${AppointmentModel.appointmentDate}) asc`);

    const appoinmentStats = dailyStatsRes.map((r) => ({
      date:
        r.date instanceof Date
          ? r.date.toISOString().split('T')[0]
          : String(r.date),
      count: Number(r.count),
      noShowCount: Number(r.noShowCount),
    }));

    // Fill in missing dates with 0
    const statsMap = new Map(
      appoinmentStats.map((s) => [
        s.date,
        { count: s.count, noShowCount: s.noShowCount },
      ])
    );
    const filledStats = [];
    for (
      let d = new Date(currentStart);
      d <= currentEnd;
      d.setDate(d.getDate() + 1)
    ) {
      const dateStr = d.toISOString().split('T')[0];
      const entry = statsMap.get(dateStr) || { count: 0, noShowCount: 0 };
      filledStats.push({
        date: dateStr,
        count: entry.count,
        noShowCount: entry.noShowCount,
      });
    }

    // Pending Appointments List
    const pendingAppointmentRows = await database
      .select({
        id: UserModel.id, // Patient ID? User example shows "id" separate from "appoinmentId"
        name: UserModel.name,
        profileImage: UserProfileModel.profileImage,
        gender: UserProfileModel.gender,
        age: UserProfileModel.age,
        mobile: UserModel.mobile,
        appoinmentId: AppointmentModel.id,
        appointmentDate: AppointmentModel.appointmentDate,
        appointmentTime: AppointmentModel.appointmentTime,
        appointmentType: AppointmentModel.appointmentType,
        appointmentNotes: AppointmentClinicalModel.appointmentNotes,
        commonSymptoms: AppointmentClinicalModel.commonSymptoms,
        clinicSymptomIds: AppointmentClinicalModel.clinicSymptomIds,
        tokenNo: AppointmentModel.tokenNo,
        payment: {
          paymentMode: AppointmentPaymentModel.paymentMode,
          paymentStatus: AppointmentPaymentModel.paymentStatus,
          price: AppointmentPaymentModel.price,
        },
      })
      .from(AppointmentModel)
      .innerJoin(UserModel, eq(AppointmentModel.patientId, UserModel.id))
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .leftJoin(
        AppointmentPaymentModel,
        eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
      )
      .leftJoin(
        AppointmentClinicalModel,
        eq(AppointmentModel.id, AppointmentClinicalModel.appointmentId)
      )
      .where(
        and(
          eq(AppointmentModel.clinicId, clinicId),
          eq(AppointmentModel.doctorId, doctorId),
          eq(AppointmentModel.appointmentStatus, 'Pending'),
          between(AppointmentModel.appointmentDate, currentStart, currentEnd)
        )
      )
      .limit(10); // Logic for limit not specified, assuming reasonable limit

    const clinicSymptomIds = Array.from(
      new Set(
        pendingAppointmentRows.flatMap((appointment) =>
          Array.isArray(appointment.clinicSymptomIds)
            ? appointment.clinicSymptomIds
            : []
        )
      )
    );

    const clinicSymptoms =
      clinicSymptomIds.length > 0
        ? await database
            .select({
              id: ClinicSymptomModel.id,
              name: ClinicSymptomModel.name,
            })
            .from(ClinicSymptomModel)
            .where(inArray(ClinicSymptomModel.id, clinicSymptomIds))
        : [];

    const clinicSymptomNameById = new Map(
      clinicSymptoms.map((symptom) => [symptom.id, symptom.name])
    );

    const pendingAppointment = pendingAppointmentRows.map((appointment) => {
      const commonSymptoms = Array.isArray(appointment.commonSymptoms)
        ? appointment.commonSymptoms
        : [];
      const clinicSymptomNames = Array.isArray(appointment.clinicSymptomIds)
        ? appointment.clinicSymptomIds
            .map((symptomId) => clinicSymptomNameById.get(symptomId))
            .filter((symptom): symptom is string => Boolean(symptom))
        : [];
      const symptoms = cleanText(
        [...commonSymptoms, ...clinicSymptomNames].join(', ')
      );
      const reasonForVisit = resolveReasonForVisit(
        appointment.appointmentNotes,
        symptoms,
        appointment.appointmentType
      );

      return {
        id: appointment.id,
        name: appointment.name,
        profileImage: appointment.profileImage,
        gender: appointment.gender,
        age: appointment.age,
        mobile: appointment.mobile,
        appoinmentId: appointment.appoinmentId,
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime,
        appointmentType: appointment.appointmentType,
        reasonForVisit,
        symptoms,
        tokenNo: appointment.tokenNo,
        payment: appointment.payment,
      };
    });

    return {
      status: {
        totalEarning: {
          amount: currentStats.earning,
          hikePersent: calculateHike(currentStats.earning, prevStats.earning),
        },
        totalAppoiment: {
          count: currentStats.totalAppoiment,
          hikePersent: calculateHike(
            currentStats.totalAppoiment,
            prevStats.totalAppoiment
          ),
        },
        totalConfirmedAppointments: {
          count: currentStats.totalConfirmedAppointments,
          hikePersent: calculateHike(
            currentStats.totalConfirmedAppointments,
            prevStats.totalConfirmedAppointments
          ),
        },
        totalPendigAppointments: {
          count: currentStats.totalPendigAppointments,
          hikePersent: calculateHike(
            currentStats.totalPendigAppointments,
            prevStats.totalPendigAppointments
          ),
        },
        totalNoShowAppointments: {
          count: currentStats.totalNoShowAppointments,
          hikePersent: calculateHike(
            currentStats.totalNoShowAppointments,
            prevStats.totalNoShowAppointments
          ),
        },
        totalApoinmentPatient: [{ count: currentStats.totalApoinmentPatient }],
        // Note: formatted as array object per requirement example
      },
      appoinmentStats: filledStats,
      pendingAppointment,
    };
  }

  /**
   * Doctor Dashboard v2: one aggregate query per period, counts and earnings
   * sourced from real appointment statuses, and two-tier Redis caching split by
   * volatility. See docs/DOCTOR_DASHBOARD.md for the full write-up.
   *
   * Live tier (45s): status counts, earnings, trends, pending list.
   * Analytics tier (5min): peak hours, new-vs-returning — slow-moving, and
   * skipped entirely on a live-cache-miss-only request.
   */
  static async getDoctorDashboardDataV2(
    clinicId: string,
    doctorId: string,
    opts: { startDate?: string; endDate?: string }
  ) {
    const today = new Date();
    const currentStart = opts.startDate
      ? new Date(opts.startDate)
      : new Date(today.getFullYear(), today.getMonth(), 1);
    const currentEnd = opts.endDate
      ? new Date(opts.endDate)
      : new Date(today.getFullYear(), today.getMonth() + 1, 0);
    currentEnd.setHours(23, 59, 59, 999);
    currentStart.setHours(0, 0, 0, 0);

    const durationMs = currentEnd.getTime() - currentStart.getTime();
    const previousEnd = new Date(currentStart.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - durationMs);

    const startStr = currentStart.toISOString().split('T')[0];
    const endStr = currentEnd.toISOString().split('T')[0];
    // Every appointment change bumps the version, so a cancel shows at once instead of after the TTL.
    const version = await getDashboardCacheVersion(clinicId);
    const liveCacheKey = CacheKeys.doctorDashboardV2Live(
      clinicId,
      doctorId,
      version,
      startStr,
      endStr
    );
    const analyticsCacheKey = CacheKeys.doctorDashboardV2Analytics(
      clinicId,
      doctorId,
      version,
      startStr,
      endStr
    );

    // Trend chart + Breakdown donut always show these two fixed ranges,
    // independent of whatever range the rest of the dashboard was asked for —
    // a single day's trend chart is one dot, not a trend. Computed alongside
    // everything else in the same request/cache entry so the frontend needs
    // no second API call to get them.
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    monthEnd.setHours(23, 59, 59, 999);

    const weekEnd = new Date(today);
    weekEnd.setHours(23, 59, 59, 999);
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    const calculateHike = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    // Single aggregate query per date range: counts by status + earning + unique patients
    const getStatsForRange = async (start: Date, end: Date) => {
      const [row] = await database
        .select({
          total: sql<number>`COUNT(*)::int`,
          confirmed: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Confirmed' THEN 1 END)::int`,
          pending: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Pending' THEN 1 END)::int`,
          noShow: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'NoShow' THEN 1 END)::int`,
          completed: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Completed' THEN 1 END)::int`,
          cancelled: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Cancelled' THEN 1 END)::int`,
          waiting: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Patient Arrived' THEN 1 END)::int`,
          uniquePatients: sql<number>`COUNT(DISTINCT ${AppointmentModel.patientId})::int`,
          earning: sql<number>`COALESCE(SUM(
            CASE
              WHEN ${AppointmentPaymentModel.paymentStatus} = 'Paid' THEN ${AppointmentPaymentModel.price}::numeric
              WHEN ${AppointmentPaymentModel.paymentStatus} = 'Refunded' THEN
                ${AppointmentPaymentModel.price}::numeric - COALESCE(${AppointmentPaymentModel.refundedAmount}::numeric, ${AppointmentPaymentModel.price}::numeric)
              ELSE 0
            END
          ), 0)::float`,
        })
        .from(AppointmentModel)
        .leftJoin(
          AppointmentPaymentModel,
          eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
        )
        .where(
          and(
            eq(AppointmentModel.clinicId, clinicId),
            eq(AppointmentModel.doctorId, doctorId),
            between(AppointmentModel.appointmentDate, start, end)
          )
        );

      const total = Number(row?.total || 0);
      const completed = Number(row?.completed || 0);
      const cancelled = Number(row?.cancelled || 0);
      const noShow = Number(row?.noShow || 0);

      // The queue engine's "Send In" doesn't write appointmentStatus (it only
      // moves a Redis room pointer, see queueHoldStore.service.ts), so the
      // patient currently with the doctor still reads as 'Patient Arrived'
      // here and would otherwise double-count as both "waiting" and "in
      // room". Only relevant for a range that includes today — the pointer
      // is date-scoped and has no meaning for past/future ranges.
      let waiting = Number(row?.waiting || 0);
      if (waiting > 0 && start <= today && today <= end) {
        const currentAppointmentId = await getCurrentAppointmentId(
          clinicId,
          doctorId,
          getISTDateString(today)
        );
        if (currentAppointmentId) {
          const [currentAppt] = await database
            .select({ status: AppointmentModel.appointmentStatus })
            .from(AppointmentModel)
            .where(eq(AppointmentModel.id, currentAppointmentId));
          if (currentAppt?.status === 'Patient Arrived') {
            waiting = Math.max(0, waiting - 1);
          }
        }
      }

      return {
        total,
        confirmed: Number(row?.confirmed || 0),
        pending: Number(row?.pending || 0),
        noShow,
        completed,
        cancelled,
        waiting,
        // Remaining = anything not yet finalized (excludes completed/cancelled/no-show)
        remaining: Math.max(0, total - completed - cancelled - noShow),
        uniquePatients: Number(row?.uniquePatients || 0),
        earning: Number(row?.earning || 0),
      };
    };

    // Y-M-D from a Date's local fields, not `.toISOString()`. This server
    // runs in IST (UTC+5:30): converting local midnight to UTC before
    // stringifying rolls it back to the previous calendar day, so today's row
    // silently keyed itself as "yesterday" and never matched anything the
    // loop below was looking for — today's data wasn't missing, just filed
    // under a date nobody asked for.
    const toLocalYMD = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    // Day-by-day counts for a range, gaps filled with zero — the series the
    // Trend chart renders. Extracted so the month/past-7-days trend blocks
    // below can reuse it instead of duplicating the groupBy + fill-gaps logic
    // that used to be inlined only for the page-filtered range.
    const buildDailySeries = async (start: Date, end: Date) => {
      const rows = await database
        .select({
          date: sql<string>`DATE(${AppointmentModel.appointmentDate})`,
          count: sql<number>`COUNT(*)::int`,
          noShowCount: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'NoShow' THEN 1 END)::int`,
          completedCount: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Completed' THEN 1 END)::int`,
        })
        .from(AppointmentModel)
        .where(
          and(
            eq(AppointmentModel.clinicId, clinicId),
            eq(AppointmentModel.doctorId, doctorId),
            between(AppointmentModel.appointmentDate, start, end)
          )
        )
        .groupBy(sql`DATE(${AppointmentModel.appointmentDate})`)
        .orderBy(sql`DATE(${AppointmentModel.appointmentDate}) asc`);

      const map = new Map(
        rows.map((r) => [
          (r.date as unknown) instanceof Date
            ? toLocalYMD(r.date as unknown as Date)
            : String(r.date),
          {
            count: Number(r.count),
            noShowCount: Number(r.noShowCount),
            completedCount: Number(r.completedCount),
          },
        ])
      );

      const series = [];
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = toLocalYMD(d);
        series.push({
          date: dateStr,
          ...(map.get(dateStr) || {
            count: 0,
            noShowCount: 0,
            completedCount: 0,
          }),
        });
      }
      return series;
    };

    // Status counts in the shape the Breakdown donut wants — a subset of
    // `getStatsForRange`'s fields, named to match `status.*Appointments`
    // above so the frontend can build the same {label,value,color} rows it
    // already builds for the page-filtered range.
    const getStatusCounts = async (start: Date, end: Date) => {
      const stats = await getStatsForRange(start, end);
      return {
        completed: stats.completed,
        confirmed: stats.confirmed,
        pending: stats.pending,
        waiting: stats.waiting,
        cancelled: stats.cancelled,
        noShow: stats.noShow,
      };
    };

    // New vs returning patients for a range — "new" means no appointment with
    // this doctor before `start`. Mirrors getTodayOverview's getPatientStats,
    // but scoped to the *selected* date range instead of a hardcoded 30 days,
    // so it stays consistent with every other card on this dashboard.
    const getPatientTypeStats = async (start: Date, end: Date) => {
      const patientsInRange = await database
        .selectDistinct({ patientId: AppointmentModel.patientId })
        .from(AppointmentModel)
        .where(
          and(
            eq(AppointmentModel.clinicId, clinicId),
            eq(AppointmentModel.doctorId, doctorId),
            between(AppointmentModel.appointmentDate, start, end)
          )
        );
      const patientIds = patientsInRange.map((p) => p.patientId);
      if (patientIds.length === 0) {
        return { newPatients: 0, returningPatients: 0 };
      }

      const returningRows = await database
        .selectDistinct({ patientId: AppointmentModel.patientId })
        .from(AppointmentModel)
        .where(
          and(
            eq(AppointmentModel.clinicId, clinicId),
            eq(AppointmentModel.doctorId, doctorId),
            lt(AppointmentModel.appointmentDate, start),
            inArray(AppointmentModel.patientId, patientIds)
          )
        );

      const returningPatients = returningRows.length;
      return {
        newPatients: patientIds.length - returningPatients,
        returningPatients,
      };
    };

    const [cachedLive, cachedAnalytics] = await Promise.all([
      redisClient.get(liveCacheKey),
      redisClient.get(analyticsCacheKey),
    ]);

    type StatusCounts = {
      completed: number;
      confirmed: number;
      pending: number;
      waiting: number;
      cancelled: number;
      noShow: number;
    };
    type TrendSeries = Array<{
      date: string;
      count: number;
      noShowCount: number;
      completedCount: number;
    }>;
    type LiveSlice = {
      currentStats: Awaited<ReturnType<typeof getStatsForRange>>;
      prevStats: Awaited<ReturnType<typeof getStatsForRange>>;
      appointmentStats: TrendSeries;
      pendingAppointments: unknown[];
      trends: {
        thisMonth: {
          appointmentStats: TrendSeries;
          statusCounts: StatusCounts;
        };
        pastWeek: { appointmentStats: TrendSeries; statusCounts: StatusCounts };
      };
      todaySessions: Array<{
        sessionIndex: number;
        start: string;
        end: string;
      }>;
    };

    let live: LiveSlice;
    if (cachedLive) {
      live = JSON.parse(cachedLive);
    } else {
      const [
        currentStats,
        prevStats,
        appointmentStats,
        pendingAppointmentRows,
      ] = await Promise.all([
        getStatsForRange(currentStart, currentEnd),
        getStatsForRange(previousStart, previousEnd),
        buildDailySeries(currentStart, currentEnd),
        database
          .select({
            id: UserModel.id,
            name: UserModel.name,
            profileImage: UserProfileModel.profileImage,
            gender: UserProfileModel.gender,
            age: UserProfileModel.age,
            mobile: UserModel.mobile,
            appointmentId: AppointmentModel.id,
            appointmentDate: AppointmentModel.appointmentDate,
            appointmentTime: AppointmentModel.appointmentTime,
            appointmentType: AppointmentModel.appointmentType,
            appointmentStatus: AppointmentModel.appointmentStatus,
            appointmentNotes: AppointmentClinicalModel.appointmentNotes,
            commonSymptoms: AppointmentClinicalModel.commonSymptoms,
            clinicSymptomIds: AppointmentClinicalModel.clinicSymptomIds,
            tokenNo: AppointmentModel.tokenNo,
            // Numbering restarts every sitting, so the token alone cannot
            // identify an appointment — two "Token 1"s in a day is normal.
            sessionIndex: AppointmentModel.sessionIndex,
            payment: {
              paymentMode: AppointmentPaymentModel.paymentMode,
              paymentStatus: AppointmentPaymentModel.paymentStatus,
              price: AppointmentPaymentModel.price,
            },
          })
          .from(AppointmentModel)
          .innerJoin(UserModel, eq(AppointmentModel.patientId, UserModel.id))
          .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
          .leftJoin(
            AppointmentPaymentModel,
            eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
          )
          .leftJoin(
            AppointmentClinicalModel,
            eq(AppointmentModel.id, AppointmentClinicalModel.appointmentId)
          )
          .where(
            and(
              eq(AppointmentModel.clinicId, clinicId),
              eq(AppointmentModel.doctorId, doctorId),
              between(
                AppointmentModel.appointmentDate,
                currentStart,
                currentEnd
              )
            )
          )
          .orderBy(
            sql`CASE ${AppointmentModel.appointmentStatus}
                WHEN 'Confirmed' THEN 0
                WHEN 'Patient Arrived' THEN 1
                WHEN 'Upcoming' THEN 2
                WHEN 'Pending' THEN 2
                ELSE 3
              END`,
            asc(AppointmentModel.appointmentTime),
            asc(AppointmentModel.tokenNo)
          )
          .limit(200),
      ]);

      // Trend chart + Breakdown donut's two fixed ranges. Skip recomputing
      // whichever one the caller's own requested range already matches (e.g.
      // the page filter is already "This Month") — `currentStats`/
      // `appointmentStats` above already are that range's data.
      const monthMatchesCurrent =
        monthStart.getTime() === currentStart.getTime() &&
        monthEnd.getTime() === currentEnd.getTime();
      const weekMatchesCurrent =
        weekStart.getTime() === currentStart.getTime() &&
        weekEnd.getTime() === currentEnd.getTime();
      const statusCountsFromStats = (
        s: Awaited<ReturnType<typeof getStatsForRange>>
      ): StatusCounts => ({
        completed: s.completed,
        confirmed: s.confirmed,
        pending: s.pending,
        waiting: s.waiting,
        cancelled: s.cancelled,
        noShow: s.noShow,
      });

      const [monthStatusCounts, monthSeries, weekStatusCounts, weekSeries] =
        await Promise.all([
          monthMatchesCurrent
            ? Promise.resolve(statusCountsFromStats(currentStats))
            : getStatusCounts(monthStart, monthEnd),
          monthMatchesCurrent
            ? Promise.resolve(appointmentStats)
            : buildDailySeries(monthStart, monthEnd),
          weekMatchesCurrent
            ? Promise.resolve(statusCountsFromStats(currentStats))
            : getStatusCounts(weekStart, weekEnd),
          weekMatchesCurrent
            ? Promise.resolve(appointmentStats)
            : buildDailySeries(weekStart, weekEnd),
        ]);

      // Pending appointments list — resolve clinic-specific symptom names
      const clinicSymptomIds = Array.from(
        new Set(
          pendingAppointmentRows.flatMap((appointment) =>
            Array.isArray(appointment.clinicSymptomIds)
              ? appointment.clinicSymptomIds
              : []
          )
        )
      );

      const clinicSymptoms =
        clinicSymptomIds.length > 0
          ? await database
              .select({
                id: ClinicSymptomModel.id,
                name: ClinicSymptomModel.name,
              })
              .from(ClinicSymptomModel)
              .where(inArray(ClinicSymptomModel.id, clinicSymptomIds))
          : [];

      const clinicSymptomNameById = new Map(
        clinicSymptoms.map((symptom) => [symptom.id, symptom.name])
      );

      const pendingAppointments = pendingAppointmentRows.map((appointment) => {
        const commonSymptoms = Array.isArray(appointment.commonSymptoms)
          ? appointment.commonSymptoms
          : [];
        const clinicSymptomNames = Array.isArray(appointment.clinicSymptomIds)
          ? appointment.clinicSymptomIds
              .map((symptomId) => clinicSymptomNameById.get(symptomId))
              .filter((symptom): symptom is string => Boolean(symptom))
          : [];
        const symptoms = cleanText(
          [...commonSymptoms, ...clinicSymptomNames].join(', ')
        );
        const reasonForVisit = resolveReasonForVisit(
          appointment.appointmentNotes,
          symptoms,
          appointment.appointmentType
        );

        return {
          id: appointment.id,
          name: appointment.name,
          profileImage: appointment.profileImage,
          gender: appointment.gender,
          age: appointment.age,
          mobile: appointment.mobile,
          appointmentId: appointment.appointmentId,
          appointmentDate: appointment.appointmentDate,
          appointmentTime: appointment.appointmentTime,
          appointmentType: appointment.appointmentType,
          // The real lifecycle status, so the list can render where each
          // patient actually is instead of labelling everything "Pending".
          appointmentStatus: appointment.appointmentStatus,
          reasonForVisit,
          symptoms,
          tokenNo: appointment.tokenNo,
          sessionIndex: appointment.sessionIndex,
          payment: appointment.payment,
        };
      });

      // Today's token shifts for the dashboard's S1/S2 picker, so the page needs no slots call.
      // Token days only: a time day's lunch break is not a second shift.
      const todayYmd = getISTDateString();
      const isTokenDay = await SlotConfigService.isWeeklyTokenDay(
        clinicId,
        doctorId,
        todayYmd
      ).catch(() => false);
      const todaySessions = isTokenDay
        ? (
            await ScheduleShiftService.listSessions(
              clinicId,
              doctorId,
              todayYmd,
              true
            ).catch(() => [])
          ).map((s, i) => ({ sessionIndex: i + 1, start: s.start, end: s.end }))
        : [];

      live = {
        currentStats,
        prevStats,
        appointmentStats,
        pendingAppointments,
        todaySessions,
        trends: {
          thisMonth: {
            appointmentStats: monthSeries,
            statusCounts: monthStatusCounts,
          },
          pastWeek: {
            appointmentStats: weekSeries,
            statusCounts: weekStatusCounts,
          },
        },
      };
      await redisClient.setex(liveCacheKey, 45, JSON.stringify(live));
    }

    type AnalyticsSlice = {
      topSymptoms: DoctorTopSymptom[];
      patientTypes: {
        newPatients: { count: number; hikePercent: number; previous: number };
        returningPatients: {
          count: number;
          hikePercent: number;
          previous: number;
        };
      };
    };

    let analytics: AnalyticsSlice;
    if (cachedAnalytics) {
      analytics = JSON.parse(cachedAnalytics);
    } else {
      // Built-in symptoms (enum) and clinic-defined ones (ids) both count; cancelled visits don't.
      // ISO strings, not Dates: matches how between() binds appointment_date elsewhere here.
      const symptomVisitFilter = sql`
        ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.doctorId} = ${doctorId}
        AND ${AppointmentModel.appointmentDate} BETWEEN ${currentStart.toISOString()} AND ${currentEnd.toISOString()}
        AND ${AppointmentModel.appointmentStatus} <> 'Cancelled'`;
      const topSymptomsQuery = database.execute(sql`
        SELECT name, COUNT(*)::int AS count, SUM(COUNT(*)) OVER ()::int AS total
        FROM (
          SELECT replace(s.name::text, '_', ' ') AS name
          FROM ${AppointmentModel}
          INNER JOIN ${AppointmentClinicalModel}
            ON ${AppointmentClinicalModel.appointmentId} = ${AppointmentModel.id}
          CROSS JOIN LATERAL unnest(${AppointmentClinicalModel.commonSymptoms}) AS s(name)
          WHERE ${symptomVisitFilter}
          UNION ALL
          SELECT ${ClinicSymptomModel.name} AS name
          FROM ${AppointmentModel}
          INNER JOIN ${AppointmentClinicalModel}
            ON ${AppointmentClinicalModel.appointmentId} = ${AppointmentModel.id}
          INNER JOIN ${ClinicSymptomModel}
            ON ${ClinicSymptomModel.id} = ANY(${AppointmentClinicalModel.clinicSymptomIds})
            AND ${ClinicSymptomModel.clinicId} = ${clinicId}
          WHERE ${symptomVisitFilter}
        ) mentions
        GROUP BY name
        ORDER BY count DESC, name
        LIMIT 5
      `) as unknown as Promise<
        { name: string; count: number; total: number }[]
      >;

      const [currentPatientTypeStats, prevPatientTypeStats, topSymptomRows] =
        await Promise.all([
          getPatientTypeStats(currentStart, currentEnd),
          getPatientTypeStats(previousStart, previousEnd),
          topSymptomsQuery,
        ]);

      analytics = {
        // percent is the share of all symptom mentions in range, not only the top five.
        topSymptoms: topSymptomRows.map((r) => ({
          name: r.name,
          count: Number(r.count),
          percent:
            Number(r.total) > 0
              ? Math.round((Number(r.count) / Number(r.total)) * 100)
              : 0,
        })),
        patientTypes: {
          newPatients: {
            count: currentPatientTypeStats.newPatients,
            hikePercent: calculateHike(
              currentPatientTypeStats.newPatients,
              prevPatientTypeStats.newPatients
            ),
            previous: prevPatientTypeStats.newPatients,
          },
          returningPatients: {
            count: currentPatientTypeStats.returningPatients,
            hikePercent: calculateHike(
              currentPatientTypeStats.returningPatients,
              prevPatientTypeStats.returningPatients
            ),
            previous: prevPatientTypeStats.returningPatients,
          },
        },
      };

      // Longer TTL: peak-hour distribution and new-vs-returning classification
      // shift slowly — one new booking rarely changes either meaningfully — so
      // this tier trades a bit of staleness for a much higher cache-hit rate.
      await redisClient.setex(
        analyticsCacheKey,
        300,
        JSON.stringify(analytics)
      );
    }

    const { currentStats, prevStats, appointmentStats, pendingAppointments } =
      live;

    const result = {
      status: {
        totalEarning: {
          amount: currentStats.earning,
          hikePercent: calculateHike(currentStats.earning, prevStats.earning),
          previous: prevStats.earning,
        },
        totalAppointments: {
          count: currentStats.total,
          hikePercent: calculateHike(currentStats.total, prevStats.total),
          previous: prevStats.total,
        },
        confirmedAppointments: {
          count: currentStats.confirmed,
          hikePercent: calculateHike(
            currentStats.confirmed,
            prevStats.confirmed
          ),
          previous: prevStats.confirmed,
        },
        pendingAppointments: {
          count: currentStats.pending,
          hikePercent: calculateHike(currentStats.pending, prevStats.pending),
          previous: prevStats.pending,
        },
        noShowAppointments: {
          count: currentStats.noShow,
          hikePercent: calculateHike(currentStats.noShow, prevStats.noShow),
          previous: prevStats.noShow,
        },
        completedAppointments: {
          count: currentStats.completed,
          hikePercent: calculateHike(
            currentStats.completed,
            prevStats.completed
          ),
          previous: prevStats.completed,
        },
        cancelledAppointments: {
          count: currentStats.cancelled,
          hikePercent: calculateHike(
            currentStats.cancelled,
            prevStats.cancelled
          ),
          previous: prevStats.cancelled,
        },
        waitingPatients: {
          count: currentStats.waiting,
          hikePercent: calculateHike(currentStats.waiting, prevStats.waiting),
          previous: prevStats.waiting,
        },
        remainingAppointments: {
          count: currentStats.remaining,
          hikePercent: calculateHike(
            currentStats.remaining,
            prevStats.remaining
          ),
          previous: prevStats.remaining,
        },
        uniquePatients: {
          count: currentStats.uniquePatients,
          hikePercent: calculateHike(
            currentStats.uniquePatients,
            prevStats.uniquePatients
          ),
          previous: prevStats.uniquePatients,
        },
      },
      appointmentStats,
      pendingAppointments,
      // Entries cached before this field existed lack it; they expire within 5 minutes.
      topSymptoms: analytics.topSymptoms ?? [],
      patientTypes: analytics.patientTypes,
      trends: live.trends,
      // Entries cached before this field existed lack it; they expire within 45 seconds.
      todaySessions: live.todaySessions ?? [],
    };

    return result;
  }

  /**
   * Doctor Dashboard "profile" slice — doctorName + onboarding setupProgress.
   * Split out from getDoctorDashboardDataV2 because this data changes on the
   * order of "once per onboarding step" / "once per profile edit", not on
   * every appointment event, so it doesn't belong behind the same 45s TTL or
   * the same realtime-invalidation tag as the volatile stats. Cached for 1hr
   * and invalidated on write (see UserService.updateOnboardingProgress).
   */
  static async getDoctorDashboardProfile(clinicId: string, doctorId: string) {
    const cacheKey = `doctor_dashboard_profile:${clinicId}:${doctorId}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const [clinicRow, doctorRow] = await Promise.all([
      database
        .select({
          onboardingStatus: ClinicModel.onboardingStatus,
          currentStep: ClinicModel.currentStep,
        })
        .from(ClinicModel)
        .where(eq(ClinicModel.id, clinicId))
        .limit(1)
        .then((rows) => rows[0]),
      // Join through ClinicAssignModel so a doctorId from another clinic
      // can't be used to read this doctor's name (cross-tenant leak).
      database
        .select({ id: UserModel.id, name: UserModel.name })
        .from(UserModel)
        .innerJoin(
          ClinicAssignModel,
          and(
            eq(ClinicAssignModel.userId, UserModel.id),
            eq(ClinicAssignModel.clinicId, clinicId)
          )
        )
        .where(eq(UserModel.id, doctorId))
        .limit(1)
        .then((rows) => rows[0]),
    ]);

    const SETUP_STEPS = [
      { title: 'Clinic Profile', subtitle: 'Add your clinic details' },
      {
        title: 'Doctor Profile',
        subtitle: 'Complete your professional profile',
      },
      {
        title: 'Services & Availability',
        subtitle: 'Set up services and schedule',
      },
      { title: 'Submit for Approval', subtitle: 'Send your clinic for review' },
    ];
    const onboardingStatus = clinicRow?.onboardingStatus ?? 'NOT_STARTED';
    let setupProgress = null as null | {
      title: string;
      completed: number;
      total: number;
      ctaLabel: string;
      ctaPath: string;
      secondaryLabel: string;
      steps: Array<{
        title: string;
        subtitle: string;
        status: 'completed' | 'pending';
        stepNumber: number;
        path: string;
      }>;
    };
    if (onboardingStatus !== 'COMPLETED') {
      const completedCount = Math.min(
        Math.max(Number(clinicRow?.currentStep ?? 0), 0),
        SETUP_STEPS.length
      );
      setupProgress = {
        title: "Welcome! Let's set up a few things to get you started.",
        completed: completedCount,
        total: SETUP_STEPS.length,
        ctaLabel: 'Continue Setup',
        ctaPath: '/clinic-setup',
        secondaryLabel: 'Setup Center',
        steps: SETUP_STEPS.map((step, idx) => ({
          ...step,
          status: idx < completedCount ? 'completed' : 'pending',
          stepNumber: idx + 1,
          path: '/clinic-setup',
        })),
      };
    }

    const result = {
      doctorName: doctorRow?.name ?? null,
      setupProgress,
    };

    await redisClient.setex(cacheKey, 3600, JSON.stringify(result));
    return result;
  }

  /**
   * Invalidate the cached doctor-dashboard profile slice (doctorName/setupProgress)
   * for every doctor in a clinic. Called on onboarding-progress writes.
   */
  static async invalidateDoctorDashboardProfile(clinicId: string) {
    try {
      const keys = await redisClient.keys(
        `doctor_dashboard_profile:${clinicId}:*`
      );
      if (keys && keys.length > 0) {
        await redisClient.del(...keys);
      }
    } catch {
      // Fail-safe: cache will still expire via TTL
    }
  }

  static async getClinicDashboardData(
    clinicId: string,
    opts: {
      startDate?: string;
      endDate?: string;
    }
  ) {
    const version = await getDashboardCacheVersion(clinicId);
    return getOrSetCache(
      CacheKeys.clinicDashboard(
        clinicId,
        version,
        opts.startDate ?? 'default',
        opts.endDate ?? 'default'
      ),
      CLINIC_DASHBOARD_TTL_SECONDS,
      () => this.computeClinicDashboardData(clinicId, opts)
    );
  }

  private static async computeClinicDashboardData(
    clinicId: string,
    opts: {
      startDate?: string;
      endDate?: string;
    }
  ) {
    // Started first so its queries run alongside the ones below; the no-op
    // catch only stops an early rejection being reported as unhandled.
    const insightsPromise = ClinicInsightsService.getInsights(clinicId, opts);
    insightsPromise.catch(() => undefined);

    // 1. Determine Date Ranges
    const today = new Date();
    // Default to current month if not provided
    const currentStart = opts.startDate
      ? new Date(opts.startDate)
      : new Date(today.getFullYear(), today.getMonth(), 1);
    const currentEnd = opts.endDate
      ? new Date(opts.endDate)
      : new Date(today.getFullYear(), today.getMonth() + 1, 0);

    // Ensure 23:59:59 for end date
    currentEnd.setHours(23, 59, 59, 999);
    currentStart.setHours(0, 0, 0, 0);

    const durationMs = currentEnd.getTime() - currentStart.getTime();
    // Previous range: ending just before current start, same duration
    const previousEnd = new Date(currentStart.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - durationMs);

    // Helper to calculate percentage and format string
    const calculateHike = (current: number, previous: number) => {
      let percent = 0;
      if (previous === 0) {
        percent = current > 0 ? 100 : 0;
      } else {
        percent = ((current - previous) / previous) * 100;
      }
      const formattedPercent =
        percent > 0 ? `+${percent.toFixed(0)}` : percent.toFixed(0);
      return `${formattedPercent} (${previous})`;
    };

    // Helper to run count queries for a specific range.
    // The three aggregate queries are independent, so we run them in parallel
    // instead of sequentially to reduce total dashboard latency.
    const getStatsForRange = async (start: Date, end: Date) => {
      // Earnings: actual paid revenue minus refunds, filtered by appointment date
      // (consistent with revenue-overview API). Excludes Cancelled/NoShow appointments.
      const earningQuery = database
        .select({
          total: sql`COALESCE(SUM(${RECEIVED_AMOUNT}), 0)::int`,
        })
        .from(AppointmentModel)
        .innerJoin(
          AppointmentPaymentModel,
          eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
        )
        .where(
          and(
            eq(AppointmentModel.clinicId, clinicId),
            between(AppointmentModel.appointmentDate, start, end),
            sql`${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow')`
          )
        );

      // Appointment counts + unique patients in a single pass over the same
      // filtered rows (was previously two separate scans of the same table).
      const countsQuery = database
        .select({
          total: sql`COUNT(*)::int`,
          pending: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Pending' THEN 1 END)::int`,
          noShow: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'NoShow' THEN 1 END)::int`,
          uniquePatients: sql`COUNT(DISTINCT ${AppointmentModel.patientId})::int`,
        })
        .from(AppointmentModel)
        .where(
          and(
            eq(AppointmentModel.clinicId, clinicId),
            between(AppointmentModel.appointmentDate, start, end)
          )
        );

      // Unpaid money on appointments the patient didn't cancel or miss.
      const pendingPaymentQuery = database
        .select({
          amount: sql`COALESCE(SUM(${AppointmentPaymentModel.price}::numeric), 0)::int`,
        })
        .from(AppointmentModel)
        .innerJoin(
          AppointmentPaymentModel,
          eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
        )
        .where(
          and(
            eq(AppointmentModel.clinicId, clinicId),
            UNPAID_PAYMENT,
            sql`NOT ${NOT_ATTENDED}`,
            between(AppointmentModel.appointmentDate, start, end)
          )
        );

      const [[earningRes], [countsRes], [pendingPaymentRes]] =
        await Promise.all([earningQuery, countsQuery, pendingPaymentQuery]);

      return {
        earning: Number(earningRes?.total || 0),
        totalAppoiment: Number(countsRes?.total || 0),
        pendingAproval: Number(countsRes?.pending || 0),
        noShowCount: Number(countsRes?.noShow || 0),
        activePatent: Number(countsRes?.uniquePatients || 0),
        pendingPayment: Number(pendingPaymentRes?.amount || 0),
      };
    };

    // Current and previous ranges are independent — fetch them concurrently.
    const [currentStats, prevStats] = await Promise.all([
      getStatsForRange(currentStart, currentEnd),
      getStatsForRange(previousStart, previousEnd),
    ]);

    // appoimentStatus (Current Range)
    const statusCountsQuery = database
      .select({
        total: sql`COUNT(*)::int`,
        completed: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Completed' THEN 1 END)::int`,
        confirmed: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Confirmed' THEN 1 END)::int`,
        pending: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Pending' THEN 1 END)::int`,
        cancelled: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Cancelled' THEN 1 END)::int`,
        noShow: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'NoShow' THEN 1 END)::int`,
        // Without these the donut dropped arrivals, reschedules and misses, so its total fell short.
        patientArrived: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Patient Arrived' THEN 1 END)::int`,
        upcoming: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} IN ('Upcoming', 'Rescheduled') THEN 1 END)::int`,
        missed: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Missed' THEN 1 END)::int`,
      })
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.clinicId, clinicId),
          between(AppointmentModel.appointmentDate, currentStart, currentEnd)
        )
      );

    // revenueOverview (Daily) - Joining Earnings + Appointment Counts
    // We can fetch daily earnings and daily appointment counts separately and merge.

    // Daily Appointments (by appointment date)
    const dailyAppointmentsQuery = database
      .select({
        date: sql`DATE(${AppointmentModel.appointmentDate})`,
        count: sql`COUNT(*)::int`,
        noShowCount: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'NoShow' THEN 1 END)::int`,
        uniquePatients: sql`COUNT(DISTINCT ${AppointmentModel.patientId})::int`,
      })
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.clinicId, clinicId),
          between(AppointmentModel.appointmentDate, currentStart, currentEnd)
        )
      )
      .groupBy(sql`DATE(${AppointmentModel.appointmentDate})`);

    // Daily Earnings — use AppointmentPaymentModel (same source as revenue-overview)
    // for consistency. Filter by appointmentDate, exclude Cancelled/NoShow.
    const dailyEarningsQuery = database
      .select({
        date: sql`DATE(${AppointmentModel.appointmentDate})`,
        amount: sql`COALESCE(SUM(${RECEIVED_AMOUNT}), 0)::int`,
      })
      .from(AppointmentModel)
      .innerJoin(
        AppointmentPaymentModel,
        eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
      )
      .where(
        and(
          eq(AppointmentModel.clinicId, clinicId),
          between(AppointmentModel.appointmentDate, currentStart, currentEnd),
          sql`${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow')`
        )
      )
      .groupBy(sql`DATE(${AppointmentModel.appointmentDate})`);

    // These three aggregates are independent — run them concurrently.
    const [[statusCounts], dailyAppointments, dailyEarnings] =
      await Promise.all([
        statusCountsQuery,
        dailyAppointmentsQuery,
        dailyEarningsQuery,
      ]);

    // Merging for Revenue Overview and Patent Overview
    const dayMap = new Map<
      string,
      {
        earning: number;
        apptCount: number;
        noShowCount: number;
        patientCount: number;
      }
    >();

    // Initial fill with 0
    for (
      let d = new Date(currentStart);
      d <= currentEnd;
      d.setDate(d.getDate() + 1)
    ) {
      const dateStr = d.toISOString().split('T')[0];
      dayMap.set(dateStr, {
        earning: 0,
        apptCount: 0,
        noShowCount: 0,
        patientCount: 0,
      });
    }

    dailyAppointments.forEach((r) => {
      const d =
        r.date instanceof Date
          ? r.date.toISOString().split('T')[0]
          : String(r.date);
      const ref = dayMap.get(d) || {
        earning: 0,
        apptCount: 0,
        noShowCount: 0,
        patientCount: 0,
      };
      ref.apptCount = Number(r.count);
      ref.noShowCount = Number(r.noShowCount);
      ref.patientCount = Number(r.uniquePatients);
      dayMap.set(d, ref);
    });

    dailyEarnings.forEach((r) => {
      const d =
        r.date instanceof Date
          ? r.date.toISOString().split('T')[0]
          : String(r.date);
      const ref = dayMap.get(d) || {
        earning: 0,
        apptCount: 0,
        noShowCount: 0,
        patientCount: 0,
      };
      ref.earning = Number(r.amount);
      dayMap.set(d, ref);
    });

    const revenueOverview = [];
    const patentOverview = [];
    const noShowOverview = [];

    // Keys must be sorted naturally by loop order
    for (const [date, stats] of dayMap.entries()) {
      revenueOverview.push({
        date,
        amount: stats.earning, // Request says "amount", implies currency value
        appoitmentCount: stats.apptCount,
      });
      patentOverview.push({
        date,
        // Unique patients seen that day (was incorrectly reporting appointment count)
        count: stats.patientCount,
      });
      noShowOverview.push({
        date,
        count: stats.noShowCount,
      });
    }

    // 5. Symptom Statistics
    const symptomConditions = [eq(ClinicSymptomModel.clinicId, clinicId)];

    const normalizedStart = AppointmentService.normalizeToDateOnly(
      currentStart.toISOString()
    );
    const normalizedEnd = AppointmentService.normalizeToDateOnly(
      currentEnd.toISOString()
    );

    if (normalizedStart) {
      symptomConditions.push(
        gte(ClinicSymptomCountModel.date, normalizedStart)
      );
    }
    if (normalizedEnd) {
      symptomConditions.push(lte(ClinicSymptomCountModel.date, normalizedEnd));
    }

    const symptomStats = await database
      .select({
        symptomId: ClinicSymptomModel.id,
        symptomName: ClinicSymptomModel.name,
        count: sql`SUM(${ClinicSymptomCountModel.count})::int`,
      })
      .from(ClinicSymptomCountModel)
      .innerJoin(
        ClinicSymptomModel,
        eq(ClinicSymptomCountModel.symptomId, ClinicSymptomModel.id)
      )
      .where(and(...symptomConditions))
      .groupBy(ClinicSymptomModel.id, ClinicSymptomModel.name)
      .orderBy(desc(sql`SUM(${ClinicSymptomCountModel.count})`));

    return {
      status: {
        totalEarning: {
          amount: currentStats.earning,
          hikePersent: calculateHike(currentStats.earning, prevStats.earning),
        },
        totalAppoiment: {
          count: currentStats.totalAppoiment,
          hikePersent: calculateHike(
            currentStats.totalAppoiment,
            prevStats.totalAppoiment
          ),
        },
        pendingAproval: {
          count: currentStats.pendingAproval,
          hikePersent: calculateHike(
            currentStats.pendingAproval,
            prevStats.pendingAproval
          ),
        },
        noShowCount: {
          count: currentStats.noShowCount,
          hikePersent: calculateHike(
            currentStats.noShowCount,
            prevStats.noShowCount
          ),
        },
        activePatent: {
          count: currentStats.activePatent,
          hikePersent: calculateHike(
            currentStats.activePatent,
            prevStats.activePatent
          ),
        },
        pendingPayment: {
          amount: currentStats.pendingPayment,
          hikePersent: calculateHike(
            currentStats.pendingPayment,
            prevStats.pendingPayment
          ),
        },
      },
      appoimentStatus: {
        completed: Number(statusCounts?.completed || 0),
        confirmed: Number(statusCounts?.confirmed || 0),
        pending: Number(statusCounts?.pending || 0),
        cancelled: Number(statusCounts?.cancelled || 0),
        noShow: Number(statusCounts?.noShow || 0),
        patientArrived: Number(statusCounts?.patientArrived || 0),
        upcoming: Number(statusCounts?.upcoming || 0),
        missed: Number(statusCounts?.missed || 0),
        total: Number(statusCounts?.total || 0),
      },
      revenueOverview,
      patentOverview,
      noShowOverview,
      symptomStats,
      insights: await insightsPromise,
    };
  }

  /**
   * Get Super Admin Dashboard Data
   * Returns system-wide analytics and metrics for Super Admin view.
   * Cached in Redis for 1 hour. Returns lastUpdatedAt indicating when data was queried from DB.
   */
  static async getSuperAdminDashboardData(opts?: {
    startDate?: string;
    endDate?: string;
  }) {
    const today = new Date();
    const currentStart = opts?.startDate
      ? new Date(opts.startDate)
      : new Date(today.getFullYear(), today.getMonth(), 1);
    const currentEnd = opts?.endDate
      ? new Date(opts.endDate)
      : new Date(today.getFullYear(), today.getMonth() + 1, 0);

    currentEnd.setHours(23, 59, 59, 999);
    currentStart.setHours(0, 0, 0, 0);

    // Cache key based on date range
    const cacheKey = `super_admin_dashboard:${currentStart.toISOString().split('T')[0]}:${currentEnd.toISOString().split('T')[0]}`;

    // Check Redis cache (1 hour TTL)
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const durationMs = currentEnd.getTime() - currentStart.getTime();
    const previousEnd = new Date(currentStart.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - durationMs);

    // Helper to calculate percentage and format string
    const calculateHike = (current: number, previous: number): string => {
      let percent = 0;
      if (previous === 0) {
        percent = current > 0 ? 100 : 0;
      } else {
        percent = ((current - previous) / previous) * 100;
      }
      if (percent > 0) return `+${percent.toFixed(1)}%`;
      if (percent < 0) return `${percent.toFixed(1)}%`;
      return '0%';
    };

    // Determine granularity for series data
    // const daysDiff = Math.ceil(durationMs / (1000 * 60 * 60 * 24));
    // const granularity: 'day' | 'week' | 'month' =
    //   daysDiff <= 14 ? 'day' : daysDiff <= 90 ? 'day' : 'month';

    // Current week boundaries (Mon-Sun)
    const dayOfWeek = today.getUTCDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const thisWeekStart = new Date(today);
    thisWeekStart.setUTCDate(today.getUTCDate() - diffToMonday);
    thisWeekStart.setUTCHours(0, 0, 0, 0);
    const thisWeekEnd = new Date(thisWeekStart);
    thisWeekEnd.setUTCDate(thisWeekStart.getUTCDate() + 6);
    thisWeekEnd.setUTCHours(23, 59, 59, 999);

    // Current month boundaries
    // const thisMonthStart = new Date(
    //   Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
    // );
    const thisMonthEnd = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)
    );
    thisMonthEnd.setUTCHours(23, 59, 59, 999);

    // Last month boundaries
    // const lastMonthStart = new Date(
    //   Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)
    // );
    const lastMonthEnd = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)
    );
    lastMonthEnd.setUTCHours(23, 59, 59, 999);

    const result = await database.transaction(async (tx) => {
      // ─── 1. CLINICS ───────────────────────────────────────────────────────────
      // Cumulative "as of currentEnd" so these totals actually move with the
      // selected date range instead of always showing the current all-time count.
      const [totalClinicsRes] = await tx
        .select({ total: sql`COUNT(*)::int` })
        .from(ClinicModel)
        .where(lte(ClinicModel.createdAt, currentEnd));

      const [activeClinicsRes] = await tx
        .select({ count: sql`COUNT(*)::int` })
        .from(ClinicModel)
        .where(
          and(
            eq(ClinicModel.status, 'Active'),
            lte(ClinicModel.createdAt, currentEnd)
          )
        );

      const [inactiveClinicsRes] = await tx
        .select({ count: sql`COUNT(*)::int` })
        .from(ClinicModel)
        .where(
          and(
            // everything not live counts as inactive, so total = active + inactive
            or(
              eq(ClinicModel.status, 'Inactive'),
              eq(ClinicModel.status, 'Blocked'),
              eq(ClinicModel.status, 'Pending'),
              eq(ClinicModel.status, 'Rejected')
            ),
            lte(ClinicModel.createdAt, currentEnd)
          )
        );

      // Active clinics: Admin users with status Active registered in current period
      const [monthlyActiveClinicsRes] = await tx
        .select({
          count: sql`COUNT(*)::int`,
        })
        .from(UserModel)
        .where(
          and(
            eq(UserModel.userType, 'Admin'),
            eq(UserModel.userStatus, 'Active'),
            between(UserModel.createdAt, currentStart, currentEnd)
          )
        );

      // Clinics created in current vs previous period for hike
      const [currentPeriodClinics] = await tx
        .select({ count: sql`COUNT(*)::int` })
        .from(ClinicModel)
        .where(between(ClinicModel.createdAt, currentStart, currentEnd));

      const [previousPeriodClinics] = await tx
        .select({ count: sql`COUNT(*)::int` })
        .from(ClinicModel)
        .where(between(ClinicModel.createdAt, previousStart, previousEnd));

      // ─── 2. CONVERSION RATE ────────────────────────────────────────────────
      // Trial → Paid conversion: clinics that went from trial/free to a paid plan
      const [totalTrialEver] = await tx
        .select({
          count: sql`COUNT(DISTINCT ${ClinicSubscriptionModel.clinicId})::int`,
        })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            lte(ClinicSubscriptionModel.createdAt, currentEnd),
            or(
              eq(ClinicSubscriptionModel.paymentStatus, 'pending'),
              sql`${ClinicSubscriptionModel.price}::numeric = 0`
            )
          )
        );

      const [convertedToPaid] = await tx
        .select({
          count: sql`COUNT(DISTINCT ${ClinicSubscriptionModel.clinicId})::int`,
        })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.paymentStatus, 'success'),
            sql`${ClinicSubscriptionModel.price}::numeric > 0`,
            lte(ClinicSubscriptionModel.createdAt, currentEnd)
          )
        );

      const totalTrials = Number(totalTrialEver?.count || 0);
      const totalConverted = Number(convertedToPaid?.count || 0);
      const conversionRate =
        totalTrials > 0
          ? Number(((totalConverted / totalTrials) * 100).toFixed(1))
          : 0;

      // Previous period conversion rate for hike
      const [prevTrials] = await tx
        .select({
          count: sql`COUNT(DISTINCT ${ClinicSubscriptionModel.clinicId})::int`,
        })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            between(
              ClinicSubscriptionModel.createdAt,
              previousStart,
              previousEnd
            ),
            or(
              eq(ClinicSubscriptionModel.paymentStatus, 'pending'),
              sql`${ClinicSubscriptionModel.price}::numeric = 0`
            )
          )
        );

      const [prevConverted] = await tx
        .select({
          count: sql`COUNT(DISTINCT ${ClinicSubscriptionModel.clinicId})::int`,
        })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            between(
              ClinicSubscriptionModel.createdAt,
              previousStart,
              previousEnd
            ),
            eq(ClinicSubscriptionModel.paymentStatus, 'success'),
            sql`${ClinicSubscriptionModel.price}::numeric > 0`
          )
        );

      const prevConversionRate =
        Number(prevTrials?.count || 0) > 0
          ? (Number(prevConverted?.count || 0) /
              Number(prevTrials?.count || 0)) *
            100
          : 0;

      // ─── 3. USERS ─────────────────────────────────────────────────────────────
      const [totalUsersRes] = await tx
        .select({ count: sql`COUNT(*)::int` })
        .from(UserModel)
        .where(lte(UserModel.createdAt, currentEnd));

      // Active users: non-Admin users with status Active registered in current period
      const [monthlyActiveUsersRes] = await tx
        .select({
          count: sql`COUNT(*)::int`,
        })
        .from(UserModel)
        .where(
          and(
            ne(UserModel.userType, 'Admin'),
            ne(UserModel.userType, 'Super_Admin'),
            eq(UserModel.userStatus, 'Active'),
            between(UserModel.createdAt, currentStart, currentEnd)
          )
        );

      // Users by role
      const usersByRole = await tx
        .select({
          userType: UserModel.userType,
          count: sql`COUNT(*)::int`,
        })
        .from(UserModel)
        .where(
          inArray(UserModel.userType, [
            'Super_Admin',
            'Admin',
            'Doctor',
            'Patient',
            'Receptionist',
          ])
        )
        .groupBy(UserModel.userType);

      const byRole: Record<string, number> = {};
      usersByRole.forEach((row) => {
        byRole[row.userType] = Number(row.count);
      });

      // Users created in current vs previous period for hike
      const [currentPeriodUsers] = await tx
        .select({ count: sql`COUNT(*)::int` })
        .from(UserModel)
        .where(between(UserModel.createdAt, currentStart, currentEnd));

      const [previousPeriodUsers] = await tx
        .select({ count: sql`COUNT(*)::int` })
        .from(UserModel)
        .where(between(UserModel.createdAt, previousStart, previousEnd));

      // ─── 4. SUBSCRIPTIONS ────────────────────────────────────────────────────
      // Active subscriptions with plan info
      const activeSubscriptions = await tx
        .select({
          clinicId: ClinicSubscriptionModel.clinicId,
          planId: ClinicSubscriptionModel.planId,
          planName: SubscriptionPlanModel.name,
          planPrice: SubscriptionPlanModel.price,
          providerSubscriptionId:
            ClinicSubscriptionModel.providerSubscriptionId,
          expiresAt: ClinicSubscriptionModel.expiresAt,
          active: ClinicSubscriptionModel.active,
        })
        .from(ClinicSubscriptionModel)
        .innerJoin(
          SubscriptionPlanModel,
          eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
        )
        .where(
          and(
            eq(ClinicSubscriptionModel.active, true),
            lte(ClinicSubscriptionModel.createdAt, currentEnd),
            or(
              isNull(ClinicSubscriptionModel.expiresAt),
              gt(ClinicSubscriptionModel.expiresAt, currentEnd)
            )
          )
        );

      const [totalSubsRes] = await tx
        .select({ count: sql`COUNT(*)::int` })
        .from(ClinicSubscriptionModel)
        .where(lte(ClinicSubscriptionModel.createdAt, currentEnd));

      const [expiredSubsRes] = await tx
        .select({ count: sql`COUNT(*)::int` })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.active, true),
            lte(ClinicSubscriptionModel.createdAt, currentEnd),
            lte(ClinicSubscriptionModel.expiresAt, currentEnd)
          )
        );

      const [cancelledSubsRes] = await tx
        .select({ count: sql`COUNT(*)::int` })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.active, false),
            lte(ClinicSubscriptionModel.createdAt, currentEnd)
          )
        );

      let yearlyCount = 0;
      let trialCount = 0;
      const planCounts: Record<string, number> = {};

      activeSubscriptions.forEach((sub) => {
        // Count by plan
        const pName = sub.planName || 'Unknown';
        planCounts[pName] = (planCounts[pName] || 0) + 1;

        // Yearly check
        if (sub.providerSubscriptionId === 'pro-yearly') {
          yearlyCount++;
        }

        // Trial: free plan with expiry
        if ((!sub.planPrice || Number(sub.planPrice) === 0) && sub.expiresAt) {
          trialCount++;
        }
      });

      const byPlan = Object.entries(planCounts).map(([planName, count]) => ({
        planName,
        count,
      }));

      // Subscriptions hike: active subs in current vs previous period
      const [currentPeriodSubs] = await tx
        .select({ count: sql`COUNT(*)::int` })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.active, true),
            between(ClinicSubscriptionModel.createdAt, currentStart, currentEnd)
          )
        );

      const [previousPeriodSubs] = await tx
        .select({ count: sql`COUNT(*)::int` })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.active, true),
            between(
              ClinicSubscriptionModel.createdAt,
              previousStart,
              previousEnd
            )
          )
        );

      // ─── 5. REVENUE (Subscriptions + Add-ons) ───────────────────────────────
      const [subRevenueAllTime] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicSubscriptionModel.price}::numeric), 0)::int`,
        })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.paymentStatus, 'success'),
            lte(ClinicSubscriptionModel.createdAt, currentEnd)
          )
        );

      const [addOnRevenueAllTime] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicAddOnModel.price}::numeric), 0)::int`,
        })
        .from(ClinicAddOnModel)
        .where(
          and(
            eq(ClinicAddOnModel.paymentStatus, 'success'),
            lte(ClinicAddOnModel.createdAt, currentEnd)
          )
        );

      const [subYearlyRevenueRes] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicSubscriptionModel.price}::numeric), 0)::int`,
        })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.paymentStatus, 'success'),
            eq(ClinicSubscriptionModel.providerSubscriptionId, 'pro-yearly'),
            lte(ClinicSubscriptionModel.createdAt, currentEnd)
          )
        );

      const [addOnYearlyRevenueRes] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicAddOnModel.price}::numeric), 0)::int`,
        })
        .from(ClinicAddOnModel)
        .where(
          and(
            eq(ClinicAddOnModel.paymentStatus, 'success'),
            eq(ClinicAddOnModel.billingCycle, 'yearly'),
            lte(ClinicAddOnModel.createdAt, currentEnd)
          )
        );

      const [subCurrentPeriodRevenue] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicSubscriptionModel.price}::numeric), 0)::int`,
        })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.paymentStatus, 'success'),
            between(ClinicSubscriptionModel.createdAt, currentStart, currentEnd)
          )
        );

      const [addOnCurrentPeriodRevenue] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicAddOnModel.price}::numeric), 0)::int`,
        })
        .from(ClinicAddOnModel)
        .where(
          and(
            eq(ClinicAddOnModel.paymentStatus, 'success'),
            between(ClinicAddOnModel.createdAt, currentStart, currentEnd)
          )
        );

      const [subPreviousPeriodRevenue] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicSubscriptionModel.price}::numeric), 0)::int`,
        })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.paymentStatus, 'success'),
            between(
              ClinicSubscriptionModel.createdAt,
              previousStart,
              previousEnd
            )
          )
        );

      const [addOnPreviousPeriodRevenue] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicAddOnModel.price}::numeric), 0)::int`,
        })
        .from(ClinicAddOnModel)
        .where(
          and(
            eq(ClinicAddOnModel.paymentStatus, 'success'),
            between(ClinicAddOnModel.createdAt, previousStart, previousEnd)
          )
        );

      const totalRevenueAllTimeVal =
        Number(subRevenueAllTime?.total || 0) +
        Number(addOnRevenueAllTime?.total || 0);
      const yearlyRevenueResVal =
        Number(subYearlyRevenueRes?.total || 0) +
        Number(addOnYearlyRevenueRes?.total || 0);
      const currentPeriodRevenueVal =
        Number(subCurrentPeriodRevenue?.total || 0) +
        Number(addOnCurrentPeriodRevenue?.total || 0);
      const previousPeriodRevenueVal =
        Number(subPreviousPeriodRevenue?.total || 0) +
        Number(addOnPreviousPeriodRevenue?.total || 0);

      // ─── 8. RECENT ACTIVITIES ───────────────────────────────────────────────
      // Fetch recent activities from the last 30 days, limited to 10
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Clinic registrations (last 10)
      const recentClinicRegistrations = await tx
        .select({
          id: ClinicModel.id,
          clinicName: ClinicModel.clinicName,
          createdAt: ClinicModel.createdAt,
        })
        .from(ClinicModel)
        .where(gte(ClinicModel.createdAt, thirtyDaysAgo))
        .orderBy(desc(ClinicModel.createdAt))
        .limit(10);

      // Payment successes (subscription payments, last 10)
      const recentPayments = await tx
        .select({
          id: ClinicSubscriptionModel.id,
          clinicId: ClinicSubscriptionModel.clinicId,
          clinicName: ClinicModel.clinicName,
          amount: ClinicSubscriptionModel.price,
          paymentStatus: ClinicSubscriptionModel.paymentStatus,
          createdAt: ClinicSubscriptionModel.createdAt,
        })
        .from(ClinicSubscriptionModel)
        .innerJoin(
          ClinicModel,
          eq(ClinicSubscriptionModel.clinicId, ClinicModel.id)
        )
        .where(
          and(
            eq(ClinicSubscriptionModel.paymentStatus, 'success'),
            gte(ClinicSubscriptionModel.createdAt, thirtyDaysAgo)
          )
        )
        .orderBy(desc(ClinicSubscriptionModel.createdAt))
        .limit(10);

      // New subscriptions (last 10)
      const recentSubscriptions = await tx
        .select({
          id: ClinicSubscriptionModel.id,
          clinicId: ClinicSubscriptionModel.clinicId,
          clinicName: ClinicModel.clinicName,
          planName: SubscriptionPlanModel.name,
          createdAt: ClinicSubscriptionModel.createdAt,
        })
        .from(ClinicSubscriptionModel)
        .innerJoin(
          ClinicModel,
          eq(ClinicSubscriptionModel.clinicId, ClinicModel.id)
        )
        .innerJoin(
          SubscriptionPlanModel,
          eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
        )
        .where(
          and(
            eq(ClinicSubscriptionModel.active, true),
            gte(ClinicSubscriptionModel.createdAt, thirtyDaysAgo)
          )
        )
        .orderBy(desc(ClinicSubscriptionModel.createdAt))
        .limit(10);

      // Pending verifications (users awaiting email verification, last 10)
      const pendingVerifications = await tx
        .select({
          id: UserModel.id,
          userName: UserModel.name,
          userEmail: UserModel.email,
          createdAt: UserModel.createdAt,
        })
        .from(UserModel)
        .where(
          and(
            isNull(UserModel.emailVerifiedAt),
            gte(UserModel.createdAt, thirtyDaysAgo)
          )
        )
        .orderBy(desc(UserModel.createdAt))
        .limit(10);

      // Combine all activities and sort by timestamp (newest first)
      // GUARANTEED: Always returns an array ([] if no activities, never null/undefined)
      const activities = [
        ...recentClinicRegistrations.map((clinic) => ({
          id: clinic.id,
          type: 'clinic_registered' as const,
          title: 'New Clinic Registered',
          description: `${clinic.clinicName} has registered`,
          timestamp:
            clinic.createdAt?.toISOString() || new Date().toISOString(),
          relatedId: clinic.id,
        })),
        ...recentPayments.map((payment) => ({
          id: payment.id,
          type: 'payment_received' as const,
          title: 'Payment Received',
          description: `Payment of ₹${Number(payment.amount || 0).toFixed(2)} from ${payment.clinicName}`,
          timestamp:
            payment.createdAt?.toISOString() || new Date().toISOString(),
          relatedId: payment.clinicId,
        })),
        ...recentSubscriptions.map((sub) => ({
          id: sub.id,
          type: 'subscription_created' as const,
          title: 'New Subscription',
          description: `${sub.clinicName} subscribed to ${sub.planName}`,
          timestamp: sub.createdAt?.toISOString() || new Date().toISOString(),
          relatedId: sub.clinicId,
        })),
        ...pendingVerifications.map((user) => ({
          id: user.id,
          type: 'verification_pending' as const,
          title: 'Verification Pending',
          description: `${user.userName} awaiting email verification`,
          timestamp: user.createdAt?.toISOString() || new Date().toISOString(),
          relatedId: user.id,
        })),
      ]
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )
        .slice(0, 4);

      //   return { labels, data: values };
      // };

      const calcGrowthPercent = (current: number, previous: number): number => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return Number((((current - previous) / previous) * 100).toFixed(1));
      };

      // Calculate performance summary metrics
      const overallGrowth = calcGrowthPercent(
        Number(currentPeriodUsers?.count || 0) +
          Number(currentPeriodClinics?.count || 0) +
          currentPeriodRevenueVal,
        Number(previousPeriodUsers?.count || 0) +
          Number(previousPeriodClinics?.count || 0) +
          previousPeriodRevenueVal
      );

      const revenueGrowth = calcGrowthPercent(
        currentPeriodRevenueVal,
        previousPeriodRevenueVal
      );

      const clinicGrowth = calcGrowthPercent(
        Number(currentPeriodClinics?.count || 0),
        Number(previousPeriodClinics?.count || 0)
      );

      const subscriptionGrowth = calcGrowthPercent(
        Number(currentPeriodSubs?.count || 0),
        Number(previousPeriodSubs?.count || 0)
      );

      const userGrowth = calcGrowthPercent(
        Number(currentPeriodUsers?.count || 0),
        Number(previousPeriodUsers?.count || 0)
      );

      // Determine status labels based on growth metrics
      const getGrowthStatus = (growth: number): string => {
        if (growth > 20) return 'Excellent Growth';
        if (growth > 10) return 'Good Growth';
        if (growth > 0) return 'Moderate Growth';
        if (growth === 0) return 'Stable';
        return 'Needs Improvement';
      };

      // ─── BUILD RESPONSE ───────────────────────────────────────────────────────
      return {
        clinics: {
          total: Number(totalClinicsRes?.total || 0),
          active: Number(activeClinicsRes?.count || 0),
          inactive: Number(inactiveClinicsRes?.count || 0),
          monthlyActive: Number(monthlyActiveClinicsRes?.count || 0),
          registered: Number(currentPeriodClinics?.count || 0),
          hikePersent: calculateHike(
            Number(currentPeriodClinics?.count || 0),
            Number(previousPeriodClinics?.count || 0)
          ),
        },
        conversionRate: {
          rate: conversionRate,
          hikePersent: calculateHike(conversionRate, prevConversionRate),
        },
        users: {
          total: Number(totalUsersRes?.count || 0),
          monthlyActive: Number(monthlyActiveUsersRes?.count || 0),
          byRole,
          registered: Number(currentPeriodUsers?.count || 0),
          hikePersent: calculateHike(
            Number(currentPeriodUsers?.count || 0),
            Number(previousPeriodUsers?.count || 0)
          ),
        },
        subscriptions: {
          active: activeSubscriptions.length,
          total: Number(totalSubsRes?.count || 0),
          yearly: yearlyCount,
          trial: trialCount,
          expired: Number(expiredSubsRes?.count || 0),
          cancelled: Number(cancelledSubsRes?.count || 0),
          byPlan,
          hikePersent: calculateHike(
            Number(currentPeriodSubs?.count || 0),
            Number(previousPeriodSubs?.count || 0)
          ),
        },
        revenue: {
          total: totalRevenueAllTimeVal,
          yearly: yearlyRevenueResVal,
          currentPeriod: currentPeriodRevenueVal,
          hikePersent: calculateHike(
            currentPeriodRevenueVal,
            previousPeriodRevenueVal
          ),
        },
        performanceSummary: {
          overallGrowth,
          overallStatus: getGrowthStatus(overallGrowth),
          revenueGrowth,
          revenueStatus: getGrowthStatus(revenueGrowth),
          clinicGrowth,
          clinicStatus: getGrowthStatus(clinicGrowth),
          subscriptionGrowth,
          subscriptionStatus: getGrowthStatus(subscriptionGrowth),
          userGrowth,
          userStatus: getGrowthStatus(userGrowth),
        },
        activities,
      };
    });

    // Cache result in Redis for 1 hour with lastUpdatedAt timestamp
    const responseWithTimestamp = {
      ...result,
      lastUpdatedAt: new Date().toISOString(),
    };
    await redisClient.setex(
      cacheKey,
      3600,
      JSON.stringify(responseWithTimestamp)
    );

    return responseWithTimestamp;
  }

  /**
   * Revenue Overview API
   * - Admin: returns clinic-wide revenue (or specific doctor if doctorId passed)
   * - Doctor: returns only their own revenue
   * - period: 'week' (default, full 7 days Mon-Sun) or 'month' (full current month)
   * - Revenue is calculated based on PAYMENT STATUS (Paid/Refunded), not appointment status.
   *   This ensures consistency: pre-paid appointments show revenue immediately,
   *   not only after the appointment is marked Completed.
   * - Cached in Redis for 2 minutes, invalidated on appointment update
   */
  static async getRevenueOverview(
    clinicId: string,
    user: AuthUser,
    opts?: { doctorId?: string; startDate?: string; endDate?: string }
  ) {
    const isAdmin =
      user.userType === 'Admin' || user.userType === 'Super_Admin';

    // Determine target doctor
    let targetDoctorId: string | null = null;
    if (isAdmin && opts?.doctorId) {
      targetDoctorId = opts.doctorId;
    } else if (!isAdmin && user.userType === 'Doctor') {
      targetDoctorId = user.id;
    }

    // Date ranges
    const now = new Date();
    let rangeStart: Date;
    let rangeEnd: Date;

    if (opts?.startDate && opts?.endDate) {
      rangeStart = new Date(opts.startDate);
      rangeStart.setUTCHours(0, 0, 0, 0);
      rangeEnd = new Date(opts.endDate);
      rangeEnd.setUTCHours(23, 59, 59, 999);
    } else {
      // Fallback: Full 7 days Mon-Sun of current week
      const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon...
      const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      rangeStart = new Date(now);
      rangeStart.setUTCDate(now.getUTCDate() - diffToMonday);
      rangeStart.setUTCHours(0, 0, 0, 0);
      rangeEnd = new Date(rangeStart);
      rangeEnd.setUTCDate(rangeStart.getUTCDate() + 6);
      rangeEnd.setUTCHours(23, 59, 59, 999);
    }

    const startStr = rangeStart.toISOString().split('T')[0];
    const endStr = rangeEnd.toISOString().split('T')[0];

    const cacheKey = CacheKeys.revenueOverview(
      clinicId,
      await getDashboardCacheVersion(clinicId),
      targetDoctorId,
      startStr,
      endStr
    );

    // Check cache
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Build where conditions — revenue recognized by payment status, not
    // appointment status: a payment or refund is real money that moved
    // regardless of what later happened to the appointment, and this must
    // match /appointments/payment-transactions (Payments History), which
    // has no appointmentStatus filter at all. An appointmentStatus exclusion
    // used to sit here (`NOT IN ('Cancelled', 'NoShow')`) despite the intent
    // stated in this very comment — it silently zeroed out revenue for any
    // appointment that was later cancelled or marked no-show even if it had
    // been paid (and possibly partly refunded), which disagreed with
    // Payments History for the same date range.
    // Amounts follow `RECEIVED_AMOUNT`, the Payments History rule, so the two agree.
    const conditions: any[] = [
      eq(AppointmentModel.clinicId, clinicId),
      gte(AppointmentModel.appointmentDate, rangeStart),
      lte(AppointmentModel.appointmentDate, rangeEnd),
      HAS_RECEIVED_MONEY,
    ];
    if (targetDoctorId) {
      conditions.push(eq(AppointmentModel.doctorId, targetDoctorId));
    }

    const rows = await database
      .select({
        date: sql<string>`DATE(${AppointmentModel.appointmentDate})`,
        amount: sql<string>`COALESCE(SUM(${RECEIVED_AMOUNT}), 0)`,
        refundedAmount: sql<string>`COALESCE(SUM(
          CASE 
            WHEN ${AppointmentPaymentModel.paymentStatus} = 'Refunded' THEN COALESCE(${AppointmentPaymentModel.refundedAmount}::numeric, 0)
            ELSE 0
          END
        ), 0)`,
      })
      .from(AppointmentModel)
      .innerJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .where(and(...conditions))
      .groupBy(sql`DATE(${AppointmentModel.appointmentDate})`)
      .orderBy(sql`DATE(${AppointmentModel.appointmentDate}) ASC`);

    // Query payment mode breakdown per day
    const modeRows = await database
      .select({
        date: sql<string>`DATE(${AppointmentModel.appointmentDate})`,
        paymentMode: AppointmentPaymentModel.paymentMode,
        modeAmount: sql<string>`COALESCE(SUM(${RECEIVED_AMOUNT}), 0)`,
      })
      .from(AppointmentModel)
      .innerJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .where(and(...conditions))
      .groupBy(
        sql`DATE(${AppointmentModel.appointmentDate})`,
        AppointmentPaymentModel.paymentMode
      )
      .orderBy(sql`DATE(${AppointmentModel.appointmentDate}) ASC`);

    // Build a map of date -> data
    const dataMap = new Map<
      string,
      {
        amount: number;
        refundedAmount: number;
        paymentModes: Record<string, number>;
      }
    >();
    for (const r of rows) {
      dataMap.set(String(r.date), {
        amount: parseFloat(r.amount || '0'),
        refundedAmount: parseFloat(r.refundedAmount || '0'),
        paymentModes: {},
      });
    }

    // Fill payment mode breakdown
    for (const r of modeRows) {
      const dateKey = String(r.date);
      const entry = dataMap.get(dateKey);
      if (entry && r.paymentMode) {
        entry.paymentModes[r.paymentMode] = parseFloat(r.modeAmount || '0');
      }
    }

    // Fill all dates in range
    const revenueOverview: Array<{
      date: string;
      amount: number;
      refundedAmount: number;
      paymentModes: Record<string, number>;
    }> = [];

    let totalRevenue = 0;
    let totalRefunded = 0;

    for (
      let cur = new Date(rangeStart);
      cur <= rangeEnd;
      cur.setUTCDate(cur.getUTCDate() + 1)
    ) {
      const key = cur.toISOString().split('T')[0];
      const entry = dataMap.get(key);
      const amount = entry?.amount || 0;
      const refundedAmount = entry?.refundedAmount || 0;
      const paymentModes = entry?.paymentModes || {};

      totalRevenue += amount;
      totalRefunded += refundedAmount;

      revenueOverview.push({
        date: key,
        amount,
        refundedAmount,
        paymentModes,
      });
    }

    // Same unpaid rule as /dashboard and the Outstanding Dues card.
    const pendingConditions: any[] = [
      eq(AppointmentModel.clinicId, clinicId),
      gte(AppointmentModel.appointmentDate, rangeStart),
      lte(AppointmentModel.appointmentDate, rangeEnd),
      UNPAID_PAYMENT,
      sql`NOT ${NOT_ATTENDED}`,
    ];
    if (targetDoctorId) {
      pendingConditions.push(eq(AppointmentModel.doctorId, targetDoctorId));
    }

    const [pendingResult] = await database
      .select({
        pendingAmount: sql<string>`COALESCE(SUM(${AppointmentPaymentModel.price}::numeric), 0)`,
        pendingCount: sql<string>`COUNT(*)`,
      })
      .from(AppointmentModel)
      .innerJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .where(and(...pendingConditions));

    const pendingPayments = parseFloat(pendingResult?.pendingAmount || '0');
    const pendingPaymentCount = parseInt(
      pendingResult?.pendingCount || '0',
      10
    );

    // Today's revenue (subset of totalRevenue for today specifically)
    const todayKey = now.toISOString().split('T')[0];
    const todayEntry = dataMap.get(todayKey);
    const todayRevenue = todayEntry?.amount || 0;

    // Previous period revenue for comparison (same logic: payment-based)
    const periodDurationMs = rangeEnd.getTime() - rangeStart.getTime();
    const prevRangeEnd = new Date(rangeStart.getTime() - 1);
    prevRangeEnd.setUTCHours(23, 59, 59, 999);
    const prevRangeStart = new Date(prevRangeEnd.getTime() - periodDurationMs);
    prevRangeStart.setUTCHours(0, 0, 0, 0);

    const prevConditions: any[] = [
      eq(AppointmentModel.clinicId, clinicId),
      gte(AppointmentModel.appointmentDate, prevRangeStart),
      lte(AppointmentModel.appointmentDate, prevRangeEnd),
      HAS_RECEIVED_MONEY,
    ];
    if (targetDoctorId) {
      prevConditions.push(eq(AppointmentModel.doctorId, targetDoctorId));
    }

    const [prevResult] = await database
      .select({
        prevRevenue: sql<string>`COALESCE(SUM(${RECEIVED_AMOUNT}), 0)`,
      })
      .from(AppointmentModel)
      .innerJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .where(and(...prevConditions));

    const previousRevenue = parseFloat(prevResult?.prevRevenue || '0');

    // Calculate trend
    let trendPercent = 0;
    if (previousRevenue === 0) {
      trendPercent = totalRevenue > 0 ? 100 : 0;
    } else {
      trendPercent = ((totalRevenue - previousRevenue) / previousRevenue) * 100;
    }
    const trendDirection = trendPercent > 0 ? '↑' : trendPercent < 0 ? '↓' : '';
    const trend =
      trendPercent === 0
        ? '0%'
        : `${trendDirection} ${Math.abs(trendPercent).toFixed(1)}%`;

    const diffTime = Math.abs(rangeEnd.getTime() - rangeStart.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const period = diffDays <= 7 ? 'week' : 'month';

    let comparisonLabel = 'vs previous period';
    if (diffDays <= 7) {
      comparisonLabel = 'vs last 7 days';
    } else if (diffDays <= 31) {
      comparisonLabel = 'vs last month';
    }

    const result = {
      period,
      totalRevenue,
      totalRefunded,
      // `totalRevenue` is already net: the per-day SUM above counts a Refunded
      // row as `price - refundedAmount`, so subtracting `totalRefunded` again
      // here deducted every refund twice (a fully refunded ₹2,000 appointment
      // reported −₹2,000 instead of ₹0). `totalRefunded` stays as an
      // informational figure only.
      netRevenue: totalRevenue,
      todayRevenue,
      pendingPayments,
      pendingPaymentCount,
      trend,
      previousRevenue,
      comparisonLabel,
      revenueOverview,
      meta: {
        clinicId,
        doctorId: targetDoctorId,
        rangeStart: rangeStart.toISOString().split('T')[0],
        rangeEnd: rangeEnd.toISOString().split('T')[0],
        generatedAt: now.toISOString(),
      },
    };

    // Cache for 2 minutes (120 seconds)
    await redisClient.setex(cacheKey, 120, JSON.stringify(result));

    return result;
  }

  /**
   * Today's Overview API
   * Returns today's revenue + appointment stats (total, remaining, completed, pending)
   * + upcoming appointment details (id, date, time, patient name)
   * - Doctor: sees only their own data
   * - Admin with doctor permission (isAdminDoctorAccess): can pass doctorId
   * - Cached in Redis for 1 hour, invalidated on today's appointment status change
   */
  static async getTodayOverview(
    clinicId: string,
    user: AuthUser,
    opts?: { doctorId?: string; scope?: 'clinic' }
  ) {
    // The documented default stays the caller's own id (other clients rely on it);
    // an admin passes scope=clinic for the whole clinic. Doctors are always self-scoped.
    const isAdmin =
      user.userType === 'Admin' || user.userType === 'Super_Admin';
    const targetDoctorId = isAdmin
      ? opts?.doctorId || (opts?.scope === 'clinic' ? undefined : user.id)
      : user.id;
    const doctorCondition = targetDoctorId
      ? eq(AppointmentModel.doctorId, targetDoctorId)
      : undefined;

    const cacheKey = CacheKeys.todayOverview(
      clinicId,
      await getDashboardCacheVersion(clinicId),
      targetDoctorId
    );

    // Check cache
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed.todaysAppointments)) {
        parsed.todaysAppointments = filterTodaysAppointments(
          parsed.todaysAppointments
        );
      }
      return parsed;
    }

    // Today's date range
    const now = new Date();
    // The IST day, not the UTC one — see istDayBoundsUtc.
    const { start: todayStart, end: todayEnd } = istDayBoundsUtc();

    const todayConditions = and(
      eq(AppointmentModel.clinicId, clinicId),
      doctorCondition,
      gte(AppointmentModel.appointmentDate, todayStart),
      lte(AppointmentModel.appointmentDate, todayEnd)
    );

    // Appointment stats for today
    const appointmentStats = await database
      .select({
        status: AppointmentModel.appointmentStatus,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(AppointmentModel)
      .where(todayConditions)
      .groupBy(AppointmentModel.appointmentStatus);

    let totalAppointments = 0;
    let completed = 0;
    let pending = 0;
    let cancelled = 0;
    let noShow = 0;
    let confirmed = 0;

    for (const row of appointmentStats) {
      const cnt = Number(row.count);
      totalAppointments += cnt;
      if (row.status === 'Completed') completed = cnt;
      else if (row.status === 'Pending') pending = cnt;
      else if (row.status === 'Cancelled') cancelled = cnt;
      else if (row.status === 'NoShow') noShow = cnt;
      else if (row.status === 'Confirmed') confirmed = cnt;
    }

    // Remaining = total - completed - cancelled - noShow
    const remaining = totalAppointments - completed - cancelled - noShow;

    // Today's revenue (appointments with Paid payment status today, excluding Cancelled/NoShow)
    const todayRevenueConditions = and(
      eq(AppointmentModel.clinicId, clinicId),
      doctorCondition,
      gte(AppointmentModel.appointmentDate, todayStart),
      lte(AppointmentModel.appointmentDate, todayEnd),
      eq(AppointmentPaymentModel.paymentStatus, 'Paid'),
      sql`${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow')`
    );

    const [todayRevenueResult] = await database
      .select({
        revenue: sql<string>`COALESCE(SUM(${AppointmentPaymentModel.price}::numeric), 0)`,
        paidCount: sql<string>`COUNT(*)`,
      })
      .from(AppointmentModel)
      .innerJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .where(todayRevenueConditions);

    const todayRevenue = parseFloat(todayRevenueResult?.revenue || '0');
    const todayPaidAppointments = parseInt(
      todayRevenueResult?.paidCount || '0',
      10
    );

    // Today's pending payments
    const [todayPendingResult] = await database
      .select({
        pendingAmount: sql<string>`COALESCE(SUM(${AppointmentPaymentModel.price}::numeric), 0)`,
        pendingCount: sql<string>`COUNT(*)`,
      })
      .from(AppointmentModel)
      .innerJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .where(
        and(
          eq(AppointmentModel.clinicId, clinicId),
          doctorCondition,
          gte(AppointmentModel.appointmentDate, todayStart),
          lte(AppointmentModel.appointmentDate, todayEnd),
          eq(AppointmentPaymentModel.paymentStatus, 'Pending'),
          sql`${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow')`
        )
      );

    const todayPendingPayments = parseFloat(
      todayPendingResult?.pendingAmount || '0'
    );
    const todayPendingCount = parseInt(
      todayPendingResult?.pendingCount || '0',
      10
    );

    // Today's appointments: all appointments for today with full details
    const todaysAppointments = await database
      .select({
        id: AppointmentModel.id,
        appointmentDate: AppointmentModel.appointmentDate,
        appointmentTime: AppointmentModel.appointmentTime,
        appointmentType: AppointmentModel.appointmentType,
        appointmentStatus: AppointmentModel.appointmentStatus,
        tokenNo: AppointmentModel.tokenNo,
        patientId: AppointmentModel.patientId,
        patientName: UserModel.name,
        patientMobile: UserModel.mobile,
        patientGender: UserProfileModel.gender,
        patientAge: UserProfileModel.age,
        patientProfileImage: UserProfileModel.profileImage,
        paymentStatus: AppointmentPaymentModel.paymentStatus,
        commonSymptoms: AppointmentClinicalModel.commonSymptoms,
      })
      .from(AppointmentModel)
      .innerJoin(UserModel, eq(UserModel.id, AppointmentModel.patientId))
      .leftJoin(
        UserProfileModel,
        eq(UserProfileModel.userId, AppointmentModel.patientId)
      )
      .leftJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .leftJoin(
        AppointmentClinicalModel,
        eq(AppointmentClinicalModel.appointmentId, AppointmentModel.id)
      )
      .where(
        and(
          eq(AppointmentModel.clinicId, clinicId),
          doctorCondition,
          gte(AppointmentModel.appointmentDate, todayStart),
          lte(AppointmentModel.appointmentDate, todayEnd)
        )
      )
      .orderBy(sql`${AppointmentModel.appointmentTime} ASC`);

    // Symptom counts for current week (Mon-Sun), cached separately for 1 week
    const symptomCacheKey = `symptom_counts_week:${clinicId}`;
    let symptomCounts: Record<string, number> = {};

    const cachedSymptoms = await redisClient.get(symptomCacheKey);
    if (cachedSymptoms) {
      symptomCounts = JSON.parse(cachedSymptoms);
    } else {
      // This week: Monday to Sunday
      const weekDay = now.getUTCDay();
      const diffMon = weekDay === 0 ? 6 : weekDay - 1;
      const weekStart = new Date(now);
      weekStart.setUTCDate(now.getUTCDate() - diffMon);
      const weekStartStr = weekStart.toISOString().split('T')[0];
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
      const weekEndStr = weekEnd.toISOString().split('T')[0];

      const symptomRows = await database
        .select({
          symptomName: ClinicSymptomModel.name,
          count: sql<number>`SUM(${ClinicSymptomCountModel.count})::int`,
        })
        .from(ClinicSymptomCountModel)
        .innerJoin(
          ClinicSymptomModel,
          eq(ClinicSymptomCountModel.symptomId, ClinicSymptomModel.id)
        )
        .where(
          and(
            eq(ClinicSymptomModel.clinicId, clinicId),
            gte(ClinicSymptomCountModel.date, weekStartStr),
            lte(ClinicSymptomCountModel.date, weekEndStr)
          )
        )
        .groupBy(ClinicSymptomModel.id, ClinicSymptomModel.name)
        .orderBy(desc(sql`SUM(${ClinicSymptomCountModel.count})`));

      for (const row of symptomRows) {
        symptomCounts[row.symptomName] = Number(row.count || 0);
      }

      // Cache symptom counts for 1 week (604800 seconds)
      await redisClient.setex(
        symptomCacheKey,
        604800,
        JSON.stringify(symptomCounts)
      );
    }

    // Patient Overview: New vs Returning patients (current 30 days vs previous 30 days)
    const patientCacheKey = targetDoctorId
      ? `patient_overview:${clinicId}:doctor:${targetDoctorId}`
      : `patient_overview:${clinicId}:all`;

    let patientOverview: {
      newPatients: { count: number; trend: string };
      returningPatients: { count: number; trend: string };
    };

    const cachedPatients = await redisClient.get(patientCacheKey);
    if (cachedPatients) {
      patientOverview = JSON.parse(cachedPatients);
    } else {
      // Current 30 days and previous 30 days
      const current30Start = new Date(now);
      current30Start.setUTCDate(now.getUTCDate() - 29);
      current30Start.setUTCHours(0, 0, 0, 0);
      const current30End = new Date(now);
      current30End.setUTCHours(23, 59, 59, 999);

      const prev30End = new Date(current30Start);
      prev30End.setUTCDate(prev30End.getUTCDate() - 1);
      prev30End.setUTCHours(23, 59, 59, 999);
      const prev30Start = new Date(prev30End);
      prev30Start.setUTCDate(prev30End.getUTCDate() - 29);
      prev30Start.setUTCHours(0, 0, 0, 0);

      // Helper: get new and returning patient counts for a date range
      const getPatientStats = async (start: Date, end: Date) => {
        const baseConditions: any[] = [
          eq(AppointmentModel.clinicId, clinicId),
          gte(AppointmentModel.appointmentDate, start),
          lte(AppointmentModel.appointmentDate, end),
        ];
        if (targetDoctorId) {
          baseConditions.push(eq(AppointmentModel.doctorId, targetDoctorId));
        }

        // All unique patients in this range
        const patientsInRange = await database
          .selectDistinct({ patientId: AppointmentModel.patientId })
          .from(AppointmentModel)
          .where(and(...baseConditions));

        const patientIds = patientsInRange.map((p) => p.patientId);
        if (patientIds.length === 0) {
          return { newPatients: 0, returningPatients: 0 };
        }

        // Find which of these patients had an appointment BEFORE this range
        const beforeConditions: any[] = [
          eq(AppointmentModel.clinicId, clinicId),
          lt(AppointmentModel.appointmentDate, start),
          inArray(AppointmentModel.patientId, patientIds),
        ];
        if (targetDoctorId) {
          beforeConditions.push(eq(AppointmentModel.doctorId, targetDoctorId));
        }

        const returningRows = await database
          .selectDistinct({ patientId: AppointmentModel.patientId })
          .from(AppointmentModel)
          .where(and(...beforeConditions));

        const returningCount = returningRows.length;
        const newCount = patientIds.length - returningCount;

        return { newPatients: newCount, returningPatients: returningCount };
      };

      const currentStats = await getPatientStats(current30Start, current30End);
      const prevStats = await getPatientStats(prev30Start, prev30End);

      // Calculate trend percentage
      const calcTrend = (current: number, previous: number): string => {
        if (previous === 0) {
          return current > 0 ? `↑ 100%` : `0%`;
        }
        const percent = Math.round(((current - previous) / previous) * 100);
        if (percent > 0) return `↑ ${percent}%`;
        if (percent < 0) return `↓ ${Math.abs(percent)}%`;
        return `0%`;
      };

      patientOverview = {
        newPatients: {
          count: currentStats.newPatients,
          trend: calcTrend(currentStats.newPatients, prevStats.newPatients),
        },
        returningPatients: {
          count: currentStats.returningPatients,
          trend: calcTrend(
            currentStats.returningPatients,
            prevStats.returningPatients
          ),
        },
      };

      // Cache for 6 hours (21600 seconds)
      await redisClient.setex(
        patientCacheKey,
        21600,
        JSON.stringify(patientOverview)
      );
    }

    const result = {
      date: todayStart.toISOString().split('T')[0],
      appointments: {
        total: totalAppointments,
        remaining,
        completed,
        pending,
        confirmed,
        cancelled,
        noShow,
      },
      revenue: {
        todayRevenue,
        todayPaidAppointments,
        todayPendingPayments,
        todayPendingCount,
      },
      todaysAppointments: filterTodaysAppointments(
        todaysAppointments.map((a) => ({
          id: a.id,
          appointmentDate: a.appointmentDate,
          appointmentTime: a.appointmentTime,
          appointmentType: a.appointmentType,
          appointmentStatus: a.appointmentStatus,
          tokenNo: a.tokenNo,
          patientName: a.patientName,
          patientMobile: a.patientMobile || null,
          patientAge: a.patientAge,
          patientGender: a.patientGender,
          patientProfileImage: a.patientProfileImage,
          paymentStatus: a.paymentStatus || null,
          reason: a.commonSymptoms?.length ? a.commonSymptoms.join(', ') : null,
        }))
      ),
      symptomCounts: {
        period: 'this_week',
        data: symptomCounts,
      },
      patientOverview: {
        period: 'past_30_days',
        ...patientOverview,
      },
      meta: {
        clinicId,
        doctorId: targetDoctorId ?? null,
        generatedAt: now.toISOString(),
      },
    };

    // Cache for 2 minutes (120 seconds)
    await redisClient.setex(cacheKey, 120, JSON.stringify(result));

    return result;
  }

  static async getReceptionOverview(
    clinicId: string,
    opts?: { doctorId?: string; allowedDoctorIds?: string[] | null }
  ): Promise<ReceptionOverview> {
    const doctorId = opts?.doctorId;
    const allowedDoctorIds = opts?.allowedDoctorIds ?? null;
    const scopeFilter = doctorScopeFilter(
      AppointmentModel.doctorId,
      allowedDoctorIds
    );

    return getOrSetCache(
      CacheKeys.receptionOverview(
        clinicId,
        doctorId,
        scopeCacheKey(allowedDoctorIds)
      ),
      60,
      async () => {
        // The IST day, not the UTC one — see istDayBoundsUtc.
        const { start: todayStart, end: todayEnd } = istDayBoundsUtc();

        const baseConditions = and(
          eq(AppointmentModel.clinicId, clinicId),
          gte(AppointmentModel.appointmentDate, todayStart),
          lte(AppointmentModel.appointmentDate, todayEnd),
          ...(doctorId ? [eq(AppointmentModel.doctorId, doctorId)] : []),
          ...(scopeFilter ? [scopeFilter] : [])
        );

        const countsQuery = database
          .select({
            total: sql`COUNT(*)::int`,
            pending: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Pending' THEN 1 END)::int`,
            confirmed: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Confirmed' THEN 1 END)::int`,
            completed: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Completed' THEN 1 END)::int`,
            cancelled: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Cancelled' THEN 1 END)::int`,
            noShow: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'NoShow' THEN 1 END)::int`,
          })
          .from(AppointmentModel)
          .where(baseConditions);

        const paymentsQuery = database
          .select({
            collected: sql`COALESCE(SUM(CASE WHEN ${AppointmentPaymentModel.paymentStatus} = 'Paid' THEN ${AppointmentPaymentModel.price}::numeric ELSE 0 END), 0)`,
            paidCount: sql`COUNT(CASE WHEN ${AppointmentPaymentModel.paymentStatus} = 'Paid' THEN 1 END)::int`,
            pendingAmount: sql`COALESCE(SUM(CASE WHEN ${AppointmentPaymentModel.paymentStatus} = 'Pending' THEN ${AppointmentPaymentModel.price}::numeric ELSE 0 END), 0)`,
            pendingCount: sql`COUNT(CASE WHEN ${AppointmentPaymentModel.paymentStatus} = 'Pending' THEN 1 END)::int`,
          })
          .from(AppointmentModel)
          .innerJoin(
            AppointmentPaymentModel,
            eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
          )
          .where(
            and(
              baseConditions,
              sql`${AppointmentModel.appointmentStatus} NOT IN ('Cancelled', 'NoShow')`
            )
          );

        // "New patient" = their first-ever appointment at this clinic is today
        // (clinic-wide on purpose — a doctor filter shouldn't change who counts
        // as new to the clinic). Grouped rows are few, so counting them in JS
        // avoids a wrapping subquery.
        const newPatientsQuery = database
          .select({ patientId: AppointmentModel.patientId })
          .from(AppointmentModel)
          .where(
            and(
              eq(AppointmentModel.clinicId, clinicId),
              ...(scopeFilter ? [scopeFilter] : [])
            )
          )
          .groupBy(AppointmentModel.patientId)
          .having(
            and(
              gte(
                sql`MIN(${AppointmentModel.appointmentDate})`,
                todayStart.toISOString()
              ),
              lte(
                sql`MIN(${AppointmentModel.appointmentDate})`,
                todayEnd.toISOString()
              )
            )
          );

        const doctorQueuesQuery = database
          .select({
            doctorId: AppointmentModel.doctorId,
            doctorName: UserModel.name,
            total: sql`COUNT(*)::int`,
            completed: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Completed' THEN 1 END)::int`,
            cancelled: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Cancelled' THEN 1 END)::int`,
            noShow: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'NoShow' THEN 1 END)::int`,
          })
          .from(AppointmentModel)
          .innerJoin(UserModel, eq(UserModel.id, AppointmentModel.doctorId))
          .where(baseConditions)
          .groupBy(AppointmentModel.doctorId, UserModel.name)
          .orderBy(desc(sql`COUNT(*)`));

        const [[counts], [payments], newPatientRows, doctorQueues] =
          await Promise.all([
            countsQuery,
            paymentsQuery,
            newPatientsQuery,
            doctorQueuesQuery,
          ]);

        const total = Number(counts?.total || 0);
        const completed = Number(counts?.completed || 0);
        const cancelled = Number(counts?.cancelled || 0);
        const noShow = Number(counts?.noShow || 0);

        return {
          appointments: {
            total,
            pending: Number(counts?.pending || 0),
            confirmed: Number(counts?.confirmed || 0),
            completed,
            cancelled,
            noShow,
            remaining: total - completed - cancelled - noShow,
          },
          payments: {
            collectedToday: parseFloat(String(payments?.collected ?? '0')),
            paidCount: Number(payments?.paidCount || 0),
            pendingAmount: parseFloat(String(payments?.pendingAmount ?? '0')),
            pendingCount: Number(payments?.pendingCount || 0),
          },
          patientsRegisteredToday: newPatientRows.length,
          doctorQueues: doctorQueues.map((q) => {
            const qTotal = Number(q.total || 0);
            const qCompleted = Number(q.completed || 0);
            return {
              doctorId: String(q.doctorId ?? ''),
              doctorName: String(q.doctorName ?? 'Unknown'),
              total: qTotal,
              completed: qCompleted,
              remaining:
                qTotal -
                qCompleted -
                Number(q.cancelled || 0) -
                Number(q.noShow || 0),
            };
          }),
        };
      }
    );
  }

  /**
   * Get today's operational stats for the receptionist dashboard: appointment
   * totals, queue-waiting count, currently-active doctors (derived from
   * weekly/date-override availability, leave and breaks), pending payments,
   * and clinic day-progress (earliest doctor start -> latest doctor end, %
   * elapsed). Cached in Redis for 60 seconds.
   */
  static async getReceptionTodayStats(
    clinicId: string,
    allowedDoctorIds: string[] | null = null
  ): Promise<ReceptionTodayStats> {
    const appointmentScopeFilter = doctorScopeFilter(
      AppointmentModel.doctorId,
      allowedDoctorIds
    );
    const staffScopeFilter = doctorScopeFilter(UserModel.id, allowedDoctorIds);

    return getOrSetCache(
      CacheKeys.receptionTodayStats(
        clinicId,
        await getDashboardCacheVersion(clinicId),
        scopeCacheKey(allowedDoctorIds)
      ),
      60,
      async () => {
        const now = new Date();
        // The IST day, not the UTC one — see istDayBoundsUtc.
        const { start: todayStart, end: todayEnd } = istDayBoundsUtc();

        const { hours: istHours, minutes: istMinutes } =
          getISTHoursMinutes(now);
        const nowMinutes = istHours * 60 + istMinutes;

        const baseConditions = and(
          eq(AppointmentModel.clinicId, clinicId),
          gte(AppointmentModel.appointmentDate, todayStart),
          lte(AppointmentModel.appointmentDate, todayEnd),
          ...(appointmentScopeFilter ? [appointmentScopeFilter] : [])
        );

        const countsQuery = database
          .select({
            total: sql`COUNT(*)::int`,
            completed: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Completed' THEN 1 END)::int`,
            patientArrived: sql`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Patient Arrived' THEN 1 END)::int`,
          })
          .from(AppointmentModel)
          .where(baseConditions);

        const pendingPaymentQuery = database
          .select({ pending: sql`COUNT(*)::int` })
          .from(AppointmentModel)
          .innerJoin(
            AppointmentPaymentModel,
            eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
          )
          .where(
            and(
              baseConditions,
              eq(AppointmentPaymentModel.paymentStatus, 'Pending')
            )
          );

        const staffQuery = database
          .select({ userId: UserModel.id })
          .from(ClinicAssignModel)
          .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
          .where(
            and(
              eq(ClinicAssignModel.clinicId, clinicId),
              inArray(UserModel.userType, ['Doctor', 'Admin']),
              ...(staffScopeFilter ? [staffScopeFilter] : [])
            )
          );

        const [[counts], [pendingPayment], staff] = await Promise.all([
          countsQuery,
          pendingPaymentQuery,
          staffQuery,
        ]);

        const total = Number(counts?.total || 0);
        const completed = Number(counts?.completed || 0);
        const patientArrived = Number(counts?.patientArrived || 0);
        const pendingCount = Number(pendingPayment?.pending || 0);

        const staffIds = staff.map((s) => s.userId);

        let activeNow = 0;
        let totalAvailableToday = 0;
        let clinicStartMinutes: number | null = null;
        let clinicEndMinutes: number | null = null;

        const [availabilityResults, { arrivals }] = await Promise.all([
          resolveDoctorAvailabilityToday(clinicId, staffIds),
          DoctorArrivalService.getActiveForClinic(clinicId, staffIds),
        ]);

        // On duty = scheduled right now AND arrival marked for that shift.
        // A shift merely having started doesn't put a doctor on duty.
        const arrivedDoctorIds = new Set(arrivals.map((a) => a.doctorId));

        for (const result of availabilityResults) {
          if (result.windows.length === 0) continue; // on leave / not scheduled today

          totalAvailableToday += 1;
          if (result.isActiveNow && arrivedDoctorIds.has(result.doctorId)) {
            activeNow += 1;
          }

          for (const w of result.windows) {
            clinicStartMinutes =
              clinicStartMinutes === null
                ? w.start
                : Math.min(clinicStartMinutes, w.start);
            clinicEndMinutes =
              clinicEndMinutes === null
                ? w.end
                : Math.max(clinicEndMinutes, w.end);
          }
        }

        let percentage = 0;
        if (
          clinicStartMinutes !== null &&
          clinicEndMinutes !== null &&
          clinicEndMinutes > clinicStartMinutes
        ) {
          const raw =
            ((nowMinutes - clinicStartMinutes) /
              (clinicEndMinutes - clinicStartMinutes)) *
            100;
          percentage = Math.max(0, Math.min(100, Math.round(raw)));
        }

        let timeLeft = '-';
        if (
          clinicStartMinutes !== null &&
          clinicEndMinutes !== null &&
          nowMinutes >= clinicStartMinutes
        ) {
          timeLeft = formatDurationMinutes(clinicEndMinutes - nowMinutes);
        }

        return {
          todayAppointments: { total, left: total - completed },
          queueWaiting: { total, patientArrived },
          activeDoctors: { activeNow, totalAvailableToday },
          pendingPayment: { pending: pendingCount, total },
          dayProgress: {
            clinicStartTime:
              clinicStartMinutes === null
                ? null
                : minutesToTime12h(clinicStartMinutes),
            clinicEndTime:
              clinicEndMinutes === null
                ? null
                : minutesToTime12h(clinicEndMinutes),
            currentTime: minutesToTimeString(nowMinutes),
            percentage,
            timeLeft,
          },
        };
      }
    );
  }

  /**
   * Get Super Admin Revenue Overview
   * Returns revenue overview (daily series, current period total, hike percentage)
   * Calculates revenue from both clinic_subscriptions and clinic_add_ons.
   * Cached in Redis for 1 hour.
   */
  static async getSuperAdminRevenueOverview(opts?: { period?: string }) {
    const today = new Date();
    const period = opts?.period || 'month';
    const isYear =
      period === 'year' || period === 'thisYear' || period === 'yearly';

    let currentStart: Date;
    let currentEnd: Date;

    if (isYear) {
      currentStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
      currentEnd = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
      currentEnd.setUTCHours(23, 59, 59, 999);
    } else {
      currentStart = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
      );
      currentEnd = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)
      );
      currentEnd.setUTCHours(23, 59, 59, 999);
    }

    const cacheKey = `super_admin_revenue_overview:${period}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const durationMs = currentEnd.getTime() - currentStart.getTime();
    const previousEnd = new Date(currentStart.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - durationMs);

    const calculateHike = (current: number, previous: number): string => {
      let percent = 0;
      if (previous === 0) {
        percent = current > 0 ? 100 : 0;
      } else {
        percent = ((current - previous) / previous) * 100;
      }
      if (percent > 0) return `+${percent.toFixed(1)}%`;
      if (percent < 0) return `${percent.toFixed(1)}%`;
      return '0%';
    };

    const formatSeries = (
      subData: any[],
      addOnData: any[],
      startDate: Date,
      endDate: Date
    ): { labels: string[]; data: number[] } => {
      const labels: string[] = [];
      const values: number[] = [];

      const dataMap = new Map<string, number>();

      subData.forEach((item) => {
        const dateStr = new Date(item.period).toISOString().split('T')[0];
        dataMap.set(dateStr, Number(item.amount || 0));
      });

      addOnData.forEach((item) => {
        const dateStr = new Date(item.period).toISOString().split('T')[0];
        const existing = dataMap.get(dateStr) || 0;
        dataMap.set(dateStr, existing + Number(item.amount || 0));
      });

      const current = new Date(startDate);
      while (current <= endDate) {
        const dateStr = current.toISOString().split('T')[0];
        const label = new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
        }).format(current);
        labels.push(label);
        values.push(dataMap.get(dateStr) || 0);
        current.setDate(current.getDate() + 1);
      }
      return { labels, data: values };
    };

    const result = await database.transaction(async (tx) => {
      // Subscriptions current period
      const [subCurrent] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicSubscriptionModel.price}::numeric), 0)::int`,
        })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.paymentStatus, 'success'),
            between(ClinicSubscriptionModel.createdAt, currentStart, currentEnd)
          )
        );

      // Add-ons current period
      const [addOnCurrent] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicAddOnModel.price}::numeric), 0)::int`,
        })
        .from(ClinicAddOnModel)
        .where(
          and(
            eq(ClinicAddOnModel.paymentStatus, 'success'),
            between(ClinicAddOnModel.createdAt, currentStart, currentEnd)
          )
        );

      // Subscriptions previous period
      const [subPrevious] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicSubscriptionModel.price}::numeric), 0)::int`,
        })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.paymentStatus, 'success'),
            between(
              ClinicSubscriptionModel.createdAt,
              previousStart,
              previousEnd
            )
          )
        );

      // Add-ons previous period
      const [addOnPrevious] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicAddOnModel.price}::numeric), 0)::int`,
        })
        .from(ClinicAddOnModel)
        .where(
          and(
            eq(ClinicAddOnModel.paymentStatus, 'success'),
            between(ClinicAddOnModel.createdAt, previousStart, previousEnd)
          )
        );

      // Daily series queries
      const subSeries = await tx
        .select({
          period: sql`DATE(${ClinicSubscriptionModel.createdAt})`,
          amount: sql`COALESCE(SUM(${ClinicSubscriptionModel.price}::numeric), 0)::int`,
        })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.paymentStatus, 'success'),
            between(ClinicSubscriptionModel.createdAt, currentStart, currentEnd)
          )
        )
        .groupBy(sql`DATE(${ClinicSubscriptionModel.createdAt})`);

      const addOnSeries = await tx
        .select({
          period: sql`DATE(${ClinicAddOnModel.createdAt})`,
          amount: sql`COALESCE(SUM(${ClinicAddOnModel.price}::numeric), 0)::int`,
        })
        .from(ClinicAddOnModel)
        .where(
          and(
            eq(ClinicAddOnModel.paymentStatus, 'success'),
            between(ClinicAddOnModel.createdAt, currentStart, currentEnd)
          )
        )
        .groupBy(sql`DATE(${ClinicAddOnModel.createdAt})`);

      const dailySeriesFormatted = formatSeries(
        subSeries,
        addOnSeries,
        currentStart,
        currentEnd
      );

      const currentTotal =
        Number(subCurrent?.total || 0) + Number(addOnCurrent?.total || 0);
      const previousTotal =
        Number(subPrevious?.total || 0) + Number(addOnPrevious?.total || 0);

      return {
        totalRevenue: currentTotal,
        hikePersent: calculateHike(currentTotal, previousTotal),
        dailySeries: dailySeriesFormatted,
      };
    });

    await redisClient.setex(cacheKey, 3600, JSON.stringify(result));
    return result;
  }

  /**
   * Get Super Admin Revenue by Plan
   * Returns revenue details grouped by plan name and add-on name.
   * Calculates revenue from both clinic_subscriptions and clinic_add_ons.
   * Cached in Redis for 1 hour.
   */
  static async getSuperAdminRevenueByPlan(opts?: { period?: string }) {
    const today = new Date();
    const period = opts?.period || 'month';
    const isYear =
      period === 'year' || period === 'thisYear' || period === 'yearly';

    let currentStart: Date;
    let currentEnd: Date;

    if (isYear) {
      currentStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
      currentEnd = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
      currentEnd.setUTCHours(23, 59, 59, 999);
    } else {
      currentStart = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
      );
      currentEnd = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)
      );
      currentEnd.setUTCHours(23, 59, 59, 999);
    }

    const cacheKey = `super_admin_revenue_by_plan:${period}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const result = await database.transaction(async (tx) => {
      // Subscriptions by plan
      const subRevenueByPlan = await tx
        .select({
          planName: SubscriptionPlanModel.name,
          amount: sql`COALESCE(SUM(${ClinicSubscriptionModel.price}::numeric), 0)::int`,
        })
        .from(ClinicSubscriptionModel)
        .innerJoin(
          SubscriptionPlanModel,
          eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
        )
        .where(
          and(
            eq(ClinicSubscriptionModel.paymentStatus, 'success'),
            between(ClinicSubscriptionModel.createdAt, currentStart, currentEnd)
          )
        )
        .groupBy(SubscriptionPlanModel.name);

      // Add-ons by name
      const addOnRevenueByPlan = await tx
        .select({
          planName: AddOnModel.name,
          amount: sql`COALESCE(SUM(${ClinicAddOnModel.price}::numeric), 0)::int`,
        })
        .from(ClinicAddOnModel)
        .innerJoin(AddOnModel, eq(ClinicAddOnModel.addOnId, AddOnModel.id))
        .where(
          and(
            eq(ClinicAddOnModel.paymentStatus, 'success'),
            between(ClinicAddOnModel.createdAt, currentStart, currentEnd)
          )
        )
        .groupBy(AddOnModel.name);

      const combined = [
        ...subRevenueByPlan.map((item) => ({
          planName: item.planName || 'Unknown Plan',
          amount: Number(item.amount),
        })),
        ...addOnRevenueByPlan.map((item) => ({
          planName: item.planName || 'Unknown Add-On',
          amount: Number(item.amount),
        })),
      ];

      const totalAmount = combined.reduce((sum, item) => sum + item.amount, 0);

      const formattedByPlan = combined.map((item) => ({
        planName: item.planName,
        amount: item.amount,
        percentage:
          totalAmount > 0
            ? Number(((item.amount / totalAmount) * 100).toFixed(1))
            : 0,
      }));

      return {
        totalRevenue: totalAmount,
        byPlan: formattedByPlan,
      };
    });

    await redisClient.setex(cacheKey, 3600, JSON.stringify(result));
    return result;
  }

  /**
   * Get Super Admin Revenue Analytics
   * Returns weekly or monthly revenue analytics.
   * Calculates revenue from both clinic_subscriptions and clinic_add_ons.
   * Cached in Redis for 1 hour.
   */
  static async getSuperAdminRevenueAnalytics(opts?: { period?: string }) {
    const today = new Date();
    const period = opts?.period || 'month';
    const isWeek =
      period === 'week' || period === 'thisWeek' || period === 'weekly';

    let currentStart: Date;
    let currentEnd: Date;
    let previousStart: Date;
    let previousEnd: Date;
    let priorPreviousStart: Date;
    let priorPreviousEnd: Date;

    if (isWeek) {
      const dayOfWeek = today.getUTCDay();
      const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

      currentStart = new Date(today);
      currentStart.setUTCDate(today.getUTCDate() - diffToMonday);
      currentStart.setUTCHours(0, 0, 0, 0);

      currentEnd = new Date(currentStart);
      currentEnd.setUTCDate(currentStart.getUTCDate() + 6);
      currentEnd.setUTCHours(23, 59, 59, 999);

      previousStart = new Date(currentStart);
      previousStart.setUTCDate(currentStart.getUTCDate() - 7);
      previousEnd = new Date(currentEnd);
      previousEnd.setUTCDate(currentEnd.getUTCDate() - 7);

      priorPreviousStart = new Date(previousStart);
      priorPreviousStart.setUTCDate(previousStart.getUTCDate() - 7);
      priorPreviousEnd = new Date(previousEnd);
      priorPreviousEnd.setUTCDate(previousEnd.getUTCDate() - 7);
    } else {
      currentStart = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
      );
      currentEnd = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)
      );
      currentEnd.setUTCHours(23, 59, 59, 999);

      previousStart = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)
      );
      previousEnd = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)
      );
      previousEnd.setUTCHours(23, 59, 59, 999);

      priorPreviousStart = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1)
      );
      priorPreviousEnd = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 0)
      );
      priorPreviousEnd.setUTCHours(23, 59, 59, 999);
    }

    const cacheKey = `super_admin_revenue_analytics:${period}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const calcGrowthPercent = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Number((((current - previous) / previous) * 100).toFixed(1));
    };

    const result = await database.transaction(async (tx) => {
      // Current Period
      const [subCurrent] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicSubscriptionModel.price}::numeric), 0)::int`,
        })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.paymentStatus, 'success'),
            between(ClinicSubscriptionModel.createdAt, currentStart, currentEnd)
          )
        );

      const [addOnCurrent] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicAddOnModel.price}::numeric), 0)::int`,
        })
        .from(ClinicAddOnModel)
        .where(
          and(
            eq(ClinicAddOnModel.paymentStatus, 'success'),
            between(ClinicAddOnModel.createdAt, currentStart, currentEnd)
          )
        );

      // Previous Period
      const [subPrevious] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicSubscriptionModel.price}::numeric), 0)::int`,
        })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.paymentStatus, 'success'),
            between(
              ClinicSubscriptionModel.createdAt,
              previousStart,
              previousEnd
            )
          )
        );

      const [addOnPrevious] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicAddOnModel.price}::numeric), 0)::int`,
        })
        .from(ClinicAddOnModel)
        .where(
          and(
            eq(ClinicAddOnModel.paymentStatus, 'success'),
            between(ClinicAddOnModel.createdAt, previousStart, previousEnd)
          )
        );

      // Prior Previous Period
      const [subPriorPrevious] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicSubscriptionModel.price}::numeric), 0)::int`,
        })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.paymentStatus, 'success'),
            between(
              ClinicSubscriptionModel.createdAt,
              priorPreviousStart,
              priorPreviousEnd
            )
          )
        );

      const [addOnPriorPrevious] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicAddOnModel.price}::numeric), 0)::int`,
        })
        .from(ClinicAddOnModel)
        .where(
          and(
            eq(ClinicAddOnModel.paymentStatus, 'success'),
            between(
              ClinicAddOnModel.createdAt,
              priorPreviousStart,
              priorPreviousEnd
            )
          )
        );

      // All Time (Up to Current End)
      const [subAllTime] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicSubscriptionModel.price}::numeric), 0)::int`,
        })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.paymentStatus, 'success'),
            lte(ClinicSubscriptionModel.createdAt, currentEnd)
          )
        );

      const [addOnAllTime] = await tx
        .select({
          total: sql`COALESCE(SUM(${ClinicAddOnModel.price}::numeric), 0)::int`,
        })
        .from(ClinicAddOnModel)
        .where(
          and(
            eq(ClinicAddOnModel.paymentStatus, 'success'),
            lte(ClinicAddOnModel.createdAt, currentEnd)
          )
        );

      const currentVal =
        Number(subCurrent?.total || 0) + Number(addOnCurrent?.total || 0);
      const previousVal =
        Number(subPrevious?.total || 0) + Number(addOnPrevious?.total || 0);
      const priorPreviousVal =
        Number(subPriorPrevious?.total || 0) +
        Number(addOnPriorPrevious?.total || 0);
      const allTimeVal =
        Number(subAllTime?.total || 0) + Number(addOnAllTime?.total || 0);

      return {
        currentPeriod: {
          amount: currentVal,
          growthPercent: calcGrowthPercent(currentVal, previousVal),
        },
        previousPeriod: {
          amount: previousVal,
          growthPercent: calcGrowthPercent(previousVal, priorPreviousVal),
        },
        allTime: {
          amount: allTimeVal,
          growthPercent: calcGrowthPercent(currentVal, previousVal),
        },
      };
    });

    await redisClient.setex(cacheKey, 3600, JSON.stringify(result));
    return result;
  }

  /**
   * Get Super Admin Top Performing Clinics
   * Returns top performing clinics based on subscription + add-on revenue with growth calculation.
   * Cached in Redis for 1 hour.
   */
  static async getSuperAdminTopPerformingClinics(opts?: { period?: string }) {
    const today = new Date();
    const period = opts?.period || 'month';
    const isYear =
      period === 'year' || period === 'thisYear' || period === 'yearly';

    let currentStart: Date;
    let currentEnd: Date;

    if (isYear) {
      currentStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
      currentEnd = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
      currentEnd.setUTCHours(23, 59, 59, 999);
    } else {
      currentStart = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
      );
      currentEnd = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)
      );
      currentEnd.setUTCHours(23, 59, 59, 999);
    }

    const cacheKey = `super_admin_top_performing_clinics:${period}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const durationMs = currentEnd.getTime() - currentStart.getTime();
    const previousEnd = new Date(currentStart.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - durationMs);

    const result = await database.transaction(async (tx) => {
      // Sum subscriptions in current period
      const subRevenues = await tx
        .select({
          clinicId: ClinicSubscriptionModel.clinicId,
          name: ClinicModel.clinicName,
          subTotal: sql`COALESCE(SUM(${ClinicSubscriptionModel.price}::numeric), 0)::numeric`,
        })
        .from(ClinicSubscriptionModel)
        .innerJoin(
          ClinicModel,
          eq(ClinicSubscriptionModel.clinicId, ClinicModel.id)
        )
        .where(
          and(
            eq(ClinicSubscriptionModel.paymentStatus, 'success'),
            between(ClinicSubscriptionModel.createdAt, currentStart, currentEnd)
          )
        )
        .groupBy(ClinicSubscriptionModel.clinicId, ClinicModel.clinicName);

      // Sum add-ons in current period
      const addOnRevenues = await tx
        .select({
          clinicId: ClinicAddOnModel.clinicId,
          name: ClinicModel.clinicName,
          addOnTotal: sql`COALESCE(SUM(${ClinicAddOnModel.price}::numeric), 0)::numeric`,
        })
        .from(ClinicAddOnModel)
        .innerJoin(ClinicModel, eq(ClinicAddOnModel.clinicId, ClinicModel.id))
        .where(
          and(
            eq(ClinicAddOnModel.paymentStatus, 'success'),
            between(ClinicAddOnModel.createdAt, currentStart, currentEnd)
          )
        )
        .groupBy(ClinicAddOnModel.clinicId, ClinicModel.clinicName);

      const clinicMap = new Map<
        string,
        { name: string; currentRevenue: number; previousRevenue: number }
      >();

      subRevenues.forEach((r) => {
        clinicMap.set(r.clinicId, {
          name: r.name,
          currentRevenue: Number(r.subTotal),
          previousRevenue: 0,
        });
      });

      addOnRevenues.forEach((r) => {
        const existing = clinicMap.get(r.clinicId);
        if (existing) {
          existing.currentRevenue += Number(r.addOnTotal);
        } else {
          clinicMap.set(r.clinicId, {
            name: r.name,
            currentRevenue: Number(r.addOnTotal),
            previousRevenue: 0,
          });
        }
      });

      const clinicIds = Array.from(clinicMap.keys());
      if (clinicIds.length > 0) {
        const prevSubs = await tx
          .select({
            clinicId: ClinicSubscriptionModel.clinicId,
            subTotal: sql`COALESCE(SUM(${ClinicSubscriptionModel.price}::numeric), 0)::numeric`,
          })
          .from(ClinicSubscriptionModel)
          .where(
            and(
              eq(ClinicSubscriptionModel.paymentStatus, 'success'),
              between(
                ClinicSubscriptionModel.createdAt,
                previousStart,
                previousEnd
              ),
              inArray(ClinicSubscriptionModel.clinicId, clinicIds)
            )
          )
          .groupBy(ClinicSubscriptionModel.clinicId);

        const prevAddOns = await tx
          .select({
            clinicId: ClinicAddOnModel.clinicId,
            addOnTotal: sql`COALESCE(SUM(${ClinicAddOnModel.price}::numeric), 0)::numeric`,
          })
          .from(ClinicAddOnModel)
          .where(
            and(
              eq(ClinicAddOnModel.paymentStatus, 'success'),
              between(ClinicAddOnModel.createdAt, previousStart, previousEnd),
              inArray(ClinicAddOnModel.clinicId, clinicIds)
            )
          )
          .groupBy(ClinicAddOnModel.clinicId);

        prevSubs.forEach((r) => {
          const clinic = clinicMap.get(r.clinicId);
          if (clinic) clinic.previousRevenue += Number(r.subTotal);
        });

        prevAddOns.forEach((r) => {
          const clinic = clinicMap.get(r.clinicId);
          if (clinic) clinic.previousRevenue += Number(r.addOnTotal);
        });
      }

      const topClinicsList = Array.from(clinicMap.values())
        .map((c) => {
          const current = c.currentRevenue;
          const previous = c.previousRevenue;
          let growthPercent = 0;
          if (previous === 0) {
            growthPercent = current > 0 ? 100 : 0;
          } else {
            growthPercent = Number(
              (((current - previous) / previous) * 100).toFixed(1)
            );
          }
          return {
            name: c.name,
            revenue: current,
            growthPercent,
          };
        })
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 4);

      return topClinicsList;
    });

    await redisClient.setex(cacheKey, 3600, JSON.stringify(result));
    return result;
  }

  /**
   * Get Super Admin Registration Trends
   * Returns clinic registration trend data.
   * Cached in Redis for 1 hour.
   */
  static async getSuperAdminRegistrationTrends(opts?: { period?: string }) {
    const today = new Date();
    const period = opts?.period || 'month';
    const isYear =
      period === 'year' || period === 'thisYear' || period === 'yearly';

    let currentStart: Date;
    let currentEnd: Date;

    if (isYear) {
      currentStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
      currentEnd = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
      currentEnd.setUTCHours(23, 59, 59, 999);
    } else {
      currentStart = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
      );
      currentEnd = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)
      );
      currentEnd.setUTCHours(23, 59, 59, 999);
    }

    const cacheKey = `super_admin_registration_trends:${period}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const formatSeries = (
      data: any[],
      startDate: Date,
      endDate: Date
    ): { labels: string[]; data: number[] } => {
      const labels: string[] = [];
      const values: number[] = [];
      const dataMap = new Map(
        data.map((item) => [
          new Date(item.period).toISOString().split('T')[0],
          Number(item.amount || item.count || 0),
        ])
      );

      const current = new Date(startDate);
      while (current <= endDate) {
        const dateStr = current.toISOString().split('T')[0];
        const label = new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
        }).format(current);
        labels.push(label);
        values.push(dataMap.get(dateStr) || 0);
        current.setDate(current.getDate() + 1);
      }
      return { labels, data: values };
    };

    const result = await database.transaction(async (tx) => {
      const registrations = await tx
        .select({
          period: sql`DATE(${ClinicModel.createdAt})`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(ClinicModel)
        .where(between(ClinicModel.createdAt, currentStart, currentEnd))
        .groupBy(sql`DATE(${ClinicModel.createdAt})`)
        .orderBy(sql`DATE(${ClinicModel.createdAt})`);

      const registrationTrendsFormatted = formatSeries(
        registrations,
        currentStart,
        currentEnd
      );

      return {
        clinics: registrationTrendsFormatted,
      };
    });

    await redisClient.setex(cacheKey, 3600, JSON.stringify(result));
    return result;
  }

  /**
   * Get Super Admin Users by Role and Subscription by Plan Summary
   * Returns unfiltered totals and percentages.
   * Cached in Redis for 1 hour.
   */
  static async getSuperAdminUsersSubscriptionsSummary() {
    const cacheKey = `super_admin_users_subscriptions_summary`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const result = await database.transaction(async (tx) => {
      // 1. Users by role
      const usersByRole = await tx
        .select({
          userType: UserModel.userType,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(UserModel)
        .groupBy(UserModel.userType);

      const totalUsers = usersByRole.reduce((sum, r) => sum + r.count, 0);

      const formattedUsersByRole = usersByRole.map((r) => ({
        userType: r.userType,
        count: r.count,
        percentage:
          totalUsers > 0
            ? Number(((r.count / totalUsers) * 100).toFixed(1))
            : 0,
      }));

      // 2. Active subscription plans
      const activeSubscriptions = await tx
        .select({
          planName: SubscriptionPlanModel.name,
        })
        .from(ClinicSubscriptionModel)
        .innerJoin(
          SubscriptionPlanModel,
          eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
        )
        .where(eq(ClinicSubscriptionModel.active, true));

      const planCounts: Record<string, number> = {};
      activeSubscriptions.forEach((sub) => {
        const pName = sub.planName || 'Unknown Plan';
        planCounts[pName] = (planCounts[pName] || 0) + 1;
      });

      const subscriptionsByPlan = Object.entries(planCounts).map(
        ([planName, count]) => ({
          planName,
          count,
        })
      );

      return {
        usersByRole: formattedUsersByRole,
        subscriptionsByPlan,
      };
    });

    await redisClient.setex(cacheKey, 3600, JSON.stringify(result));
    return result;
  }
}
