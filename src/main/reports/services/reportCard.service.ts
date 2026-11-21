/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  and,
  desc,
  eq,
  exists,
  getTableColumns,
  gte,
  inArray,
  sql,
} from 'drizzle-orm';
import { alias, PgColumn } from 'drizzle-orm/pg-core';
import { database } from '../../../configurations/dbConnection';
import { ExaminationService } from '../../examination';
import { PatientVaccineService } from '../../patient/services/patientVaccine.service';
import { HttpError } from '../../../middlewear/errorHandler';
import logger from '../../../utils/logger';
import { getISTDateString, isBeforeTodayIST } from '../../../utils/istDateTime';
import { AppointmentClinicalModel } from '../../appointments/models/appointmentClinical.model';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentActivityHistoryModel } from '../../appointments/models/appointmentActivityHistory.model';
import { AppointmentActivityHistoryService } from '../../appointments/services/appointmentActivityHistory.service';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import { MedicineModel } from '../../medicine/models/medicine.model';
import { PrescriptionNotificationService } from '../../notifications/services/prescriptionNotification.service';
import { resolvePatientMobile } from '../../patient/services/patientMobile.service';
import { PrescriptionQueueModel } from '../../pharmacy/models/prescriptionQueue.model';
import {
  favouritePrescriptionModel,
  PrescriptionModel,
  ReportCardModel,
} from '../models/reports.model';
import {
  CreateReportAndPrescriptionsDto,
  GetReportCardIdQueryDto,
  ReportCardPostInput,
  UpdateReportAndPrescriptionsDto,
} from '../schemas/report.schemas';
import { prescriptionMedicineQueue } from '../../pharmacies/services/prescriptionMedicineQueue.service';
import { PrescriptionPrintService } from './prescriptionPrint.service';

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];

const pastDayPrescription = () =>
  new HttpError(
    409,
    "Prescriptions can't be changed after the appointment day"
  );

/** Writing a prescription: create / edit-today saves, favourites, the PDF and notifications after a save. */
export class ReportCardService {
  // Prescribing is the appointment's own doctor's act; another clinic's row reads as absent.
  private static assertPrescriber(
    appointment: {
      doctorId: string | null;
      clinicId: string | null;
      appointmentDate: Date;
    } | null,
    userId: string,
    clinicId: string
  ) {
    if (!appointment || appointment.clinicId !== clinicId) {
      throw new HttpError(404, 'Appointment not found');
    }
    if (appointment.doctorId !== userId) {
      throw new HttpError(
        403,
        "Only this appointment's doctor can write its prescription"
      );
    }
    if (isBeforeTodayIST(appointment.appointmentDate)) {
      throw pastDayPrescription();
    }
  }

