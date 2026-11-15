import {
  registerAppointmentPort,
  registerDoctorPort,
  registerFilePort,
  registerPatientPort,
  registerStaffScopePort,
} from '../../main/treatmentPlan';
import { appointmentAdapter } from './appointment.adapter';
import { doctorAdapter } from './doctor.adapter';
import { fileAdapter } from './file.adapter';
import { patientAdapter } from './patient.adapter';
import { staffScopeAdapter } from './staffScope.adapter';

/** Called once at boot; until then the module's port getters throw. */
export function initTreatmentPlanPorts(): void {
  registerDoctorPort(doctorAdapter);
  registerPatientPort(patientAdapter);
  registerAppointmentPort(appointmentAdapter);
  registerStaffScopePort(staffScopeAdapter);
  registerFilePort(fileAdapter);
}
