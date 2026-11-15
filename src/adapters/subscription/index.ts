import { registerClinicPort } from '../../main/subscription';
import { clinicAdapter } from './clinic.adapter';

/** Called once at boot (and by scripts that bill); until then the module's port getters throw. */
export function initSubscriptionPorts(): void {
  registerClinicPort(clinicAdapter);
}
