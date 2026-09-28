import { NotificationProvider } from './provider.interface';
import { UniversalNotificationOptions } from '../types';
import { sendEmail } from '../../../utils/email';

export class EmailProvider implements NotificationProvider {
  async send(options: UniversalNotificationOptions): Promise<void> {
    const { recipient, title, body, emailHtml } = options;
    if (!recipient.email) {
      throw new Error('Email provider requires a recipient email address');
    }
    const htmlContent = emailHtml || `<p>${body}</p>`;
    await sendEmail(recipient.email, title, htmlContent);
  }
}
