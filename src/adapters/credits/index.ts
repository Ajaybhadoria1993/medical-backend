import {
  registerClinicPort,
  registerNotifyPort,
  registerPlanPort,
} from '../../main/credits';
import { clinicAdapter } from './clinic.adapter';
import { notifyAdapter } from './notify.adapter';
import { planAdapter } from './plan.adapter';

/** Called once at boot; until then the module's port getters throw. */
export function initCreditsPorts(): void {
  registerPlanPort(planAdapter);
  registerNotifyPort(notifyAdapter);
  registerClinicPort(clinicAdapter);
}