  static async createPatientReportCard(
    payload: CreateReportAndPrescriptionsDto,
    adminId: string,
    clinicId: string
  ) {
    const report = await database.transaction(async (tx) => {
      const { reportCard, prescriptions, favouritePrescriptionName } = payload;
      const visit = await ReportCardService.loadPrescribableVisit(
        tx,
        reportCard.appointmentId,
        adminId,
        clinicId
      );
      if (!reportCard.petientId) {
        throw new HttpError(400, 'Patient ID (petientId) is required');
      }
      const patientId = reportCard.petientId as string;
      const appointmentId = visit.id;

      const { reportId, previousCardId } = await ReportCardService.saveCardRow(
        tx,
        payload,
        appointmentId
      );

      // The guard proved the visit's doctor and clinic are adminId and clinicId.
      await ReportCardService.saveVisitExtras(tx, {
        appointmentId,
        patientId,
        clinicId,
        givenBy: adminId,
        givenOn: visit.appointmentDate
          ? new Date(visit.appointmentDate).toISOString().slice(0, 10)
          : getISTDateString(),
        findings: (reportCard as ReportCardPostInput).additionalInformation,
      });

      const newVitals = (payload.reportCard as any).vitals;
      const updatedVitals = newVitals
        ? { ...(visit.vitals || {}), ...newVitals }
        : null;
      if (updatedVitals) {
        await tx
          .insert(AppointmentClinicalModel)
          .values({ appointmentId, vitals: updatedVitals })
          .onConflictDoUpdate({
            target: AppointmentClinicalModel.appointmentId,
            set: { vitals: updatedVitals, updatedAt: new Date() },
          });
      }

      const rows = await ReportCardService.buildPrescriptionRows(
        tx,
        prescriptions,
        { reportId, patientId, prescribedBy: adminId }
      );
      if (rows.length) await tx.insert(PrescriptionModel).values(rows);

      await ReportCardService.syncPharmacyQueue(tx, {
        reportId,
        previousCardId,
        appointmentId,
        doctorId: adminId,
        clinicId,
        hasMedicines: rows.length > 0,
      });

      if (favouritePrescriptionName && prescriptions?.length) {
        await tx.insert(favouritePrescriptionModel).values({
          doctorId: adminId,
          favouritePrescriptionName,
          medicine: prescriptions.map((prescription) => ({
            medicineId: prescription.medicineId || null,
            medicineName: prescription.medicineName,
            dosage: prescription.dosage,
            frequency: prescription.frequency,
            duration: prescription.duration,
            medicineCount: prescription.medicineCount?.toString() || '',
            notes: prescription.notes || '',
          })),
        });
      }

      await ReportCardService.logPrescriptionActivity(tx, {
        appointment: visit.appointment,
        isUpdate: previousCardId !== null,
        performedBy: adminId,
      });

      return { id: reportId, appointmentId, updatedVitals };
    });

    // Waits for the PDF, so a print right after the save gets the new one.
    await ReportCardService.generatePdfAndSendNotifications(
      report,
      payload
    ).catch((error) => {
      logger.error('Failed to generate prescription PDF/notification:', error);
    });

    // Sync prescribed medicines to pharmacy asynchronously via BullMQ
    if (payload.prescriptions?.length) {
      prescriptionMedicineQueue
        .addPrescriptionMedicinesJob({
          appointmentId: report.appointmentId,
          prescriptions: payload.prescriptions.map((p) => ({
            medicineId: p.medicineId || null,
            medicineName: p.medicineName,
          })),
        })
        .catch((error) => {
          logger.error(
            'Failed to queue prescription medicines sync job:',
            error
          );
        });
    }

    return report;
  }

  // One read of the appointment (with its vitals) serves the guard, the vitals merge and the log.
  private static async loadPrescribableVisit(
    tx: Tx,
    appointmentId: string | null | undefined,
    userId: string,
    clinicId: string
  ) {
    const [row] = appointmentId
      ? await tx
          .select({
            ...getTableColumns(AppointmentModel),
            clinicalVitals: AppointmentClinicalModel.vitals,
          })
          .from(AppointmentModel)
          .leftJoin(
            AppointmentClinicalModel,
            eq(AppointmentModel.id, AppointmentClinicalModel.appointmentId)
          )
          .where(eq(AppointmentModel.id, appointmentId))
          .limit(1)
      : [];
    if (!row) throw new HttpError(404, 'Appointment not found');
    ReportCardService.assertPrescriber(row, userId, clinicId);
    const { clinicalVitals, ...appointment } = row;
    return {
      id: appointment.id,
      appointmentDate: appointment.appointmentDate,
      vitals: clinicalVitals as Record<string, unknown> | null,
      appointment,
    };
  }

  // Creates the visit's card, or updates it and clears its old medicine rows.
  private static async saveCardRow(
    tx: Tx,
    payload: CreateReportAndPrescriptionsDto,
    appointmentId: string
  ) {
    const [existing] = await tx
      .select({ id: ReportCardModel.id })
      .from(ReportCardModel)
      .where(eq(ReportCardModel.appointmentId, appointmentId))
      .limit(1);

    // Exam findings live in visit_examinations (saveVisitExtras), not on the card.
    const { additionalInformation: _findings, ...cardValues } =
      payload.reportCard as ReportCardPostInput;

    if (existing) {
      await tx
        .update(ReportCardModel)
        .set({
          ...cardValues,
          ...(payload.printLanguage
            ? { printLanguage: payload.printLanguage }
            : {}),
          updatedAt: sql`NOW()`,
        })
        .where(eq(ReportCardModel.id, existing.id));
      await tx
        .delete(PrescriptionModel)
        .where(eq(PrescriptionModel.reportCardId, existing.id));
      return { reportId: existing.id, previousCardId: existing.id };
    }

    const [created] = await tx
      .insert(ReportCardModel)
      .values({ ...cardValues, printLanguage: payload.printLanguage ?? null })
      .returning({ id: ReportCardModel.id });
    return { reportId: created.id, previousCardId: null };
  }

