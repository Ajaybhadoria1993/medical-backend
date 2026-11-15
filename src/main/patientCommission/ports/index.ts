import type { AppointmentsPort } from './appointments.port';
import type { ClinicPort } from './clinic.port';

export type { AppointmentsPort, ClinicPort };

let appointments: AppointmentsPort | null = null;
let clinic: ClinicPort | null = null;

export function registerAppointmentsPort(impl: AppointmentsPort): void {
  appointments = impl;
}

export function registerClinicPort(impl: ClinicPort): void {
  clinic = impl;
}

/** Throws rather than returning empty counts: a silent zero bill would hide a wiring bug. */
export function getAppointmentsPort(): AppointmentsPort {
  if (!appointments) throw notRegistered('AppointmentsPort');
  return appointments;
}

export function getClinicPort(): ClinicPort {
  if (!clinic) throw notRegistered('ClinicPort');
  return clinic;
}

const notRegistered = (port: string) =>
  new Error(
    `[PatientCommission] ${port} used before registration — call initPatientCommissionPorts() at boot.`
  );
