import { and, asc, eq, gte, inArray, lt, or } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { AuthUser } from '../../../middlewear/auth.middleware';
import { HttpError } from '../../../middlewear/errorHandler';
import { getISTDateString } from '../../../utils/istDateTime';
import logger from '../../../utils/logger';
import { notifyAppointmentCanceled } from '../../../utils/notificationHelpers';
import { CancellationPolicyService } from '../../cancellation-policy/services/cancellationPolicy.service';
import { AvailableSlotsService } from '../../appointment-engine/services/availableSlots.service';
import { ScheduleShiftService } from '../../appointment-engine/services/scheduleShift.service';
import { TokenSessionService } from '../../appointment-engine/services/tokenSession.service';
import { UserModel } from '../../users/models/user.model';
import { AppointmentModel } from '../models/appointment.model';
import type { LeaveMoveDto } from '../schemas/appointment.schemas';
import { AppointmentService } from './appointment.service';
import { MoveToTodayService } from './moveToToday.service';

// Visits still waiting; Patient Arrived and finished ones stay where they are.
const LEAVE_MOVABLE_STATUSES = [
  'Upcoming',
  'Pending',
  'Rescheduled',
  'Confirmed',
] as const;
const MAX_DAYS_AHEAD = 30;

type Appointment = typeof AppointmentModel.$inferSelect;

