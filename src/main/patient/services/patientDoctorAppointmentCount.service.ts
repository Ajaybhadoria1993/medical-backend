import { and, countDistinct, eq, inArray, or } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import { buildActiveAppointmentFilter } from '../../appointments/services/appointment.service';
import { PatientFamilyLinksModel } from '../models/patientFamilyLinks.model';

/** Per-doctor appointment count for the patient + family, one grouped query.
 *  Same visibility rule as the appointment list, so it matches what the button opens. */
export async function getAppointmentCountsByDoctor(
  userId: string,
  doctorIds: string[]
): Promise<Map<string, number>> {
  const uniqueDoctorIds = [...new Set(doctorIds)];
  if (uniqueDoctorIds.length === 0) return new Map();

  const linkedPatientIds = database
    .select({ id: PatientFamilyLinksModel.linkedPatientId })
    .from(PatientFamilyLinksModel)
    .where(eq(PatientFamilyLinksModel.primaryPatientId, userId));

  const rows = await database
    .select({
      doctorId: AppointmentModel.doctorId,
      total: countDistinct(AppointmentModel.id),
    })
    .from(AppointmentModel)
    .leftJoin(
      AppointmentPaymentModel,
      eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
    )
    .where(
      and(
        inArray(AppointmentModel.doctorId, uniqueDoctorIds),
        or(
          eq(AppointmentModel.patientId, userId),
          inArray(AppointmentModel.patientId, linkedPatientIds)
        ),
        buildActiveAppointmentFilter()
      )
    )
    .groupBy(AppointmentModel.doctorId);

  const counts = new Map<string, number>();
  for (const { doctorId, total } of rows) {
    if (doctorId) counts.set(doctorId, total);
  }
  return counts;
}

/** Adds `appointmentCount` (0 when none) to each item; one query for the whole list. */
export async function withAppointmentCounts<T>(
  userId: string,
  items: T[],
  getDoctorId: (item: T) => string
): Promise<Array<T & { appointmentCount: number }>> {
  const counts = await getAppointmentCountsByDoctor(
    userId,
    items.map(getDoctorId)
  );
  return items.map((item) => ({
    ...item,
    appointmentCount: counts.get(getDoctorId(item)) ?? 0,
  }));
}
