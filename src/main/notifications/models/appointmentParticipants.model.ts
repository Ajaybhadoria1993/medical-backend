import { alias } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { UserModel } from '../../users/models/user.model';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { ClinicSettingsModel } from '../../clinic/models/clinicSettings.model';
import { resolvePatientMobile } from '../../patient/services/patientMobile.service';

export const DOCTOR_NAME_FALLBACK = 'your doctor';
export const PATIENT_NAME_FALLBACK = 'there';

export interface AppointmentParticipants {
  patientName: string;
  doctorName: string;
}

export function formatDoctorName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) return DOCTOR_NAME_FALLBACK;
  return /^dr\.?\s/i.test(trimmed) ? trimmed : `Dr. ${trimmed}`;
}

/**
 * Resolved at send time rather than passed down from the caller: the reminder
 * queue fires hours or days after scheduling, by which point the appointment
 * may have been reassigned to a different doctor.
 *
 * Left-joined on the doctor because `appointments.doctor_id` is nullable — an
 * unassigned appointment must still send, falling back to a generic phrase.
 */
export interface NotificationContext extends AppointmentParticipants {
  patientMobile: string | null;
  clinicName: string | null;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
}

/**
 * Everything a patient-facing appointment message needs, in one round trip.
 * The caller previously issued four separate queries (patient mobile, clinic
 * name, clinic settings, participants) all keyed off the same appointment.
 */
export async function getNotificationContext(
  appointmentId: string
): Promise<NotificationContext | null> {
  const doctor = alias(UserModel, 'doctor');
  const patient = alias(UserModel, 'patient');

  const [row] = await database
    .select({
      patientId: AppointmentModel.patientId,
      doctorName: doctor.name,
      patientName: patient.name,
      patientMobile: patient.mobile,
      clinicName: ClinicModel.clinicName,
      smsEnabled: ClinicSettingsModel.smsEnabled,
      whatsappEnabled: ClinicSettingsModel.whatsappEnabled,
    })
    .from(AppointmentModel)
    .leftJoin(doctor, eq(doctor.id, AppointmentModel.doctorId))
    .leftJoin(patient, eq(patient.id, AppointmentModel.patientId))
    .leftJoin(ClinicModel, eq(ClinicModel.id, AppointmentModel.clinicId))
    .leftJoin(
      ClinicSettingsModel,
      eq(ClinicSettingsModel.clinicId, AppointmentModel.clinicId)
    )
    .where(eq(AppointmentModel.id, appointmentId))
    .limit(1);

  if (!row) return null;

  const patientMobile = row.patientId
    ? await resolvePatientMobile(row.patientId, row.patientMobile)
    : row.patientMobile;

  return {
    doctorName: formatDoctorName(row.doctorName),
    patientName: row.patientName?.trim() || PATIENT_NAME_FALLBACK,
    patientMobile,
    clinicName: row.clinicName,
    smsEnabled: row.smsEnabled ?? false,
    whatsappEnabled: row.whatsappEnabled ?? false,
  };
}

export async function getAppointmentParticipants(
  appointmentId: string
): Promise<AppointmentParticipants> {
  const doctor = alias(UserModel, 'doctor');
  const patient = alias(UserModel, 'patient');

  const [row] = await database
    .select({ doctorName: doctor.name, patientName: patient.name })
    .from(AppointmentModel)
    .leftJoin(doctor, eq(doctor.id, AppointmentModel.doctorId))
    .leftJoin(patient, eq(patient.id, AppointmentModel.patientId))
    .where(eq(AppointmentModel.id, appointmentId))
    .limit(1);

  return {
    doctorName: formatDoctorName(row?.doctorName),
    patientName: row?.patientName?.trim() || PATIENT_NAME_FALLBACK,
  };
}
