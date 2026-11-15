import {
  registerSourceDataPort,
  registerWhatsAppMessagesPort,
  registerPlatformFeesPort,
} from '../../main/superadminAnalytics';
import { sourceDataAdapter } from './sourceData.adapter';
import { whatsappMessagesAdapter } from './whatsappMessages.adapter';
import { platformFeesAdapter } from './platformFees.adapter';

/** Called once at boot; until then the module's port getters throw. */
export function initSuperadminAnalyticsPorts(): void {
  registerSourceDataPort(sourceDataAdapter);
  registerWhatsAppMessagesPort(whatsappMessagesAdapter);
  registerPlatformFeesPort(platformFeesAdapter);
}
