// src/main/reports/services/prescription-reminder.service.ts
import { Queue, Worker } from 'bullmq';
import { database } from '../../../configurations/dbConnection';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { eq } from 'drizzle-orm';
import { sendAppointmentNotification } from '../../../utils/smsClient';
import { ClinicSettingsModel } from '../../clinic/models/clinicSettings.model';
import { formatAppointmentDate } from '../utils/whatsappTemplate.utils';
import logger from '../../../utils/logger';
import { queueConnection } from '../queues/queueConnection';
import { getAppointmentParticipants } from '../models/appointmentParticipants.model';

interface FollowUpJobData {
  appointmentId: string;
  patientMobile: string;
  clinicName: string;
  clinicId: string;
  followUpDate: string;
}

class PrescriptionReminderQueue {
  private queue: Queue;
  private worker: Worker;

  constructor() {
    this.queue = new Queue('prescription-followups', {
      connection: queueConnection,
    });
    this.worker = new Worker(
      'prescription-followups',
      this.processJob.bind(this),
      { connection: queueConnection }
    );

    this.worker.on('failed', (job, err) => {
      logger.error(
        `Follow-up reminder failed for appointment ${job?.data?.appointmentId}: ${err.message}`
      );
    });

    // Without an 'error' listener, BullMQ's internal errors (Redis blips,
    // connection limits) surface as unhandled EventEmitter errors and crash
    // the process.
    this.queue.on('error', (err) =>
      logger.warn(`[PrescriptionReminderQueue] Queue error: ${err.message}`)
    );
    this.worker.on('error', (err) =>
      logger.warn(`[PrescriptionReminderQueue] Worker error: ${err.message}`)
    );
  }

  private async processJob(job: { data: FollowUpJobData }) {
    await this.sendFollowUpReminder(job.data);
  }

  private async sendFollowUpReminder(data: FollowUpJobData) {
    // 1. Get clinic settings
    const [clinicSettings] = await database
      .select({
        smsEnabled: ClinicSettingsModel.smsEnabled,
        whatsappEnabled: ClinicSettingsModel.whatsappEnabled,
      })
      .from(ClinicSettingsModel)
      .where(eq(ClinicSettingsModel.clinicId, data.clinicId));

    if (
      !clinicSettings ||
      (!clinicSettings.smsEnabled && !clinicSettings.whatsappEnabled)
    ) {
      return;
    }

    // 2. Create message
    const message = `You have an appointment tomorrow at ${data.clinicName}. \n\nThank You.`;

    // 3. Actually send it!
    await sendAppointmentNotification(
      data.patientMobile,
      message,
      clinicSettings.whatsappEnabled,
      {
        key: 'appointmentFollowUp',
        params: {
          ...(await getAppointmentParticipants(data.appointmentId)),
          clinicName: data.clinicName,
          followUpDate: formatAppointmentDate(new Date(data.followUpDate)),
        },
      }
    );
  }

  async scheduleFollowUpReminder(
    appointmentId: string,
    patientMobile: string,
    clinicName: string,
    clinicId: string,
    followUpInDays: number
  ) {
    // Get appointment date from DB
    const [appointment] = await database
      .select({ appointmentDate: AppointmentModel.appointmentDate })
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);

    if (!appointment?.appointmentDate) return;

    // Calculate follow-up date
    const appointmentDate = new Date(appointment.appointmentDate);
    const followUpDate = new Date(appointmentDate);
    followUpDate.setDate(appointmentDate.getDate() + followUpInDays);

    // Calculate reminder date (1 day before follow-up)
    const reminderDate = new Date(followUpDate);
    reminderDate.setDate(followUpDate.getDate() - 1);
    reminderDate.setHours(8, 30, 0, 0); // 14:00 IST = 08:30 UTC

    if (reminderDate < new Date()) {
      return; // Don't schedule past reminders
    }

    const delay = reminderDate.getTime() - Date.now();

    if (delay > 0) {
      await this.queue.add(
        `followup_${appointmentId}`,
        {
          appointmentId,
          patientMobile,
          clinicName,
          clinicId,
          followUpDate: followUpDate.toISOString(),
        },
        { delay, jobId: `followup_${appointmentId}` }
      );
    }
  }

  async removeFollowUpReminder(appointmentId: string) {
    const job = await this.queue.getJob(`followup_${appointmentId}`);
    if (job) await job.remove();
  }
}

export const prescriptionReminderQueue = new PrescriptionReminderQueue();
