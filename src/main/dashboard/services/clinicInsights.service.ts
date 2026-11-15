import { and, between, eq, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { getISTDateString, istDayBoundsUtc } from '../../../utils/istDateTime';
import type { ClinicInsights } from '../types/clinicInsights.types';
import {
  fillDuesBrackets,
  fillFollowUpGroups,
  orderBusiestDays,
  rankDoctors,
  topBusiestHours,
} from '../utils/clinicInsights.utils';
import { MoneyReadService } from '../../money';
import { DUE_AMOUNT } from '../utils/revenueSql';
import { knownTimeOfDay } from '../../reportsOverview/utils/reportsTrend.utils';

// Four full weeks: every weekday occurs exactly 4 times, so day totals compare fairly (30 days gives two weekdays a 5th).
const BUSIEST_WINDOW_DAYS = 28;

/** Money still owed. Shared with the Pending Payments stat so the two can't disagree. */
export const UNPAID_PAYMENT = sql`LOWER(COALESCE(${AppointmentPaymentModel.paymentStatus}, '')) IN ('pending', 'credit', 'partly paid')`;

/** The patient never attended, so nothing is owed and it isn't a visit. */
export const NOT_ATTENDED = sql`${AppointmentModel.appointmentStatus} IN ('Cancelled', 'NoShow', 'Missed')`;

const shiftYmd = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
};

export class ClinicInsightsService {
  static async getInsights(
    clinicId: string,
    opts: { startDate?: string; endDate?: string }
  ): Promise<ClinicInsights> {
    const today = getISTDateString();
    // appointment_date is stored at midnight UTC, so UTC day bounds select the right days.
    const start = new Date(`${opts.startDate ?? today}T00:00:00.000Z`);
    const end = new Date(`${opts.endDate ?? today}T23:59:59.999Z`);

    const [
      hasAppointments,
      doctorRows,
      outstandingDues,
      busiestHours,
      busiestDays,
      followUp,
    ] = await Promise.all([
      this.hasAppointments(clinicId),
      this.getDoctorRows(clinicId, start, end),
      this.getOutstandingDues(clinicId, today),
      this.getBusiestHours(clinicId, today),
      this.getBusiestDays(clinicId, today),
      this.getFollowUp(clinicId, today),
    ]);

    return {
      doctorCount: doctorRows.length,
      hasAppointments,
      doctorPerformance: rankDoctors(doctorRows),
      outstandingDues,
      busiestHours,
      busiestDays,
      followUp,
    };
  }

  private static async hasAppointments(clinicId: string) {
    const rows = await database
      .select({ id: AppointmentModel.id })
      .from(AppointmentModel)
      .where(eq(AppointmentModel.clinicId, clinicId))
      .limit(1);
    return rows.length > 0;
  }

  /** Every doctor still assigned here who has ever had an appointment, idle ones included. */
  private static async getDoctorRows(clinicId: string, start: Date, end: Date) {
    const inRange = between(AppointmentModel.appointmentDate, start, end);

    const rows = await database
      .select({
        doctorId: AppointmentModel.doctorId,
        doctor: UserModel.name,
        appointments: sql<number>`COUNT(DISTINCT ${AppointmentModel.id}) FILTER (WHERE ${inRange})::int`,
        completed: sql<number>`COUNT(DISTINCT ${AppointmentModel.id}) FILTER (WHERE ${inRange} AND ${AppointmentModel.appointmentStatus} = 'Completed')::int`,
      })
      .from(AppointmentModel)
      .innerJoin(UserModel, eq(UserModel.id, AppointmentModel.doctorId))
      .where(
        and(
          eq(AppointmentModel.clinicId, clinicId),
          sql`EXISTS (
            SELECT 1 FROM ${ClinicAssignModel}
            WHERE ${ClinicAssignModel.clinicId} = ${clinicId}
              AND ${ClinicAssignModel.userId} = ${AppointmentModel.doctorId}
          )`
        )
      )
      .groupBy(AppointmentModel.doctorId, UserModel.name);

    // Revenue from the ledger reader, so doctor rows sum to Total Revenue and Payments History.
    const revenue = await MoneyReadService.byDoctor({
      clinicId,
      start: istDayBoundsUtc(
        start.toISOString().slice(0, 10)
      ).start.toISOString(),
      end: istDayBoundsUtc(end.toISOString().slice(0, 10)).end.toISOString(),
    });
    return rows
      .filter((r): r is typeof r & { doctorId: string } => Boolean(r.doctorId))
      .map((r) => ({
        ...r,
        doctorId: r.doctorId,
        revenue: String((revenue[r.doctorId] ?? 0) / 100),
      }));
  }