  // Exam findings and the doses they record; undefined findings = the client didn't send them.
  private static async saveVisitExtras(
    tx: Tx,
    visit: {
      appointmentId: string;
      patientId: string;
      clinicId: string;
      givenBy: string;
      givenOn: string;
      findings: unknown;
    }
  ) {
    if (visit.findings === undefined) return;
    await ExaminationService.saveFindings(tx, {
      appointmentId: visit.appointmentId,
      patientId: visit.patientId,
      clinicId: visit.clinicId,
      findings: (visit.findings ?? {}) as Record<string, string>,
    });
    // Only when the save carries the vaccine field, so a client without it never clears doses.
    if (!ExaminationService.hasVaccineField(visit.findings)) return;
    await PatientVaccineService.syncVisitDoses(tx, {
      patientId: visit.patientId,
      clinicId: visit.clinicId,
      appointmentId: visit.appointmentId,
      givenBy: visit.givenBy,
      givenOn: visit.givenOn,
      picks: ExaminationService.vaccinePicks(visit.findings),
    });
  }

  // Unknown medicine ids are saved as null, so a typed-in medicine never fails the FK.
  private static async buildPrescriptionRows(
    tx: Tx,
    prescriptions: CreateReportAndPrescriptionsDto['prescriptions'],
    card: { reportId: string; patientId: string; prescribedBy: string }
  ) {
    const list = prescriptions ?? [];
    const ids = list
      .map((p) => p.medicineId)
      .filter((id): id is string => !!id);
    const known = new Set(
      ids.length
        ? (
            await tx
              .select({ id: MedicineModel.id })
              .from(MedicineModel)
              .where(inArray(MedicineModel.id, ids))
          ).map((row) => row.id)
        : []
    );
    return list.map((prescription) => ({
      medicineId:
        prescription.medicineId && known.has(prescription.medicineId)
          ? prescription.medicineId
          : null,
      prescribedBy: card.prescribedBy,
      reportCardId: card.reportId,
      petientId: card.patientId,
      medicineName: prescription.medicineName,
      composition: prescription.composition,
      strength: prescription.strength || null,
      dosage: prescription.dosage,
      frequency: prescription.frequency,
      duration: prescription.duration,
      manufacturer: prescription.manufacturer,
      medicineCount: prescription.medicineCount || null,
      marketer: prescription.marketer || null,
      imageUrl: prescription.imageUrl || null,
      notes: prescription.notes || null,
      uses: prescription.uses || null,
    }));
  }

  // No medicines = nothing for the pharmacy: an edit that removes them all drops the pending entry.
  private static async syncPharmacyQueue(
    tx: Tx,
    visit: {
      reportId: string;
      previousCardId: string | null;
      appointmentId: string;
      doctorId: string;
      clinicId: string;
      hasMedicines: boolean;
    }
  ) {
    if (!visit.hasMedicines) {
      if (!visit.previousCardId) return;
      await tx
        .delete(PrescriptionQueueModel)
        .where(
          and(
            eq(PrescriptionQueueModel.reportId, visit.previousCardId),
            eq(PrescriptionQueueModel.status, 'PENDING')
          )
        );
      return;
    }
    // An earlier save with no medicines left no entry, so an update may need to insert.
    const updated = visit.previousCardId
      ? await tx
          .update(PrescriptionQueueModel)
          .set({
            reportId: visit.reportId,
            status: 'PENDING',
            updatedAt: sql`NOW()`,
          })
          .where(eq(PrescriptionQueueModel.reportId, visit.previousCardId))
          .returning({ id: PrescriptionQueueModel.id })
      : [];
    if (updated.length) return;
    await tx.insert(PrescriptionQueueModel).values({
      reportId: visit.reportId,
      appointmentId: visit.appointmentId,
      doctorId: visit.doctorId,
      clinicId: visit.clinicId,
      status: 'PENDING',
    });
  }

