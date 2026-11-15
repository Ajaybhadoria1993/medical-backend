import { registerDirectoryPort } from '../../main/referral';
import { directoryAdapter } from './directory.adapter';

/** Called once at boot; until then the module's port getters throw. */
export function initReferralPorts(): void {
  registerDirectoryPort(directoryAdapter);
}
