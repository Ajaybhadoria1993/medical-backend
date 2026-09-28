import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import {
  AppointmentPaymentModel,
  activeAppointmentFilter,
} from '../../appointments/models/appointment-payment.model';
import { startOfDayIST } from '../../../utils/istDateTime';

/**
 * One doctor's appointments for one IST day, in token order — the single
 * source for both the reception board (QueueService) and the time projection
 * (DelayTrackerService). Two copies of this query drifted once: the
 * projection sorted by time and kept unpaid checkouts the board had dropped.
 */
export async function fetchDoctorDayQueue(
  clinicId: string,
  doctorId: string,
  date: string
) {
  const startOfDay = startOfDayIST(date);
  const nextDay = new Date(startOfDay);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  return (
    database
      .select({
        id: AppointmentModel.id,
        appointmentDate: AppointmentModel.appointmentDate,
        appointmentTime: AppointmentModel.appointmentTime,
        tokenNo: AppointmentModel.tokenNo,
        sessionIndex: AppointmentModel.sessionIndex,
        appointmentStatus: AppointmentModel.appointmentStatus,
        clinicId: AppointmentModel.clinicId,
        patientId: AppointmentModel.patientId,
        doctorId: AppointmentModel.doctorId,
        appointmentDurationMinutes: AppointmentModel.appointmentDurationMinutes,
        lateQueueDemotion: AppointmentModel.lateQueueDemotion,
        arrivedAt: AppointmentModel.arrivedAt,
      })
      .from(AppointmentModel)
      .leftJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .where(
        and(
          eq(AppointmentModel.clinicId, clinicId),
          eq(AppointmentModel.doctorId, doctorId),
          gte(AppointmentModel.appointmentDate, startOfDay),
          lt(AppointmentModel.appointmentDate, nextDay),
          // An online checkout still awaiting payment is not a booking yet.
          activeAppointmentFilter()
        )
      )
      // Session first: numbering restarts per shift, so token order alone
      // interleaves the evening's token 1 with the morning's. Time orders
      // time-based rows, whose session and token are null.
      .orderBy(
        asc(AppointmentModel.sessionIndex),
        asc(AppointmentModel.tokenNo),
        asc(AppointmentModel.appointmentTime)
      )
  );
}
