import {
  registerAccountPort,
  registerFilePort,
} from '../../main/supportAccess';
import { accountAdapter } from './account.adapter';
import { fileAdapter } from './file.adapter';

/** Called once at boot; until then the module's port getters throw. */
export function initSupportAccessPorts(): void {
  registerAccountPort(accountAdapter);
  registerFilePort(fileAdapter);
}
