import { and, eq, gte, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { AuthUser } from '../../../middlewear/auth.middleware';
import { HttpError } from '../../../middlewear/errorHandler';
import { getISTDateString, getISTTimeString } from '../../../utils/istDateTime';
import { AvailableSlotsService } from '../../appointment-engine/services/availableSlots.service';
import { DoctorArrivalService } from '../../appointment-engine/services/doctorArrival.service';
import { TokenSessionService } from '../../appointment-engine/services/tokenSession.service';
import { PermissionService } from '../../permissions/services/permission.service';
import { PERMISSION_KEYS } from '../../permissions/utils/permission.constants';
import { AppointmentModel } from '../models/appointment.model';
import { APPOINTMENT_TYPE_TREATMENT } from '../utils/appointmentType.constants';
import type { MoveToTodayDto } from '../schemas/appointment.schemas';
import { AppointmentService } from './appointment.service';

const MOVABLE_STATUSES = ['Upcoming', 'Pending', 'Rescheduled', 'NoShow'];
// Statuses that hold a token or slot; mirrors updateAppointment's clash check.
const HOLDING_STATUSES = [
  'Upcoming',
  'Confirmed',
  'Patient Arrived',
  'Pending',
  'Rescheduled',
  'Completed',
] as const;

type Appointment = typeof AppointmentModel.$inferSelect;

// One IST day as a [start, end) range of stored appointment dates.
const dayRange = (date: string) => {
  const start = new Date(date);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
};

export class MoveToTodayService {
  static async preview(appointmentId: string, clinicId: string) {
    const appointment = await this.load(appointmentId, clinicId);
    const reason = await this.blocker(appointment, clinicId);
    if (reason) return { canMove: false, reason };

    const today = getISTDateString();
    const isToken = appointment.tokenNo !== null;
    const [available, sameDayWarning] = await Promise.all([
      AvailableSlotsService.getAvailableSlots(
        clinicId,
        appointment.doctorId!,
        today
      ),
      this.hasSameDayAppointment(appointment),
    ]);

    let suggested: {
      tokenNo?: number;
      sessionIndex?: number;
      appointmentTime?: string | null;
    };
    if (isToken) {
      const session = await TokenSessionService.resolve(
        database,
        clinicId,
        appointment.doctorId!,
        today
      );
      suggested = {
        sessionIndex: session.sessionIndex,
        tokenNo: this.lowestFree(
          await this.takenTokens(appointment, session.sessionIndex)
        ),
      };
    } else {
      suggested = { appointmentTime: this.firstFreeTimeAfterNow(available) };
    }

    return {
      canMove: true,
      mode: isToken ? ('token' as const) : ('slot' as const),
      suggested,
      sameDayWarning,
      slots: available.slots,
    };
  }

  static async move(
    appointmentId: string,
    clinicId: string,
    user: AuthUser,
    body: MoveToTodayDto
  ) {
    const appointment = await this.load(appointmentId, clinicId);
    const reason = await this.blocker(appointment, clinicId);
    if (reason) throw new HttpError(409, reason);

    const today = getISTDateString();
    const update: Record<string, unknown> = {
      appointmentDate: today,
      reasionForReSchedule: body.reason || 'Moved to today',
      // A no-show brought back is expected again, not still absent.
      ...(appointment.appointmentStatus === 'NoShow'
        ? { appointmentStatus: 'Upcoming' }
        : {}),
    };

    if (appointment.tokenNo !== null) {
      const session = await TokenSessionService.resolve(
        database,
        clinicId,
        appointment.doctorId!,
        today,
        body.sessionIndex ?? null
      );
      // Never blocked: a taken or missing token falls to the next free one in this shift.
      const taken = await this.takenTokens(appointment, session.sessionIndex);
      update.tokenNo =
        body.tokenNo && !taken.has(body.tokenNo)
          ? body.tokenNo
          : this.lowestFree(taken);
      update.sessionIndex = session.sessionIndex;
    } else {
      const available = await AvailableSlotsService.getAvailableSlots(
        clinicId,
        appointment.doctorId!,
        today
      );
      const time =
        body.appointmentTime ?? this.firstFreeTimeAfterNow(available);
      if (!time) {
        throw new HttpError(409, 'No free slot left today. Pick a time.');
      }
      // A time the schedule does not offer is a custom booking and needs that right.
      if (!this.freeTimes(available).includes(time)) {
        const allowed = await PermissionService.hasPermission(
          user.id,
          user.userType,
          clinicId,
          PERMISSION_KEYS.APPOINTMENT_CUSTOM_SLOT
        );
        if (!allowed) {
          throw new HttpError(
            403,
            'This time is outside the doctor’s free slots. You need the custom slot permission.'
          );
        }
      }
      update.appointmentTime = time;
    }

    return AppointmentService.updateAppointment(
      appointmentId,
      update as never,
      user.id,
      user.userType
    );
  }

  private static async load(appointmentId: string, clinicId: string) {
    const [appointment] = await database
      .select()
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.id, appointmentId),
          eq(AppointmentModel.clinicId, clinicId)
        )
      )
      .limit(1);
    if (!appointment || !appointment.doctorId) {
      throw new HttpError(404, 'Appointment not found');
    }
    return appointment;
  }

  // The reason a move is refused, or null when it is allowed.
  private static async blocker(appointment: Appointment, clinicId: string) {
    if (
      getISTDateString(new Date(appointment.appointmentDate)) ===
      getISTDateString()
    ) {
      return 'This appointment is already today';
    }
    if (!MOVABLE_STATUSES.includes(appointment.appointmentStatus)) {
      return `A ${appointment.appointmentStatus} appointment can't be moved`;
    }
    // A plan session on a day the patient already visits doubles up and breaks the plan's gaps; other visits only warn.
    if (
      appointment.appointmentType === APPOINTMENT_TYPE_TREATMENT &&
      (await this.hasSameDayAppointment(appointment))
    ) {
      return 'Patient already has a visit today. Use that visit for the session instead';
    }
    const { arrivals } = await DoctorArrivalService.getActiveForClinic(
      clinicId,
      [appointment.doctorId!],
      true
    );
    return arrivals.length ? null : "The doctor hasn't started today yet";
  }

  private static async hasSameDayAppointment(appointment: Appointment) {
    const { start, end } = dayRange(getISTDateString());
    const [row] = await database
      .select({ id: AppointmentModel.id })
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.patientId, appointment.patientId),
          eq(AppointmentModel.doctorId, appointment.doctorId!),
          eq(AppointmentModel.clinicId, appointment.clinicId),
          ne(AppointmentModel.id, appointment.id),
          gte(AppointmentModel.appointmentDate, start),
          lt(AppointmentModel.appointmentDate, end),
          inArray(AppointmentModel.appointmentStatus, HOLDING_STATUSES)
        )
      )
      .limit(1);
    return Boolean(row);
  }

  // Shared with LeaveMoveService, which places on a date other than today.
  static async takenTokens(
    appointment: Appointment,
    sessionIndex: number,
    date = getISTDateString()
  ) {
    const { start, end } = dayRange(date);
    const rows = await database
      .select({ tokenNo: AppointmentModel.tokenNo })
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.clinicId, appointment.clinicId),
          eq(AppointmentModel.doctorId, appointment.doctorId!),
          ne(AppointmentModel.id, appointment.id),
          gte(AppointmentModel.appointmentDate, start),
          lt(AppointmentModel.appointmentDate, end),
          // Session 1 also owns rows written before sessions existed.
          sessionIndex === 1
            ? or(
                eq(AppointmentModel.sessionIndex, 1),
                isNull(AppointmentModel.sessionIndex)
              )
            : eq(AppointmentModel.sessionIndex, sessionIndex),
          inArray(AppointmentModel.appointmentStatus, HOLDING_STATUSES)
        )
      );
    return new Set(rows.map((r) => Number(r.tokenNo)));
  }

  // Lowest free number, so a cancelled token is reissued rather than skipped.
  static lowestFree(taken: Set<number>) {
    let candidate = 1;
    while (taken.has(candidate)) candidate += 1;
    return candidate;
  }

  static freeTimes(
    available: Awaited<
      ReturnType<typeof AvailableSlotsService.getAvailableSlots>
    >
  ) {
    return available.slots
      .filter((s) => s.status === 'available')
      .map((s) => s.start.split('T')[1]?.slice(0, 5))
      .filter((t): t is string => Boolean(t));
  }

  private static firstFreeTimeAfterNow(
    available: Awaited<
      ReturnType<typeof AvailableSlotsService.getAvailableSlots>
    >
  ) {
    const now = getISTTimeString();
    return this.freeTimes(available).find((t) => t >= now) ?? null;
  }
}
