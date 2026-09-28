import { NotificationProvider } from './provider.interface';
import { UniversalNotificationOptions } from '../types';
import { SnsNotificationService } from '../services/sns.service';
import { envConfig } from '../../../utils/envConfig';

export class SmsProvider implements NotificationProvider {
  async send(options: UniversalNotificationOptions): Promise<void> {
    const { recipient, body, event } = options;
    if (!recipient.mobile) {
      throw new Error('SMS provider requires a recipient mobile number');
    }

    let templateId: string | undefined;
    switch (event) {
      case 'patient_mobile_verification':
        templateId = envConfig.DLT_TEMPLATE_PATIENT_MOBILE_VERIFICATION;
        break;
      case 'patient_mobile_verification_resend':
        templateId = envConfig.DLT_TEMPLATE_PATIENT_MOBILE_VERIFICATION_RESEND;
        break;
      case 'admin_mobile_verification':
        templateId = envConfig.DLT_TEMPLATE_ADMIN_MOBILE_VERIFICATION;
        break;
      case 'admin_mobile_verification_resend':
        templateId = envConfig.DLT_TEMPLATE_ADMIN_MOBILE_VERIFICATION_RESEND;
        break;
      default:
        templateId = undefined;
    }

    await SnsNotificationService.sendTransactionalSms(
      recipient.mobile,
      body,
      templateId
    );
  }
}