  // The save never changes the appointment row, so the one read at the start is its current state.
  private static async logPrescriptionActivity(
    tx: Tx,
    entry: {
      appointment: Record<string, unknown> & { id: string };
      isUpdate: boolean;
      performedBy: string;
    }
  ) {
    const [latestHistory] = await tx
      .select({ previousState: AppointmentActivityHistoryModel.previousState })
      .from(AppointmentActivityHistoryModel)
      .where(
        eq(AppointmentActivityHistoryModel.appointmentId, entry.appointment.id)
      )
      .orderBy(desc(AppointmentActivityHistoryModel.createdAt))
      .limit(1);

    await AppointmentActivityHistoryService.logActivity({
      appointmentId: entry.appointment.id,
      action: entry.isUpdate ? 'PRESCRIPTION_UPDATED' : 'PRESCRIPTION_CREATED',
      performedBy: entry.performedBy,
      previousState: latestHistory?.previousState || entry.appointment,
      newState: entry.appointment,
      remarks: entry.isUpdate
        ? 'Prescription has been updated'
        : 'Prescription has been created',
      tx,
    });
  }

  static async getFavouritePrescription(doctorId: string, clinicId: string) {
    if (!doctorId) {
      throw new HttpError(400, 'Doctor ID is required');
    }

    // Verify doctor belongs to the clinic
    const isAssigned = await database
      .select({ id: ClinicAssignModel.id })
      .from(ClinicAssignModel)
      .where(
        and(
          eq(ClinicAssignModel.userId, doctorId),
          eq(ClinicAssignModel.clinicId, clinicId)
        )
      )
      .limit(1);

    if (!isAssigned.length) {
      throw new HttpError(
        403,
        'Access denied. Doctor is not assigned to this clinic.'
      );
    }

    const favourites = await database
      .select()
      .from(favouritePrescriptionModel)
      .where(eq(favouritePrescriptionModel.doctorId, doctorId))
      .orderBy(desc(favouritePrescriptionModel.createdAt));

    return {
      doctorId: doctorId,
      count: favourites.length,
      favourites: favourites,
    };
  }

  static async deleteFavouritePrescription(id: string, doctorId: string) {
    const [existingFavourite] = await database
      .select()
      .from(favouritePrescriptionModel)
      .where(
        and(
          eq(favouritePrescriptionModel.id, id),
          eq(favouritePrescriptionModel.doctorId, doctorId)
        )
      )
      .limit(1);

    if (!existingFavourite) {
      throw new HttpError(
        404,
        'Favourite prescription not found or unauthorized'
      );
    }

    const [deletedFavourite] = await database
      .delete(favouritePrescriptionModel)
      .where(
        and(
          eq(favouritePrescriptionModel.id, id),
          eq(favouritePrescriptionModel.doctorId, doctorId)
        )
      )
      .returning();

    return deletedFavourite;
  }

  /** Builds the shared PDF from the saved rows, so it picks its template the same way print and regenerate do. */
  private static async generatePdfAndSendNotifications(
    report: any,
    payload: CreateReportAndPrescriptionsDto
  ) {
    try {
      const input = await PrescriptionPrintService.buildPrescriptionPdfInput(
        report.id
      );
      if (!input) return;

      const clinicName = input.pdfData.clinic.name;
      // Dependents have no mobile of their own; message the primary patient.
      const patientMobile = input.patient
        ? await resolvePatientMobile(input.patient.id, input.patient.mobile)
        : null;
      if (patientMobile && clinicName) {
        PrescriptionNotificationService.sendPrescriptionNotification(
          report.appointmentId,
          input.appointment.clinicId,
          patientMobile,
          clinicName,
          (payload.reportCard as any)?.followUpInDays
        ).catch((error) => {
          logger.error('Failed to send prescription notification:', error);
        });
      }

      await PrescriptionPrintService.regeneratePdf(
        report.id,
        payload.printLanguage,
        input
      );
    } catch (error) {
      logger.error('Error in background PDF generation:', error);
    }
  }