const addDays = (date: string, days: number) => {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export class LeaveMoveService {
  static async preview(clinicId: string, doctorId: string, dates: string[]) {
    this.assertLeaveDates(dates);
    const rows = await this.findBooked(clinicId, doctorId, dates);
    return {
      count: rows.length,
      appointments: rows.map(({ appointment: a, patientName }) => ({
        id: a.id,
        patientName,
        date: getISTDateString(new Date(a.appointmentDate)),
        tokenNo: a.tokenNo,
        sessionIndex: a.sessionIndex,
        appointmentTime: a.appointmentTime,
        appointmentStatus: a.appointmentStatus,
      })),
      nextWorkingDay: await this.nextWorkingDay(clinicId, doctorId, dates),
    };
  }

  static async move(clinicId: string, user: AuthUser, body: LeaveMoveDto) {
    const { dates, targetDate } = body;
    this.assertLeaveDates(dates);
    const today = getISTDateString();
    if (
      targetDate <= today ||
      targetDate > addDays(today, MAX_DAYS_AHEAD) ||
      dates.includes(targetDate)
    ) {
      throw new HttpError(
        400,
        `Pick a date from tomorrow to ${MAX_DAYS_AHEAD} days ahead, not a leave day`
      );
    }
    const day = await ScheduleShiftService.resolveDaySegmentsForTokens(
      database,
      clinicId,
      user.id,
      targetDate
    );
    if (!day) throw new HttpError(400, "The doctor doesn't work on that date");

    const rows = await this.findBooked(clinicId, user.id, dates);
    const takenBySession = new Map<number, Set<number>>();
    const usedTimes = new Set<string>();
    let freeTimes: string[] | null = null;
    let moved = 0;
    const failed: { id: string; reason: string }[] = [];

    // One by one in queue order, so each visit sees the ones placed before it.
    for (const { appointment } of rows) {
      try {
        const update: Record<string, unknown> = {
          appointmentDate: targetDate,
          reasionForReSchedule: body.reason || 'Doctor on leave',
          // Confirm only works on today, so a moved visit waits again.
          ...(appointment.appointmentStatus === 'Confirmed'
            ? { appointmentStatus: 'Upcoming' }
            : {}),
        };

        if (appointment.tokenNo !== null) {
          // Same shift number; a day with fewer shifts takes its last one.
          const requested = Math.min(
            appointment.sessionIndex ?? 1,
            day.segments.length
          );
          const session = await TokenSessionService.resolve(
            database,
            clinicId,
            user.id,
            targetDate,
            requested
          );
          let taken = takenBySession.get(session.sessionIndex);
          if (!taken) {
            taken = await MoveToTodayService.takenTokens(
              appointment,
              session.sessionIndex,
              targetDate
            );
            takenBySession.set(session.sessionIndex, taken);
          }
          // Never blocked: same token if free, else the lowest free, past capacity too.
          const tokenNo = taken.has(appointment.tokenNo)
            ? MoveToTodayService.lowestFree(taken)
            : appointment.tokenNo;
          update.tokenNo = tokenNo;
          update.sessionIndex = session.sessionIndex;
          taken.add(tokenNo);
        } else {
          freeTimes ??= MoveToTodayService.freeTimes(
            await AvailableSlotsService.getAvailableSlots(
              clinicId,
              user.id,
              targetDate
            )
          );
          const time = this.pickTime(
            appointment,
            freeTimes.filter((t) => !usedTimes.has(t))
          );
          update.appointmentTime = time;
          usedTimes.add(time);
        }

        await AppointmentService.updateAppointment(
          appointment.id,
          update as never,
          user.id,
          user.userType
        );
        moved += 1;
      } catch (error) {
        failed.push({
          id: appointment.id,
          reason: error instanceof HttpError ? error.message : 'Could not move',
        });
      }
    }

    return { moved, failed };
  }

  // Cancels instead of moving: the staff cancel path (policy, refund, queue), then the patient is told.
  static async cancel(clinicId: string, user: AuthUser, dates: string[]) {
    this.assertLeaveDates(dates);
    const rows = await this.findBooked(clinicId, user.id, dates);
    const performerName = await this.nameOf(user.id);
    let cancelled = 0;
    const failed: { id: string; reason: string }[] = [];

    for (const { appointment } of rows) {
      try {
        // Acts as the visit's own doctor, so the clinic's doctor-cancel rule applies, Admin or not.
        await CancellationPolicyService.processCancellationRequest(
          appointment.id,
          user.id,
          'Doctor',
          { reasonCode: 'doctor_leave' },
          clinicId
        );
        cancelled += 1;
        void notifyAppointmentCanceled(
          clinicId,
          appointment.id,
          user.id,
          performerName,
          'Doctor',
          appointment.doctorId ?? undefined,
          appointment.patientId
        ).catch((error) =>
          logger.error('Leave cancel notification failed', error)
        );
      } catch (error) {
        failed.push({
          id: appointment.id,
          reason:
            error instanceof HttpError ? error.message : 'Could not cancel',
        });
      }
    }

    return { cancelled, failed };
  }

  // Same time if free, else the next free one, else the earliest; none free keeps it overbooked.
  private static pickTime(appointment: Appointment, free: string[]) {
    const current = appointment.appointmentTime?.slice(0, 5) ?? '';
    return free.find((t) => t >= current) ?? free[0] ?? current;
  }

  private static async nameOf(userId: string) {
    const [row] = await database
      .select({ name: UserModel.name })
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);
    return row?.name ?? 'The doctor';
  }

  private static assertLeaveDates(dates: string[]) {
    if (dates.some((d) => d < getISTDateString())) {
      throw new HttpError(400, 'Leave dates cannot be in the past');
    }
  }

  private static async findBooked(
    clinicId: string,
    doctorId: string,
    dates: string[]
  ) {
    return database
      .select({ appointment: AppointmentModel, patientName: UserModel.name })
      .from(AppointmentModel)
      .innerJoin(UserModel, eq(UserModel.id, AppointmentModel.patientId))
      .where(
        and(
          eq(AppointmentModel.clinicId, clinicId),
          eq(AppointmentModel.doctorId, doctorId),
          inArray(AppointmentModel.appointmentStatus, LEAVE_MOVABLE_STATUSES),
          or(
            ...dates.map((d) =>
              and(
                gte(AppointmentModel.appointmentDate, new Date(d)),
                lt(AppointmentModel.appointmentDate, new Date(addDays(d, 1)))
              )
            )
          )
        )
      )
      .orderBy(
        asc(AppointmentModel.appointmentDate),
        asc(AppointmentModel.sessionIndex),
        asc(AppointmentModel.tokenNo),
        asc(AppointmentModel.appointmentTime)
      );
  }

  // First day after the leave, within 30 days, that the doctor works.
  private static async nextWorkingDay(
    clinicId: string,
    doctorId: string,
    dates: string[]
  ) {
    const today = getISTDateString();
    const last = addDays(today, MAX_DAYS_AHEAD);
    const latest = [...dates].sort().reverse()[0];
    for (
      let d = addDays(latest > today ? latest : today, 1);
      d <= last;
      d = addDays(d, 1)
    ) {
      if (dates.includes(d)) continue;
      const day = await ScheduleShiftService.resolveDaySegmentsForTokens(
        database,
        clinicId,
        doctorId,
        d
      );
      if (day) return d;
    }
    return null;
  }
}
