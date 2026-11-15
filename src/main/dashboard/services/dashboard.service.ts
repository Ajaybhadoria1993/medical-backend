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
  lte,
  sql,
} from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { AuthUser } from '../../../middlewear/auth.middleware';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import { AppointmentClinicalModel } from '../../appointments/models/appointmentClinical.model';
import { AppointmentSlotsService } from '../../appointments/services/appointmentSlots.service';
import { AppointmentPaymentsService } from '../../appointments/services/appointmentPayments.service';
import { DoctorArrivalService } from '../../appointment-engine/services/doctorArrival.service';
import { getCurrentAppointmentId } from '../../appointment-engine/services/queueHoldStore.service';
import { ScheduleShiftService } from '../../appointment-engine/services/scheduleShift.service';
import { SlotConfigService } from '../../appointment-engine/services/slotConfig.service';
import { getISTDateString } from '../../../utils/istDateTime';
import { DoctorTopSymptom } from '../types/doctorDashboard.types';
import { ClinicSymptomCountModel } from '../../clinic/models/clinic-symptom-count.model';
import { ClinicSymptomModel } from '../../clinic/models/clinic-symptom.model';
import {
  ClinicAssignModel,
  ClinicModel,
} from '../../clinic/models/clinic.model';
import { resolveDoctorAvailabilityToday } from '../../clinic/services/doctorAvailability.service';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import {
  comparisonRanges,
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
import { ClinicInsightsService } from './clinicInsights.service';
import { CLINIC_AMOUNT, DUE_AMOUNT } from '../utils/revenueSql';
import { MoneyReadService } from '../../money';
import { getDashboardCacheVersion } from '../utils/dashboardCache.utils';
import logger from '../../../utils/logger';
import { FEATURE_KEYS, LimitationService } from '../../subscription';
import type { GetAppointmentPaymentsDto } from '../../appointments/schemas/appointment.schemas';
import { firstVisitJoin } from '../../reportsOverview/utils/reportsPeriod.utils';

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

/** New vs returning patients seen in a range, on the Reports rule (`firstVisitJoin`): new = first
 *  appointment at the clinic (with this doctor, if given) falls in the range. */
async function patientSplit(
  clinicId: string,
  doctorId: string | undefined,
  startDate: Date,
  endDate: Date
) {
  // Raw sql can't bind a Date; ISO strings are what the column helpers send.
  const start = startDate.toISOString();
  const end = endDate.toISOString();
  const [row]: any[] = await database.execute(sql`
    SELECT
      COUNT(DISTINCT ${AppointmentModel.patientId}) FILTER (WHERE fv.first_visit >= ${start})::int AS new_patients,
      COUNT(DISTINCT ${AppointmentModel.patientId}) FILTER (WHERE fv.first_visit < ${start})::int AS returning_patients
    FROM ${AppointmentModel}
    ${firstVisitJoin(clinicId, doctorId)}
    WHERE ${AppointmentModel.clinicId} = ${clinicId}
      AND ${AppointmentModel.appointmentDate} BETWEEN ${start} AND ${end}
      ${doctorId ? sql`AND ${AppointmentModel.doctorId} = ${doctorId}` : sql``}
  `);
  return {
    newPatients: Number(row?.new_patients ?? 0),
    returningPatients: Number(row?.returning_patients ?? 0),
  };
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

  /** Old v1 doctor dashboard; the web uses V2, kept for older app builds. */
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
        // Earning is the doctor's received money from the ledger, same as V2 and Finance.
        const money = await MoneyReadService.totals({
          clinicId,
          start: start.toISOString(),
          end: end.toISOString(),
          doctorIds: [doctorId],
        });
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
          earning: money.netPaise / 100,
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
   * volatility. See docs/dashboard/DOCTOR_DASHBOARD.md for the full write-up.
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
                ${AppointmentPaymentModel.price}::numeric - COALESCE((
                  SELECT SUM(me.amount_paise) / 100.0 FROM money_entries me
                  WHERE me.source_type = 'appointment' AND me.source_id = ${AppointmentModel.id}
                    AND me.account = 'clinic' AND me.entry_type = 'refund'
                ), ${AppointmentPaymentModel.price}::numeric)
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

    const getPatientTypeStats = (start: Date, end: Date) =>
      patientSplit(clinicId, doctorId, start, end);

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
        uniquePatients: {
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

      // Dashboard rule: values cover the whole range, each % compares only the part up to today.
      const cmp = comparisonRanges(
        opts.startDate ?? startStr,
        opts.endDate ?? endStr
      );
      const rangeRunsPastToday = cmp.compareEnd.getTime() < cmp.end.getTime();
      const [
        currentPatientTypeStats,
        elapsedPatientTypeStats,
        prevPatientTypeStats,
        topSymptomRows,
      ] = await Promise.all([
        getPatientTypeStats(currentStart, currentEnd),
        rangeRunsPastToday
          ? getPatientTypeStats(cmp.start, cmp.compareEnd)
          : null,
        getPatientTypeStats(cmp.prevStart, cmp.prevEnd),
        topSymptomsQuery,
      ]);
      const elapsedStats = elapsedPatientTypeStats ?? currentPatientTypeStats;
      const patientTrend = (
        count: number,
        elapsed: number,
        previous: number
      ) => ({
        count,
        hikePercent: calculateHike(elapsed, previous),
        previous,
      });

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
          newPatients: patientTrend(
            currentPatientTypeStats.newPatients,
            elapsedStats.newPatients,
            prevPatientTypeStats.newPatients
          ),
          returningPatients: patientTrend(
            currentPatientTypeStats.returningPatients,
            elapsedStats.returningPatients,
            prevPatientTypeStats.returningPatients
          ),
          // New + returning are the range's distinct patients, so unique is their sum.
          uniquePatients: patientTrend(
            currentPatientTypeStats.newPatients +
              currentPatientTypeStats.returningPatients,
            elapsedStats.newPatients + elapsedStats.returningPatients,
            prevPatientTypeStats.newPatients +
              prevPatientTypeStats.returningPatients
          ),
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

  /** Treatment plan card: live plan counts plus the range's plan money (already read). A failed
   *  lookup is logged and only hides the card. */
  private static async treatmentPlanSummary(
    clinicId: string,
    money: { received: number; refunded: number; due: number }
  ) {
    try {
      // Dynamic, as notifications does: no import cycle between dashboard and treatmentPlan.
      const { treatmentPlanStatusCounts } = await import('../../treatmentPlan');
      return { ...(await treatmentPlanStatusCounts(clinicId)), ...money };
    } catch (err) {
      logger.error('[Dashboard] treatment plan summary failed', {
        clinicId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
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
    // The admin page's other cards, so it needs no today-overview or payments call.
    const extrasPromise = Promise.all([
      // A failure empties only its own card, as when each was a separate call.
      this.getCollections(clinicId, opts).catch((err) => {
        logger.error('[dashboard] collections summary failed:', err);
        return null;
      }),
      this.getWeekSymptomCounts(clinicId).catch((err) => {
        logger.error('[dashboard] weekly symptoms failed:', err);
        return {} as Record<string, number>;
      }),
      this.getPatientOverview(clinicId).catch((err) => {
        logger.error('[dashboard] patient overview failed:', err);
        return null;
      }),
    ]);
    extrasPromise.catch(() => undefined);

    // Default to the current IST month
    const todayYmd = getISTDateString();
    const [y, m] = todayYmd.split('-').map(Number);
    const range = comparisonRanges(
      opts.startDate ?? `${todayYmd.slice(0, 7)}-01`,
      opts.endDate ?? new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    );
    const { start: currentStart, end: currentEnd } = range;

    // Helper to calculate percentage and format string
    const calculateHike = (current: number, previous: number) => {
      // Nothing to compare against: "New", as Reports shows, not a made-up +100%.
      if (previous === 0) return current > 0 ? 'New (0)' : '0 (0)';
      const percent = ((current - previous) / previous) * 100;
      const formattedPercent =
        percent > 0 ? `+${percent.toFixed(0)}` : percent.toFixed(0);
      return `${formattedPercent} (${previous})`;
    };

    // Helper to run count queries for a specific range.
    // The three aggregate queries are independent, so we run them in parallel
    // instead of sequentially to reduce total dashboard latency.
    const getStatsForRange = async (start: Date, end: Date) => {
      // Money from the ledger reader, on the same IST days as the counts.
      const moneyRange = {
        clinicId,
        start: istDayBoundsUtc(
          start.toISOString().slice(0, 10)
        ).start.toISOString(),
        end: istDayBoundsUtc(end.toISOString().slice(0, 10)).end.toISOString(),
      };

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

      const [[countsRes], money, dues] = await Promise.all([
        countsQuery,
        MoneyReadService.totals(moneyRange),
        MoneyReadService.outstanding(moneyRange),
      ]);

      return {
        earning: money.netPaise / 100,
        totalAppoiment: Number(countsRes?.total || 0),
        pendingAproval: Number(countsRes?.pending || 0),
        noShowCount: Number(countsRes?.noShow || 0),
        activePatent: Number(countsRes?.uniquePatients || 0),
        pendingPayment: dues.duePaise / 100,
        // Already inside the totals above, so the plan card costs no extra money query.
        // Money in only, so the tile never goes negative; refunds are their own figure.
        planReceived: (money.grossBySourcePaise.treatment_plan ?? 0) / 100,
        planRefunded:
          ((money.grossBySourcePaise.treatment_plan ?? 0) -
            (money.bySourcePaise.treatment_plan ?? 0)) /
          100,
        planDue: dues.planDuePaise / 100,
      };
    };

    // Cards show the whole range; deltas compare only the elapsed part with the same part of the last period.
    const isCut = range.compareEnd.getTime() !== currentEnd.getTime();
    const [currentStats, comparedStats, prevStats] = await Promise.all([
      getStatsForRange(currentStart, currentEnd),
      isCut ? getStatsForRange(currentStart, range.compareEnd) : null,
      getStatsForRange(range.prevStart, range.prevEnd),
    ]);
    const nowStats = comparedStats ?? currentStats;

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

    // The Earning card's daily rows from the ledger reader, so the days sum to the card.
    const [[statusCounts], dailyAppointments, dailyEarnings] =
      await Promise.all([
        statusCountsQuery,
        dailyAppointmentsQuery,
        MoneyReadService.byDay({
          clinicId,
          start: istDayBoundsUtc(
            currentStart.toISOString().slice(0, 10)
          ).start.toISOString(),
          end: istDayBoundsUtc(
            currentEnd.toISOString().slice(0, 10)
          ).end.toISOString(),
        }),
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

    for (const [d, paise] of Object.entries(dailyEarnings)) {
      const ref = dayMap.get(d) || {
        earning: 0,
        apptCount: 0,
        noShowCount: 0,
        patientCount: 0,
      };
      ref.earning = paise / 100;
      dayMap.set(d, ref);
    }

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

    const normalizedStart = AppointmentSlotsService.normalizeToDateOnly(
      currentStart.toISOString()
    );
    const normalizedEnd = AppointmentSlotsService.normalizeToDateOnly(
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

    const [collections, topSymptoms, patientOverview] = await extrasPromise;

    return {
      // Shown only when something is non-zero, so clinics without plans see no card.
      treatmentPlans: await DashboardService.treatmentPlanSummary(clinicId, {
        received: currentStats.planReceived,
        refunded: currentStats.planRefunded,
        due: currentStats.planDue,
      }),
      status: {
        totalEarning: {
          amount: currentStats.earning,
          hikePersent: calculateHike(nowStats.earning, prevStats.earning),
        },
        totalAppoiment: {
          count: currentStats.totalAppoiment,
          hikePersent: calculateHike(
            nowStats.totalAppoiment,
            prevStats.totalAppoiment
          ),
        },
        pendingAproval: {
          count: currentStats.pendingAproval,
          hikePersent: calculateHike(
            nowStats.pendingAproval,
            prevStats.pendingAproval
          ),
        },
        noShowCount: {
          count: currentStats.noShowCount,
          hikePersent: calculateHike(
            nowStats.noShowCount,
            prevStats.noShowCount
          ),
        },
        activePatent: {
          count: currentStats.activePatent,
          hikePersent: calculateHike(
            nowStats.activePatent,
            prevStats.activePatent
          ),
        },
        pendingPayment: {
          amount: currentStats.pendingPayment,
          hikePersent: calculateHike(
            nowStats.pendingPayment,
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
      collections,
      topSymptoms: { period: 'this_week', data: topSymptoms },
      patientOverview: patientOverview
        ? { period: 'past_30_days', ...patientOverview }
        : null,
    };
  }

  /** Payments card summary from the Payments History function, so both agree.
   *  Null when the range is older than the plan's payment-history limit. */
  private static async getCollections(
    clinicId: string,
    opts: { startDate?: string; endDate?: string }
  ) {
    // Same rule as enforceDateLimit(PAYMENT_HISTORY_MONTHS) on Payments History.
    const plan = await LimitationService.getClinicActivePlan(clinicId);
    const limit = plan
      ? await LimitationService.getPlanLimit(
          plan.planId,
          FEATURE_KEYS.PAYMENT_HISTORY_MONTHS,
          plan.planVersionId
        )
      : null;
    const retentionMonths =
      limit?.enabled && !limit.isUnlimited ? limit.limitValue : null;
    if (retentionMonths && opts.startDate) {
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - retentionMonths);
      cutoffDate.setHours(0, 0, 0, 0);
      const requested = new Date(opts.startDate);
      if (!isNaN(requested.getTime()) && requested < cutoffDate) return null;
    }

    // Admin view: clinic-wide, the doctor filter applies only to Doctor users.
    const { summary } =
      await AppointmentPaymentsService.getAppointmentPaymentTransactions(
        {
          pageNumber: 1,
          pageSize: 1,
          startDate: opts.startDate,
          endDate: opts.endDate,
        } as GetAppointmentPaymentsDto,
        { userType: 'Admin' },
        clinicId
      );
    return summary;
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
    let range: ReturnType<typeof comparisonRanges>;
    if (opts?.startDate && opts?.endDate) {
      range = comparisonRanges(opts.startDate, opts.endDate);
    } else {
      // Fallback: Full 7 days Mon-Sun of the current IST week
      const today = istDayBoundsUtc().start;
      const diffToMonday = (today.getUTCDay() + 6) % 7;
      today.setUTCDate(today.getUTCDate() - diffToMonday);
      const monday = today.toISOString().split('T')[0];
      today.setUTCDate(today.getUTCDate() + 6);
      range = comparisonRanges(monday, today.toISOString().split('T')[0]);
    }
    const { start: rangeStart, end: rangeEnd } = range;

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

    // Every rupee from the ledger reader (treatment plans included), per IST day and mode.
    const moneyRange = (from: Date, to: Date) => ({
      clinicId,
      start: istDayBoundsUtc(
        from.toISOString().slice(0, 10)
      ).start.toISOString(),
      end: istDayBoundsUtc(to.toISOString().slice(0, 10)).end.toISOString(),
      doctorIds: targetDoctorId ? [targetDoctorId] : undefined,
    });
    const [dayModes, rangeTotals] = await Promise.all([
      MoneyReadService.byDayAndMode(moneyRange(rangeStart, rangeEnd)),
      MoneyReadService.totals(moneyRange(rangeStart, rangeEnd)),
    ]);
    const planRevenue = (rangeTotals.bySourcePaise.treatment_plan ?? 0) / 100;
    const dataMap = new Map<
      string,
      {
        amount: number;
        refundedAmount: number;
        paymentModes: Record<string, number>;
      }
    >();
    for (const p of dayModes) {
      const entry = dataMap.get(p.day) ?? {
        amount: 0,
        refundedAmount: 0,
        paymentModes: {},
      };
      entry.amount += p.netPaise / 100;
      entry.refundedAmount += p.refundsPaise / 100;
      entry.paymentModes[p.mode] =
        (entry.paymentModes[p.mode] ?? 0) + p.netPaise / 100;
      dataMap.set(p.day, entry);
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

    // Same dues as the Outstanding Dues card, from the ledger reader.
    const dues = await MoneyReadService.outstanding(
      moneyRange(rangeStart, rangeEnd)
    );
    const pendingPayments = dues.duePaise / 100;
    const pendingPaymentCount = dues.visits;

    // Today's revenue (subset of totalRevenue for today specifically)
    const todayKey = getISTDateString();
    const todayEntry = dataMap.get(todayKey);
    const todayRevenue = todayEntry?.amount || 0;

    const compareEndKey = range.compareEnd.toISOString().split('T')[0];
    const comparedRevenue = revenueOverview
      .filter((d) => d.date <= compareEndKey)
      .reduce((sum, d) => sum + d.amount, 0);

    const previousRevenue =
      (
        await MoneyReadService.totals(
          moneyRange(range.prevStart, range.prevEnd)
        )
      ).netPaise / 100;

    // Calculate trend
    const trendPercent =
      previousRevenue === 0
        ? 0
        : ((comparedRevenue - previousRevenue) / previousRevenue) * 100;
    const trendDirection = trendPercent > 0 ? '↑' : trendPercent < 0 ? '↓' : '';
    const trend =
      previousRevenue === 0 && comparedRevenue > 0
        ? 'New'
        : trendPercent === 0
          ? '0%'
          : `${trendDirection} ${Math.abs(trendPercent).toFixed(1)}%`;

    const diffTime = Math.abs(rangeEnd.getTime() - rangeStart.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const period = diffDays <= 7 ? 'week' : 'month';
    const comparisonLabel = range.label;

    const result = {
      period,
      totalRevenue,
      totalRefunded,
      // Plan money inside totalRevenue; lets the chart say which date rule it follows.
      planRevenue,
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

  /** Symptom counts for the current Mon–Sun week. Version-keyed: the old
   *  week-long key hid symptoms logged after its first read. */
  private static async getWeekSymptomCounts(clinicId: string) {
    const now = new Date();
    const weekDay = now.getUTCDay();
    const diffMon = weekDay === 0 ? 6 : weekDay - 1;
    const weekStart = new Date(now);
    weekStart.setUTCDate(now.getUTCDate() - diffMon);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
    const weekEndStr = weekEnd.toISOString().split('T')[0];
    const version = await getDashboardCacheVersion(clinicId);

    return getOrSetCache(
      `symptom_counts_week:${clinicId}:v${version}:${weekStartStr}`,
      120,
      async () => {
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

        const symptomCounts: Record<string, number> = {};
        for (const row of symptomRows) {
          symptomCounts[row.symptomName] = Number(row.count || 0);
        }
        return symptomCounts;
      }
    );
  }

  /** New vs returning patients, last 30 days against the 30 before. */
  private static async getPatientOverview(
    clinicId: string,
    targetDoctorId?: string
  ): Promise<{
    newPatients: { count: number; trend: string };
    returningPatients: { count: number; trend: string };
  }> {
    const patientCacheKey = targetDoctorId
      ? `patient_overview:${clinicId}:doctor:${targetDoctorId}`
      : `patient_overview:${clinicId}:all`;

    // 2 min like Reports; 6 hours hid a new patient from the card for most of the day.
    return getOrSetCache(patientCacheKey, 120, async () => {
      const now = new Date();
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

      const [currentStats, prevStats] = await Promise.all([
        patientSplit(clinicId, targetDoctorId, current30Start, current30End),
        patientSplit(clinicId, targetDoctorId, prev30Start, prev30End),
      ]);

      const calcTrend = (current: number, previous: number): string => {
        if (previous === 0) {
          return current > 0 ? 'New' : `0%`;
        }
        const percent = Math.round(((current - previous) / previous) * 100);
        if (percent > 0) return `↑ ${percent}%`;
        if (percent < 0) return `↓ ${Math.abs(percent)}%`;
        return `0%`;
      };

      return {
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
    });
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

    // Money taken today, appointments and plans, from the ledger reader.
    const today = await MoneyReadService.totals({
      clinicId,
      start: todayStart.toISOString(),
      end: todayEnd.toISOString(),
      doctorIds: targetDoctorId ? [targetDoctorId] : undefined,
    });
    const todayRevenue = today.netPaise / 100;
    const todayPaidAppointments = today.payments;

    // Today's pending payments
    const [todayPendingResult] = await database
      .select({
        pendingAmount: sql<string>`COALESCE(SUM(${CLINIC_AMOUNT}), 0)`,
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

    const [symptomCounts, patientOverview] = await Promise.all([
      this.getWeekSymptomCounts(clinicId),
      this.getPatientOverview(clinicId, targetDoctorId ?? undefined),
    ]);

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

        // Collected comes from the ledger, like Admin's Today's Revenue; pending is what visits still owe.
        const moneyDoctors = doctorId ? [doctorId] : allowedDoctorIds;
        const collectedQuery =
          moneyDoctors && !moneyDoctors.length
            ? Promise.resolve({ netPaise: 0, payments: 0 })
            : MoneyReadService.totals({
                clinicId,
                start: todayStart.toISOString(),
                end: todayEnd.toISOString(),
                doctorIds: moneyDoctors ?? undefined,
              });
        const paymentsQuery = database
          .select({
            pendingAmount: sql`COALESCE(SUM(${DUE_AMOUNT}), 0)`,
            pendingCount: sql`COUNT(*) FILTER (WHERE ${DUE_AMOUNT} > 0)::int`,
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

        const [[counts], [payments], collected, newPatientRows, doctorQueues] =
          await Promise.all([
            countsQuery,
            paymentsQuery,
            collectedQuery,
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
            collectedToday: collected.netPaise / 100,
            paidCount: collected.payments,
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
}