  static async updatePatientReportCard(
    query: GetReportCardIdQueryDto,
    payload: UpdateReportAndPrescriptionsDto,
    userId: string,
    clinicId: string
  ) {
    // Per-row EXISTS inside each UPDATE: two primary-key lookups, so another doctor's row isn't matched.
    // Aliased so the inner report_cards never shadows the outer table being updated.
    const ownedCard = alias(ReportCardModel, 'owned_card');
    const ownsCard = (cardId: PgColumn) =>
      exists(
        database
          .select({ one: sql`1` })
          .from(ownedCard)
          .innerJoin(
            AppointmentModel,
            eq(AppointmentModel.id, ownedCard.appointmentId)
          )
          .where(
            and(
              eq(ownedCard.id, cardId),
              eq(AppointmentModel.doctorId, userId),
              eq(AppointmentModel.clinicId, clinicId),
              // Dates are stored as UTC midnight of the day, so today's IST date compares directly.
              gte(
                AppointmentModel.appointmentDate,
                new Date(getISTDateString())
              )
            )
          )
      );

    const result = await database.transaction(async (tx) => {
      if (
        payload.reportCard &&
        Object.keys(payload.reportCard).length > 0 &&
        query?.reportCardId
      ) {
        const setObj: Record<string, any> = {};
        const allowedDocFields = [
          'comorbidities',
          'habits',
          'vitals',
          'generalExamination',
          'systemExamination',
          'provisionalDiagnosis',
          'differentialDiagnosis',
          'finalDiagnosis',
          'investigations',
          'advice',
          'preDiagnosis',
          'clinicalNotes',
          'allergies',
          'additionalInformation',
          'followUpInDays',
          'followUpDate',
        ] as const;
        for (const k of allowedDocFields) {
          const val = (payload.reportCard as any)[k];
          if (typeof val !== 'undefined') {
            if (k === 'followUpDate') {
              setObj[k] = val ? new Date(val) : null;
            } else {
              setObj[k] = val;
            }
          }
        }
        if (payload.printLanguage) setObj.printLanguage = payload.printLanguage;
        // Findings go to visit_examinations; the card update still runs so its ownership check guards them.
        const findings = setObj.additionalInformation;
        delete setObj.additionalInformation;
        if (Object.keys(setObj).length > 0 || findings !== undefined) {
          setObj.updatedAt = sql`NOW()`;
          const [updatedReport] = await tx
            .update(ReportCardModel)
            .set(setObj)
            .where(
              and(
                eq(ReportCardModel.id, query.reportCardId),
                ownsCard(ReportCardModel.id)
              )
            )
            .returning({
              id: ReportCardModel.id,
              petientId: ReportCardModel.petientId,
              appointmentId: ReportCardModel.appointmentId,
            });

          if (!updatedReport) {
            throw new HttpError(
              404,
              'Prescription not found, or its appointment day is over'
            );
          }
          // Every card here has a visit: the ownership check joins its appointment.
          if (updatedReport.appointmentId && updatedReport.petientId) {
            await ReportCardService.saveVisitExtras(tx, {
              appointmentId: updatedReport.appointmentId,
              patientId: updatedReport.petientId,
              clinicId,
              givenBy: userId,
              givenOn: getISTDateString(),
              findings,
            });
          }
          return updatedReport;
        }
      }

      if (
        payload.prescriptions &&
        Object.keys(payload.prescriptions).length > 0
      ) {
        const setObj: Record<string, any> = {};
        const allowedDocFields = [
          'medicineName',
          'composition',
          'strength',
          'dosage',
          'frequency',
          'duration',
          'manufacturer',
          'medicineCount',
          'marketer',
          'imageUrl',
          'uses',
        ] as const;
        for (const k of allowedDocFields) {
          const val = (payload.prescriptions as any)[k];
          if (typeof val !== 'undefined') {
            setObj[k] = val;
          }
        }
        if (Object.keys(setObj).length > 0 && query.prescriptionId) {
          setObj.updatedAt = sql`NOW()`;
          const [updatedPrescription] = await tx
            .update(PrescriptionModel)
            .set(setObj)
            .where(
              and(
                eq(PrescriptionModel.id, query.prescriptionId),
                ownsCard(PrescriptionModel.reportCardId)
              )
            )
            .returning({
              id: PrescriptionModel.id,
              reportCardId: PrescriptionModel.reportCardId,
            });

          if (!updatedPrescription) {
            throw new HttpError(
              404,
              'Prescription not found, or its appointment day is over'
            );
          }
          return updatedPrescription;
        }
      }
      return null;
    });

    // Regenerate PDF OUTSIDE transaction
    if (result && (result as any).id) {
      const reportCardId = (result as any).reportCardId || (result as any).id;
      if (reportCardId) {
        await PrescriptionPrintService.regeneratePdf(
          reportCardId,
          payload.printLanguage
        );
      }
    }

    return result;
  }
}
