import logger from '../../../utils/logger';
import { envConfig } from '../../../utils/envConfig';
import { enqueueWhatsAppTemplate } from '../queues/whatsappOutbox.queue';
import {
  formatAppointmentDate,
  formatTimeOrToken,
} from '../utils/whatsappTemplate.utils';
import { getNotificationContext } from '../models/appointmentParticipants.model';
import { normalizeWhatsAppNumber } from '../utils/whatsappTemplate.utils';
import { appointmentInstantIST } from '../../../utils/istDateTime';
import type { WhatsAppTemplateMessage } from '../types/whatsappTemplate.types';

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

      const { patientName, doctorName, patientMobile, clinicName } = context;

      // This path enqueues directly rather than going through
      // sendAppointmentNotification, so the WHATSAPP_FORCE_ENABLED override
      // has to be applied here as well.
      const whatsappEnabled =
        envConfig.WHATSAPP_FORCE_ENABLED || context.whatsappEnabled;

      if (!patientMobile || !clinicName) return;
      // WhatsApp is the only patient channel.
      if (!whatsappEnabled) return;

      const appointmentDateTime = appointmentInstantIST(
        appointmentDate,
        appointmentTime
      );

      const formattedDate = formatAppointmentDate(appointmentDateTime);
      const timeOrTokenInfo = formatTimeOrToken(appointmentDateTime, tokenNo);
      const formattedMobile = normalizeWhatsAppNumber(patientMobile);

      const promises = [];

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
                appointmentId,
              },
            },
            { clinicId: context.clinicId, appointmentId }
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

  /**
   * One patient WhatsApp about an appointment's current state, honouring the
   * clinic's WhatsApp switch. Everything is looked up here so each trigger is a
   * one-line call. Never throws.
   */
  static async sendPatientWhatsApp(
    appointmentId: string,
    key: 'appointmentCancelled' | 'consultationStarted' | 'doctorRunningLate'
  ): Promise<void> {
    // ponytail: "consultationStarted" WhatsApp paused 2026-10-30; delete this line to resume.
    if (key === 'consultationStarted') return;
    try {
      const context = await getNotificationContext(appointmentId);
      if (!context?.patientMobile || !context.clinicName) return;
      if (!envConfig.WHATSAPP_FORCE_ENABLED && !context.whatsappEnabled) return;

      const when = appointmentInstantIST(
        context.appointmentDate,
        context.appointmentTime
      );
      // A superset of every key's params; each template reads only its own.
      const params = {
        patientName: context.patientName,
        doctorName: context.doctorName,
        clinicName: context.clinicName,
        date: formatAppointmentDate(when),
        timeOrToken: formatTimeOrToken(when, context.tokenNo),
        appointmentId,
      };

      await enqueueWhatsAppTemplate(
        normalizeWhatsAppNumber(context.patientMobile),
        { key, params } as WhatsAppTemplateMessage,
        {
          clinicId: context.clinicId,
          appointmentId,
          // An appointment is cancelled once; leave-cancel reaches here from
          // both the policy service and notifyAppointmentCanceled.
          jobId:
            key === 'appointmentCancelled'
              ? `wa-cancelled-${appointmentId}`
              : undefined,
        }
      );
    } catch (err) {
      logger.error(
        `Failed to send WhatsApp "${key}" for appointment ${appointmentId}: ${(err as Error).message}`
      );
    }
  }
}
