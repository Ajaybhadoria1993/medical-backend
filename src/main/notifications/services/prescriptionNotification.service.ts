// src/main/reports/services/prescription-notification.service.ts
import { database } from '../../../configurations/dbConnection';
import { sendAppointmentNotification } from '../../../utils/smsClient';
import { ClinicSettingsModel } from '../../clinic/models/clinicSettings.model';
import { eq } from 'drizzle-orm';
import { prescriptionReminderQueue } from './prescriptionReminder.service';
import { getAppointmentParticipants } from '../models/appointmentParticipants.model';

export class PrescriptionNotificationService {
  // Send immediate notification when prescription is created/updated
  static async sendPrescriptionNotification(
    appointmentId: string,
    clinicId: string,
    patientMobile: string,
    clinicName: string,
    followUpInDays?: number
  ) {
    try {
      // Get clinic settings
      const [clinicSettings] = await database
        .select({
          smsEnabled: ClinicSettingsModel.smsEnabled,
          whatsappEnabled: ClinicSettingsModel.whatsappEnabled,
        })
        .from(ClinicSettingsModel)
        .where(eq(ClinicSettingsModel.clinicId, clinicId));

      if (!clinicSettings) return;

      const { smsEnabled, whatsappEnabled } = clinicSettings;

      // If both disabled, don't send
      if (!smsEnabled && !whatsappEnabled) return;

      // Message for prescription completion
      const message = `Thank you! Your appointment is completed. \n\nVisit again.`;

      // Send immediate notification
      const { patientName, doctorName } =
        await getAppointmentParticipants(appointmentId);

      await sendAppointmentNotification(
        patientMobile,
        message,
        whatsappEnabled,
        {
          key: 'appointmentCompleted',
          params: { patientName, doctorName, clinicName },
        }
      );

      // Schedule follow-up reminder if followUpInDays is provided
      if (followUpInDays && followUpInDays > 0) {
        await prescriptionReminderQueue.scheduleFollowUpReminder(
          appointmentId,
          patientMobile,
          clinicName,
          clinicId,
          followUpInDays
        );
      }
    } catch {
      // Silent fail - don't break prescription creation
    }
  }
}
