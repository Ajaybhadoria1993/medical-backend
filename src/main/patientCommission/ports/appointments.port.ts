import type {
  BilledAppointment,
  DoctorPatientCount,
} from '../types/patientCommission.types';

/** The appointment data a bill is made from; read only. */
export interface AppointmentsPort {
  /** Billable appointments per doctor from `startDate` up to (not including) `nextStartDate`, with the clinic's doctors who have none. */
  countByDoctor(
    clinicId: string,
    startDate: string,
    nextStartDate: string
  ): Promise<DoctorPatientCount[]>;
  /** One doctor's billable appointments in the same range, newest first, with the total before paging. */
  listForDoctor(
    clinicId: string,
    doctorId: string,
    startDate: string,
    nextStartDate: string,
    limit: number,
    offset: number
  ): Promise<{ total: number; items: BilledAppointment[] }>;
  /** The doctor's name, or null when they are not a doctor of this clinic. */
  getDoctorName(clinicId: string, doctorId: string): Promise<string | null>;
}
