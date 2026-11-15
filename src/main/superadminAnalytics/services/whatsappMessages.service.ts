import { HttpError } from '../../../middlewear/errorHandler';
import { getWhatsAppMessagesPort } from '../ports';

export class WhatsAppMessagesService {
  static list() {
    return getWhatsAppMessagesPort().list();
  }

  static async setEnabled(key: string, enabled: boolean, changedBy: string) {
    const messages = await getWhatsAppMessagesPort().setEnabled(
      key,
      enabled,
      changedBy
    );
    if (!messages)
      throw new HttpError(404, 'That WhatsApp message does not exist.');
    return messages;
  }
}
