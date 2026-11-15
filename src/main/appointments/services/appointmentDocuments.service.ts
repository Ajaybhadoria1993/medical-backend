import { and, eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { deleteFromS3 } from '../../../configurations/s3';
import { HttpError } from '../../../middlewear/errorHandler';
import logger from '../../../utils/logger';
import { sendNotificationToUser } from '../../../utils/notification.utils';
import { UserModel } from '../../users/models/user.model';
import { UserDevicesModel } from '../../users/models/userDevices.model';
import { AppointmentClinicalModel } from '../models/appointmentClinical.model';
import { AppointmentModel } from '../models/appointment.model';
import { isAppointmentInClinic } from '../../../utils/clinicOwnership';
import { getISTDateString, isBeforeTodayIST } from '../../../utils/istDateTime';
import { signalAppointmentChange } from '../../realtime';
import { endConsultationIfOccupant } from '../../appointment-engine/services/queueHoldStore.service';
import { doctorManualPrescriptionModel } from '../models/doctorManualPrescription.model';
import { PrescriptionQueueService } from '../../pharmacy/services/prescriptionQueue.service';
import { medicalCertificateModel } from '../models/medicalCertificate.model';
import { AppointmentActivityHistoryService } from './appointmentActivityHistory.service';
import { AppointmentEngineOrchestrator } from '../../appointment-engine/services/orchestrator.service';
import {
  AppointmentRecord,
  AppointmentStatus,
} from '../../appointment-engine/types/engine.types';

/** Clinical paperwork on an appointment: consent file, medical certificate and the doctor's manual prescription. */
export class AppointmentDocumentsService {
  /** Checks the appointment belongs to this clinic before consent/certificate access,
   * so a route param can't read another clinic's data. Redis-cached. */
  private static async assertAppointmentInClinic(
    appointmentId: string,
    clinicId: string
  ) {
    const belongsToClinic = await isAppointmentInClinic(
      appointmentId,
      clinicId
    );
    if (!belongsToClinic) {
      throw new HttpError(
        403,
        'Access denied. Appointment does not belong to this clinic.'
      );
    }
  }

  /** Saves the doctor's handwritten/typed prescription text on their own appointment. */
  static async upsertDoctorManualPrescription(
    doctorId: string,
    appointmentId: string,
    doctorManualPrescription?: string | null
  ) {
    try {
      const [appointment] = await database
        .select({
          id: AppointmentModel.id,
          doctorId: AppointmentModel.doctorId,
          appointmentDate: AppointmentModel.appointmentDate,
          appointmentTime: AppointmentModel.appointmentTime,
          tokenNo: AppointmentModel.tokenNo,
          appointmentStatus: AppointmentModel.appointmentStatus,
          clinicId: AppointmentModel.clinicId,
          patientId: AppointmentModel.patientId,
          appointmentDurationMinutes:
            AppointmentModel.appointmentDurationMinutes,
        })
        .from(AppointmentModel)
        .where(
          and(
            eq(AppointmentModel.id, appointmentId),
            eq(AppointmentModel.doctorId, doctorId)
          )
        )
        .limit(1);

      if (!appointment) {
        throw new HttpError(
          403,
          'You can only add prescriptions to your own appointments'
        );
      }
      if (isBeforeTodayIST(new Date(appointment.appointmentDate))) {
        throw new HttpError(
          409,
          "Prescriptions can't be changed after the appointment day"
        );
      }

      const existingdoctorManualPrescription = await database
        .select()
        .from(doctorManualPrescriptionModel)
        .where(eq(doctorManualPrescriptionModel.appointmentId, appointmentId))
        .limit(1);

      const now = new Date();
      const isFirstUpload = existingdoctorManualPrescription.length === 0;

      if (
        existingdoctorManualPrescription.length > 0 &&
        doctorManualPrescription
      ) {
        const oldFilePath =
          existingdoctorManualPrescription[0].doctorManualPrescription;
        if (oldFilePath) {
          try {
            await deleteFromS3(oldFilePath);
          } catch {
            logger.warn('Failed to delete old prescription');
          }
        }
      }

      if (existingdoctorManualPrescription.length > 0) {
        const updateData: any = {
          updatedAt: now,
        };

        if (doctorManualPrescription !== undefined) {
          updateData.doctorManualPrescription = doctorManualPrescription;
        }

        const [updatedPrescription] = await database
          .update(doctorManualPrescriptionModel)
          .set(updateData)
          .where(eq(doctorManualPrescriptionModel.appointmentId, appointmentId))
          .returning();

        // Re-upload signals too, or an open encounter keeps showing the old prescription.
        signalAppointmentChange(appointment, 'encounter.vitals_updated');

        return updatedPrescription;
      } else {
        const [newTemplate] = await database
          .insert(doctorManualPrescriptionModel)
          .values({
            appointmentId,
            doctorManualPrescription: doctorManualPrescription || null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        if (isFirstUpload) {
          try {
            await PrescriptionQueueService.createEntry({
              appointmentId,
              doctorId,
              clinicId: appointment.clinicId,
            });
          } catch (err) {
            logger.warn(
              `Failed to seed prescription_queue entry for manual prescription upload, appointment=${appointmentId}`,
              { error: err }
            );
          }

          await database
            .update(AppointmentModel)
            .set({
              appointmentStatus: 'Completed',
              updatedAt: now,
            })
            .where(eq(AppointmentModel.id, appointmentId));

          // This path skips updateAppointment, so log COMPLETED here for consultation duration.
          await AppointmentActivityHistoryService.logActivity({
            appointmentId,
            action: 'COMPLETED',
            performedBy: doctorId,
            remarks: 'Appointment completed on prescription upload',
          });

          // ─── Appointment Engine: fire-and-forget post-commit hook ───────────────
          if (appointment.doctorId) {
            // Awaited before the signal below, same reason as in
            // `updateAppointment`: the engine's hook is detached.
            await endConsultationIfOccupant(
              appointment.clinicId,
              appointment.doctorId,
              getISTDateString(
                appointment.appointmentDate instanceof Date
                  ? appointment.appointmentDate
                  : new Date(appointment.appointmentDate)
              ),
              appointment.id
            );

            const engineRecord: AppointmentRecord = {
              id: appointment.id,
              appointmentDate: appointment.appointmentDate,
              appointmentTime: appointment.appointmentTime,
              tokenNo: appointment.tokenNo,
              appointmentStatus: 'Completed' as AppointmentStatus,
              clinicId: appointment.clinicId,
              patientId: appointment.patientId,
              doctorId: appointment.doctorId,
              appointmentDurationMinutes:
                appointment.appointmentDurationMinutes ?? null,
              userId: appointment.patientId,
            };

            const orchestrator = new AppointmentEngineOrchestrator();
            orchestrator
              .onStatusChange(
                engineRecord,
                appointment.appointmentStatus as AppointmentStatus
              )
              .catch((err) => {
                logger.error(
                  `[AppointmentEngine] Post-commit orchestrator hook failed for auto-completed appointment=${appointmentId}`,
                  { error: err }
                );
              });

            // Finishing a prescription promotes the next patient, so signal like a status change.
            signalAppointmentChange(appointment, 'appointment.completed');
          }
        }

        return newTemplate;
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(500, 'An unexpected error occurred');
    }
  }

  /** Sends the patient the OTP/notification for a manual prescription. */
  static async sendManualPrescriptionNotification(
    doctorId: string,
    appointmentId: string,
    otp: string
  ) {
    const [appointment] = await database
      .select({
        id: AppointmentModel.id,
        patientId: AppointmentModel.patientId,
      })
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.id, appointmentId),
          eq(AppointmentModel.doctorId, doctorId)
        )
      )
      .limit(1);

    if (!appointment) {
      throw new HttpError(404, 'Appointment not found or not assigned to you');
    }

    const doctorDevices = await database
      .select()
      .from(UserDevicesModel)
      .where(eq(UserDevicesModel.userId, doctorId));

    if (doctorDevices.length === 0) {
      throw new HttpError(
        400,
        'No registered mobile devices found. Please log in to the MediArogya app on your phone to receive notifications.'
      );
    }

    const [patient] = await database
      .select({ name: UserModel.name })
      .from(UserModel)
      .where(eq(UserModel.id, appointment.patientId))
      .limit(1);

    const patientName = patient?.name || 'Patient';
    const uploadUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/doctor/upload-manual-prescription?appointmentId=${appointmentId}`;

    await sendNotificationToUser({
      userId: doctorId,
      title: 'Upload Manual Prescription',
      body: `Tap here to upload the manual prescription for ${patientName}`,
      type: 'prescription_upload',
      allowToStoreInDB: false,
      metadata: {
        action: 'upload_manual_prescription',
        otp: otp,
        appointmentId: appointmentId,
        url: uploadUrl,
      },
    });
  }

  /** Saves the consent file on the appointment's clinical record (clinic-scoped) and signals open screens. */
  static async updateConsentFile(
    id: string,
    consentFile: string,
    clinicId: string
  ) {
    await AppointmentDocumentsService.assertAppointmentInClinic(id, clinicId);

    const result = await database.transaction(async (trx) => {
      // appointmentId is unique on the clinical table, so one upsert covers first and later uploads.
      await trx
        .insert(AppointmentClinicalModel)
        .values({ appointmentId: id, consentFile })
        .onConflictDoUpdate({
          target: AppointmentClinicalModel.appointmentId,
          set: { consentFile, updatedAt: new Date() },
        });

      // Bumped so lists sorted or synced by updatedAt pick up the new file.
      const [updatedAppointment] = await trx
        .update(AppointmentModel)
        .set({ updatedAt: new Date() })
        .where(eq(AppointmentModel.id, id))
        .returning();

      return { appointment: updatedAppointment };
    });

    // A new consent file changes the consultation screen, so it signals like any clinical edit.
    if (result.appointment) {
      signalAppointmentChange(result.appointment, 'encounter.vitals_updated');
    }

    return result;
  }

  /** The appointment's medical certificate (clinic-scoped). */
  static async getMedicalCertificate(appointmentId: string, clinicId: string) {
    await AppointmentDocumentsService.assertAppointmentInClinic(
      appointmentId,
      clinicId
    );

    const [result] = await database
      .select()
      .from(medicalCertificateModel)
      .where(eq(medicalCertificateModel.appointmentId, appointmentId));

    return result;
  }

  /** Creates or updates the appointment's medical certificate (clinic-scoped). */
  static async upsertMedicalCertificate(
    appointmentId: string,
    clinicId: string,
    medicalCondition?: string,
    restDays?: number,
    notes?: string[] | null
  ) {
    await AppointmentDocumentsService.assertAppointmentInClinic(
      appointmentId,
      clinicId
    );

    try {
      const now = new Date();

      const existingCertificate = await database
        .select()
        .from(medicalCertificateModel)
        .where(eq(medicalCertificateModel.appointmentId, appointmentId))
        .limit(1);

      if (existingCertificate.length > 0) {
        const updateData: any = {
          updatedAt: now,
        };

        if (medicalCondition !== undefined)
          updateData.medicalCondition = medicalCondition;
        if (restDays !== undefined) updateData.restDays = restDays;
        if (notes !== undefined) updateData.notes = notes;

        const [updatedCertificate] = await database
          .update(medicalCertificateModel)
          .set(updateData)
          .where(eq(medicalCertificateModel.appointmentId, appointmentId))
          .returning();

        return updatedCertificate;
      } else {
        const [newCertificate] = await database
          .insert(medicalCertificateModel)
          .values({
            appointmentId: appointmentId,
            medicalCondition: medicalCondition || '',
            restDays: restDays || 0,
            notes: notes || [],
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        return newCertificate;
      }
    } catch {
      throw new HttpError(
        500,
        'An unexpected error occurred while saving medical certificate'
      );
    }
  }
}
