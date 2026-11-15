import type { WhatsAppMessagesPort } from '../../main/superadminAnalytics';
import { WhatsAppMessagePrefsService } from '../../main/notifications/services/whatsappMessagePrefs.service';
import { isClinicWhatsAppMessage } from '../../main/notifications/utils/whatsappMessagePrefs.utils';

// Writes go through the notifications service, never its tables (BE §1 rule 4).
export const whatsappMessagesAdapter: WhatsAppMessagesPort = {
  list: () => WhatsAppMessagePrefsService.listPlatformMessages(),
  setEnabled: async (key, enabled, changedBy) => {
    if (!isClinicWhatsAppMessage(key)) return null;
    return WhatsAppMessagePrefsService.setPlatformMessage(
      key,
      enabled,
      changedBy
    );
  },
};
