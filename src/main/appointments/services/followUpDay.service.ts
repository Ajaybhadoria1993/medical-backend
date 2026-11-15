import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { CacheKeys, getOrSetCache } from '../../../utils/cache.util';
import { getISTDateString } from '../../../utils/istDateTime';
import { ScheduleShiftService } from '../../appointment-engine/services/scheduleShift.service';
import { ClinicDateAvailability } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { AppointmentModel } from '../models/appointment.model';
import type {
  DoctorDay,
  FollowUpDateCheck,
  ScheduleDayStatus,
} from '../types/followUp.types';
import { addDays, WAITING_STATUSES } from '../utils/followUp.utils';

// The safety net for a schedule write nobody wired; writers clear the doctor's days on commit.
// One hour, the same as the engine's own day_config cache.
const DAY_TTL_SECONDS = 60 * 60;
const NEXT_DAY_SCAN_DAYS = 30;

/** Whether the doctor works a day (leave/off/past); no slot reads, the booking screen shows room left.
 *  No auth here: callers scope the doctor. */
export class FollowUpDayService {
  /** Each IST day from..to, from the cached schedule. */
  static async days(
    clinicId: string,
    doctorId: string,
    from: string,
    to: string
  ): Promise<DoctorDay[]> {
    const today = getISTDateString();
    const days: DoctorDay[] = [];
    // ponytail: sequential reads keep a cold calendar off the DB pool; mget if warm loads get slow.
    for (let date = from; date <= to; date = addDays(date, 1)) {
      days.push({
        date,
        status:
          date < today
            ? 'past'
            : await getOrSetCache(
                CacheKeys.followUpDoctorDay(clinicId, doctorId, date),
                DAY_TTL_SECONDS,
                () => this.scheduleDay(clinicId, doctorId, date)
              ),
      });
    }
    return days;
  }

  /** One picked day: schedule, doctor active, the patient's own booking, and a better day. */
  static async check(
    clinicId: string,
    doctorId: string,
    date: string,
    patientId?: string
  ): Promise<FollowUpDateCheck> {
    const [active, [day], patientBooking] = await Promise.all([
      this.isActive(doctorId),
      this.days(clinicId, doctorId, date, date),
      patientId
        ? this.patientBooking(clinicId, doctorId, patientId)
        : Promise.resolve(null),
    ]);
    if (!active)
      return { date, status: 'inactive', nextGoodDay: null, patientBooking };
    return {
      date,
      status: day.status,
      nextGoodDay:
        day.status === 'ok'
          ? null
          : await this.nextGoodDay(clinicId, doctorId, date),
      patientBooking,
    };
  }

  // The engine's own day resolver decides "works that day"; a date row with no hours is leave.
  private static async scheduleDay(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<ScheduleDayStatus> {
    const day = await ScheduleShiftService.resolveDaySegmentsForTokens(
      database,
      clinicId,
      doctorId,
      date
    );
    if (day) return 'ok';
    const [marked] = await database
      .select({ id: ClinicDateAvailability.id })
      .from(ClinicDateAvailability)
      .where(
        and(
          eq(ClinicDateAvailability.clinicId, clinicId),
          eq(ClinicDateAvailability.doctorId, doctorId),
          eq(ClinicDateAvailability.date, new Date(`${date}T00:00:00Z`))
        )
      )
      .limit(1);
    return marked ? 'leave' : 'off';
  }

  // A past pick starts from today, else the day after; stops at the first working day.
  private static async nextGoodDay(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<string | null> {
    const today = getISTDateString();
    let day = date < today ? today : addDays(date, 1);
    for (let i = 0; i < NEXT_DAY_SCAN_DAYS; i++, day = addDays(day, 1)) {
      const [{ status }] = await this.days(clinicId, doctorId, day, day);
      if (status === 'ok') return day;
    }
    return null;
  }

  private static async isActive(doctorId: string): Promise<boolean> {
    const [row] = await database
      .select({ status: UserModel.userStatus })
      .from(UserModel)
      .where(eq(UserModel.id, doctorId))
      .limit(1);
    return row?.status === 'Active';
  }

  // After today: today's visit is the one the follow-up is being set on.
  private static async patientBooking(
    clinicId: string,
    doctorId: string,
    patientId: string
  ): Promise<FollowUpDateCheck['patientBooking']> {
    const tomorrow = addDays(getISTDateString(), 1);
    const [row] = await database
      .select({
        appointmentId: AppointmentModel.id,
        date: AppointmentModel.appointmentDate,
      })
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.clinicId, clinicId),
          eq(AppointmentModel.doctorId, doctorId),
          eq(AppointmentModel.patientId, patientId),
          gte(
            AppointmentModel.appointmentDate,
            new Date(`${tomorrow}T00:00:00Z`)
          ),
          inArray(AppointmentModel.appointmentStatus, WAITING_STATUSES)
        )
      )
      .orderBy(asc(AppointmentModel.appointmentDate))
      .limit(1);
    return row
      ? { appointmentId: row.appointmentId, date: getISTDateString(row.date) }
      : null;
  }
}
