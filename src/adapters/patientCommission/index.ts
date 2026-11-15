import {
  registerAppointmentsPort,
  registerClinicPort,
} from '../../main/patientCommission';
import { appointmentsAdapter } from './appointments.adapter';
import { clinicAdapter } from './clinic.adapter';

/** Called once at boot; until then the module's port getters throw. */
export function initPatientCommissionPorts(): void {
  registerAppointmentsPort(appointmentsAdapter);
  registerClinicPort(clinicAdapter);
}
