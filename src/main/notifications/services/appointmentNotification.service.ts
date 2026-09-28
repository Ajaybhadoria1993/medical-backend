import logger from '../../../utils/logger';
import { envConfig } from '../../../utils/envConfig';
import { enqueueWhatsAppTemplate } from '../queues/whatsappOutbox.queue';
import { UniversalNotificationService } from './universalNotification.service';
import {
  formatAppointmentDate,
  formatTimeOrToken,
} from '../utils/whatsappTemplate.utils';
import { getNotificationContext } from '../models/appointmentParticipants.model';
import { normalizeWhatsAppNumber } from '../utils/whatsappTemplate.utils';
import { appointmentInstantIST } from '../../../utils/istDateTime';

export class AppointmentNotificationService {
  static async sendImmediateNotification(
    appointmentId: string,
    appointmentDate: Date,
    appointmentTime: string,
    tokenNo: number | null
  ) {
    try {
      const context = await getNotificationContext(appointmentId);
      if (!context) return;

      const { patientName, doctorName, patientMobile, clinicName, smsEnabled } =
        context;

      // This path enqueues directly rather than going through
      // sendAppointmentNotification, so the WHATSAPP_FORCE_ENABLED override
      // has to be applied here as well.
      const whatsappEnabled =
        envConfig.WHATSAPP_FORCE_ENABLED || context.whatsappEnabled;

      if (!patientMobile || !clinicName) return;
      if (!smsEnabled && !whatsappEnabled) return;

      const appointmentDateTime = appointmentInstantIST(
        appointmentDate,
        appointmentTime
      );

      const formattedDate = formatAppointmentDate(appointmentDateTime);
      const timeOrTokenInfo = formatTimeOrToken(appointmentDateTime, tokenNo);
      const formattedMobile = normalizeWhatsAppNumber(patientMobile);

      const message = `Appointment Booked:\n\nClinic: ${clinicName}\nDate: ${formattedDate}\n${timeOrTokenInfo}\n\nPlease arrive 10 minutes early.`;

      const promises = [];

      if (smsEnabled) {
        promises.push(
          UniversalNotificationService.send({
            recipient: { mobile: formattedMobile },
            // Event key kept for the frontend notification-preference contract.
            event: 'appointment_confirmed',
            channels: ['sms'],
            title: 'Appointment Booked',
            body: message,
          })
        );
      }

      if (whatsappEnabled) {
        promises.push(
          enqueueWhatsAppTemplate(
            formattedMobile,
            {
              key: 'appointmentBooked',
              params: {
                patientName,
                doctorName,
                clinicName,
                date: formattedDate,
                timeOrToken: timeOrTokenInfo,
              },
            },
            appointmentId
          )
        );
      }

      if (promises.length > 0) {
        await Promise.allSettled(promises);
      }
    } catch (err) {
      // Never break appointment creation on a notification failure.
      logger.error(
        `Failed to send immediate notification for appointment ${appointmentId}: ${(err as Error).message}`
      );
    }
  }
}