  /** Any date. A past appointment, or one already completed today, can owe money. */
  private static async getOutstandingDues(clinicId: string, today: string) {
    const rows = (await database.execute(sql`
      SELECT
        CASE
          WHEN ${today}::date - ${AppointmentModel.appointmentDate}::date <= 30 THEN '0-30'
          WHEN ${today}::date - ${AppointmentModel.appointmentDate}::date <= 60 THEN '31-60'
          WHEN ${today}::date - ${AppointmentModel.appointmentDate}::date <= 90 THEN '61-90'
          ELSE '90+'
        END AS bracket,
        COALESCE(SUM(${DUE_AMOUNT}), 0) AS amount,
        COUNT(DISTINCT ${AppointmentModel.id}) AS count
      FROM ${AppointmentModel}
      INNER JOIN ${AppointmentPaymentModel}
        ON ${AppointmentPaymentModel.appointmentId} = ${AppointmentModel.id}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${UNPAID_PAYMENT}
        AND NOT ${NOT_ATTENDED}
        AND (
          ${AppointmentModel.appointmentDate}::date < ${today}::date
          OR ${AppointmentModel.appointmentStatus} = 'Completed'
        )
      GROUP BY bracket
    `)) as unknown as { bracket: string; amount: string; count: string }[];

    return fillDuesBrackets(rows);
  }

  /** Same rule as Reports: check-in time, else the booked slot; `bucketRowsByHour` drops the token
   *  '23:59' placeholder of a token not yet checked in. Visits that didn't happen are left out. */
  private static async getBusiestHours(clinicId: string, today: string) {
    const from = shiftYmd(today, -(BUSIEST_WINDOW_DAYS - 1));
    const rows = (await database.execute(sql`
      SELECT ${knownTimeOfDay} AS time, COUNT(*) AS cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate}::date BETWEEN ${from}::date AND ${today}::date
        AND NOT ${NOT_ATTENDED}
      GROUP BY 1
    `)) as unknown as { time: string | null; cnt: string }[];

    return topBusiestHours(rows);
  }

  private static async getBusiestDays(clinicId: string, today: string) {
    const from = shiftYmd(today, -(BUSIEST_WINDOW_DAYS - 1));
    const rows = (await database.execute(sql`
      SELECT EXTRACT(DOW FROM ${AppointmentModel.appointmentDate}) AS dow, COUNT(*) AS cnt
      FROM ${AppointmentModel}
      WHERE ${AppointmentModel.clinicId} = ${clinicId}
        AND ${AppointmentModel.appointmentDate}::date BETWEEN ${from}::date AND ${today}::date
        AND NOT ${NOT_ATTENDED}
      GROUP BY dow
    `)) as unknown as { dow: string; cnt: string }[];

    return orderBusiestDays(rows);
  }

  /** Last completed visit only; a patient already booked again needs no follow-up. */
  private static async getFollowUp(clinicId: string, today: string) {
    const rows = (await database.execute(sql`
      SELECT
        CASE
          WHEN gap <= 30 THEN 'within30'
          WHEN gap <= 90 THEN '31-90'
          WHEN gap <= 180 THEN '91-180'
          ELSE '180+'
        END AS grp,
        COUNT(*) AS patients
      FROM (
        SELECT
          ${today}::date - MAX(${AppointmentModel.appointmentDate}::date)
            FILTER (WHERE ${AppointmentModel.appointmentStatus} = 'Completed') AS gap,
          BOOL_OR(
            ${AppointmentModel.appointmentDate}::date >= ${today}::date
            AND NOT ${NOT_ATTENDED}
            AND ${AppointmentModel.appointmentStatus} <> 'Completed'
          ) AS has_upcoming
        FROM ${AppointmentModel}
        WHERE ${AppointmentModel.clinicId} = ${clinicId}
        GROUP BY ${AppointmentModel.patientId}
      ) visits
      WHERE gap IS NOT NULL AND NOT has_upcoming
      GROUP BY grp
    `)) as unknown as { grp: string; patients: string }[];

    return fillFollowUpGroups(
      rows.map((r) => ({ group: r.grp, patients: r.patients }))
    );
  }
}
