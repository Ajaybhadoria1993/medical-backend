// src/main/appointments/services/v2/appointment.service.ts
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { ClinicAvailability } from '../../../clinic/models/clinic.model';
import { AppointmentModel } from '../../models/appointment.model';
import {
  getDayNameFromDate,
  hhmmToMinutes,
  minutesToIso,
  normalizeToDateOnly,
} from '../../../../utils/time.util';

export type SimpleSlot = {
  start: string; // ISO-like: YYYY-MM-DDTHH:mm:00
  end: string;
  status: 'available' | 'booked';
};

const ACTIVE_APPOINTMENT_STATUSES = [
  'Confirmed',
  'Patient Arrived',
  'Pending',
  'Rescheduled',
  'Upcoming',
  'Completed',
] as const;

export class AppointmentServiceV2 {
  /**
   * Simplified slot list: fixed-step grid from the doctor's weekly
   * ClinicAvailability for that weekday, minus existing active appointments.
   *
   * Does NOT support token/queue-based clinics, per-date
   * ClinicDateAvailability overrides, doctor breaks, or Redis
   * expired-payment-lock filtering — clinics relying on those features
   * should keep using `AppointmentService.getAvailableSlotsForDate`
   * (v1, `/api/v1/appointments/doctor/available/slot-date-clinic/:doctorId`).
   */
  static async getAvailableSlots(
    clinicId: string,
    doctorId: string,
    rawDate: string
  ): Promise<{ slots: SimpleSlot[] }> {
    return await database.transaction(async (tx) => {
      const dateStr = normalizeToDateOnly(rawDate);
      if (!dateStr) return { slots: [] };

      const startOfDay = new Date(`${dateStr}T00:00:00Z`);
      const nextDay = new Date(startOfDay);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const weekday = getDayNameFromDate(startOfDay);

      const [avail] = await tx
        .select({
          startTime: ClinicAvailability.startTime,
          endTime: ClinicAvailability.endTime,
          slotMinutes: ClinicAvailability.slotMinutes,
        })
        .from(ClinicAvailability)
        .where(
          and(
            eq(ClinicAvailability.clinicId, clinicId),
            eq(ClinicAvailability.doctorId, doctorId),
            sql`lower(${ClinicAvailability.dayOfWeek}) = ${weekday.toLowerCase()}`,
            eq(ClinicAvailability.isAvailable, true)
          )
        )
        .limit(1);

      if (!avail?.startTime || !avail?.endTime) return { slots: [] };

      const startMin = hhmmToMinutes(avail.startTime);
      const endMin = hhmmToMinutes(avail.endTime);
      if (startMin == null || endMin == null || endMin <= startMin) {
        return { slots: [] };
      }
      const slotMinutes = Math.max(1, Number(avail.slotMinutes) || 30);

      const appointments = await tx
        .select({
          appointmentTime: AppointmentModel.appointmentTime,
          appointmentDurationMinutes:
            AppointmentModel.appointmentDurationMinutes,
        })
        .from(AppointmentModel)
        .where(
          and(
            eq(AppointmentModel.clinicId, clinicId),
            eq(AppointmentModel.doctorId, doctorId),
            gte(AppointmentModel.appointmentDate, startOfDay),
            lt(AppointmentModel.appointmentDate, nextDay),
            inArray(AppointmentModel.appointmentStatus, [
              ...ACTIVE_APPOINTMENT_STATUSES,
            ])
          )
        );

      const bookedRanges = appointments
        .map((a) => {
          const s = hhmmToMinutes(a.appointmentTime);
          if (s == null) return null;
          const duration = Math.max(
            1,
            Number(a.appointmentDurationMinutes) || 30
          );
          return { start: s, end: s + duration };
        })
        .filter((r): r is { start: number; end: number } => r !== null);

      const slots: SimpleSlot[] = [];
      for (let s = startMin; s + slotMinutes <= endMin; s += slotMinutes) {
        const e = s + slotMinutes;
        const isBooked = bookedRanges.some((r) => r.start < e && r.end > s);
        slots.push({
          start: minutesToIso(dateStr, s),
          end: minutesToIso(dateStr, e),
          status: isBooked ? 'booked' : 'available',
        });
      }

      return { slots };
    });
  }
}
