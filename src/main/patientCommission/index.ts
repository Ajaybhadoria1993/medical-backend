// Public surface of the module: code outside main/patientCommission imports only from here.
export { registerAppointmentsPort, registerClinicPort } from './ports';
export type { AppointmentsPort, ClinicPort } from './ports';
export type {
  BilledAppointment,
  DoctorPatientCount,
} from './types/patientCommission.types';
