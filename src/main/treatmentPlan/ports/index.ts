import type {
  AppointmentPort,
  BookingOption,
  PlanAppointment,
} from './appointment.port';
import type { DoctorPort } from './doctor.port';
import type { FilePort } from './file.port';
import type { PatientPort } from './patient.port';
import type { StaffScopePort } from './staffScope.port';

export type {
  AppointmentPort,
  BookingOption,
  DoctorPort,
  FilePort,
  PatientPort,
  PlanAppointment,
  StaffScopePort,
};

let doctor: DoctorPort | null = null;
let patient: PatientPort | null = null;
let appointment: AppointmentPort | null = null;
let staffScope: StaffScopePort | null = null;
let file: FilePort | null = null;

export function registerDoctorPort(impl: DoctorPort): void {
  doctor = impl;
}

export function registerPatientPort(impl: PatientPort): void {
  patient = impl;
}

export function registerAppointmentPort(impl: AppointmentPort): void {
  appointment = impl;
}

export function registerStaffScopePort(impl: StaffScopePort): void {
  staffScope = impl;
}

export function registerFilePort(impl: FilePort): void {
  file = impl;
}

/** Throws rather than guessing: an empty specialty list would hide a wiring bug. */
export function getDoctorPort(): DoctorPort {
  if (!doctor) throw notRegistered('DoctorPort');
  return doctor;
}

export function getPatientPort(): PatientPort {
  if (!patient) throw notRegistered('PatientPort');
  return patient;
}

export function getAppointmentPort(): AppointmentPort {
  if (!appointment) throw notRegistered('AppointmentPort');
  return appointment;
}

/** Throws rather than defaulting to "sees everything", which would leak other doctors' plans. */
export function getStaffScopePort(): StaffScopePort {
  if (!staffScope) throw notRegistered('StaffScopePort');
  return staffScope;
}

const notRegistered = (port: string) =>
  new Error(
    `[TreatmentPlan] ${port} used before registration — call initTreatmentPlanPorts() at boot.`
  );

export function getFilePort(): FilePort {
  if (!file) throw notRegistered('FilePort');
  return file;
}
