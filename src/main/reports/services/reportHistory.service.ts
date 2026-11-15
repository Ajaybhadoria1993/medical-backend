/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  and,
  desc,
  eq,
  exists,
  getTableColumns,
  or,
  sql,
  SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { database } from '../../../configurations/dbConnection';
import { EXAM_KEYS, ExaminationService } from '../../examination';
import type { AuthUser } from '../../../middlewear/auth.middleware';
import { HttpError } from '../../../middlewear/errorHandler';
import { PatientVisitHistoryService } from './patientVisitHistory.service';
import { pagination } from '../../../utils/utils';
import { AppointmentClinicalModel } from '../../appointments/models/appointmentClinical.model';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { doctorManualPrescriptionModel } from '../../appointments/models/doctorManualPrescription.model';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { MedicineModel } from '../../medicine/models/medicine.model';
import { LabOrderModel } from '../../test/models/labOrder.model';
import { TestCatalogModel } from '../../test/models/testCatalog.model';
import { UserModel } from '../../users/models/user.model';
import { PrescriptionModel, ReportCardModel } from '../models/reports.model';
import {
  GetPatientIdParamsDto,
  GetPatientIdQueryDto,
  GetReportIdsQueryDto,
} from '../schemas/report.schemas';
import { PharmacyAssignModel } from '../../pharmacy/models/pharmacy.model';

/** Reading saved prescriptions: a patient's visits and history, one report card, Copy From Last Visit. */
export class ReportHistoryService {
  private static readonly CLINICAL_HISTORY_ROLES = ['Admin', 'Doctor'];

  /** The same doctor's previous prescription for this appointment's patient: typed exam values + history. */
  static async getLastVisitNotes(
    appointmentId: string,
    clinicId: string,
    user: Pick<AuthUser, 'id' | 'userType'>
  ) {
    if (!ReportHistoryService.CLINICAL_HISTORY_ROLES.includes(user.userType)) {
      throw new HttpError(
        403,
        'Only doctors and admins can view clinical history'
      );
    }
    const current = alias(AppointmentModel, 'current');
    const [last] = await database
      .select({
        date: AppointmentModel.appointmentDate,
        notes: ExaminationService.findingsColumn(
          ReportCardModel.appointmentId,
          ReportCardModel.additionalInformation
        ),
        history: ReportCardModel.comorbidities,
      })
      .from(current)
      .innerJoin(
        AppointmentModel,
        and(
          eq(AppointmentModel.patientId, current.patientId),
          eq(AppointmentModel.doctorId, current.doctorId),
          eq(AppointmentModel.clinicId, clinicId),
          sql`${AppointmentModel.id} <> ${current.id}`,
          sql`${AppointmentModel.appointmentDate} <= ${current.appointmentDate}`
        )
      )
      .innerJoin(
        ReportCardModel,
        eq(ReportCardModel.appointmentId, AppointmentModel.id)
      )
      .where(
        and(
          eq(current.id, appointmentId),
          eq(current.clinicId, clinicId),
          // A Doctor copies only from their own visits.
          user.userType === 'Doctor' ? eq(current.doctorId, user.id) : undefined
        )
      )
      .orderBy(
        desc(AppointmentModel.appointmentDate),
        desc(ReportCardModel.createdAt)
      )
      .limit(1);
    if (!last) return null;
    // Typed exam values only: auto cells are worked out again for today, private notes never leave.
    const examNotes: Record<string, string> = {};
    for (const [key, value] of Object.entries(last.notes ?? {})) {
      const info = EXAM_KEYS.get(key);
      if (
        info &&
        !info.cell.auto &&
        !info.cell.recordsVaccines &&
        !info.cell.retired &&
        typeof value === 'string' &&
        value.trim()
      )
        examNotes[key] = value;
    }
    return { date: last.date, examNotes, history: last.history ?? [] };
  }

  static escapeLike(s: string) {
    return s.replace(/[%_\\]/g, (m) => `\\${m}`);
  }

  static async getAppoinmentsPrescriptionsReport(
    validatedParams: GetPatientIdParamsDto,
    validatedQuery: GetPatientIdQueryDto,
    clinicId: string,
    user: Pick<AuthUser, 'id' | 'userType'>
  ) {
    const isClinicalType = validatedQuery?.typeOfPaginations !== 'Appointments';
    if (
      isClinicalType &&
      !ReportHistoryService.CLINICAL_HISTORY_ROLES.includes(user.userType)
    ) {
      throw new HttpError(
        403,
        'Only doctors and admins can view clinical history'
      );
    }
    // A Doctor sees only the visits they handled; an Admin sees the whole clinic.
    const ownVisitsOnly = user.userType === 'Doctor';

    if (validatedQuery?.typeOfPaginations === 'Visits') {
      return PatientVisitHistoryService.listVisits(
        {
          patientId: validatedParams.patientId,
          clinicId,
          ownDoctorId: ownVisitsOnly ? user.id : undefined,
        },
        validatedQuery
      );
    }

    return await database.transaction(async (tx) => {
      const pageSize = Math.max(Number(validatedQuery.pageSize) || 10, 1);
      const pageNumber = Math.max(Number(validatedQuery.pageNumber) || 1, 1);
      const { limit, offset } = pagination(pageNumber, pageSize);

      if (validatedQuery?.typeOfPaginations === 'Appointments') {
        const conditions = [
          eq(AppointmentModel.patientId, validatedParams.patientId),
          eq(AppointmentModel.clinicId, clinicId),
        ];
        if (validatedQuery?.searchBy) {
          const raw = String(validatedQuery.searchBy).trim();
          if (raw.length > 0) {
            const terms = raw.split(/\s+/).slice(0, 5);
            const termConditions: SQL<unknown>[] = terms
              .map((term): SQL<unknown> | undefined => {
                const escaped = ReportHistoryService.escapeLike(term);
                const pattern = `%${escaped}%`.toLowerCase();
                return or(
                  sql`lower(${AppointmentModel.appointmentType}) LIKE ${pattern}`,
                  sql`lower(${AppointmentModel.appointmentTime}) LIKE ${pattern}`
                );
              })
              .filter((cond): cond is SQL<unknown> => cond !== undefined);
            if (termConditions.length) {
              conditions.push(...termConditions);
            }
          }
        }
        const totalRecords = await tx
          .select({ count: sql`COUNT(DISTINCT ${AppointmentModel.id})` })
          .from(AppointmentModel)
          .where(
            and(
              eq(AppointmentModel.patientId, validatedParams.patientId),
              eq(AppointmentModel.clinicId, clinicId)
            )
          );
        const doctorUser = alias(UserModel, 'doctorUser');
        const totalCount = Number(totalRecords[0]?.count) || 0;
        const totalPages = Math.ceil(totalCount / pageSize);
        const appointments = await tx
          .select({
            id: AppointmentModel.id,
            appointmentType: AppointmentModel.appointmentType,
            appointmentDate: AppointmentModel.appointmentDate,
            appointmentTime: AppointmentModel.appointmentTime,
            tokenNo: AppointmentModel.tokenNo,
            appointmentStatus: AppointmentModel.appointmentStatus,
            appointmentNotes: AppointmentClinicalModel.appointmentNotes,
            reReasonForCancellation: AppointmentModel.reReasonForCancellation,
            reasionForReSchedule: AppointmentModel.reasionForReSchedule,
            createdAt: AppointmentModel.createdAt,
            updatedAt: AppointmentModel.updatedAt,
            doctor: {
              id: doctorUser.id,
              name: doctorUser.name,
              speciality: sql<string>`(SELECT speciality FROM user_professionals WHERE user_id = ${doctorUser.id} LIMIT 1)`,
              imageUrl: sql<string>`(SELECT profile_image FROM user_profiles WHERE user_id = ${doctorUser.id} LIMIT 1)`,
            },
          })
          .from(AppointmentModel)
          .leftJoin(doctorUser, eq(doctorUser.id, AppointmentModel.doctorId))
          .leftJoin(
            AppointmentClinicalModel,
            eq(AppointmentModel.id, AppointmentClinicalModel.appointmentId)
          )
          .where(and(...conditions))
          .limit(limit)
          .offset(offset)
          .orderBy(desc(AppointmentModel.updatedAt));

        return {
          appointments,
          pagination: {
            totalRecords: totalCount,
            totalPages,
            currentPage: pageNumber,
            pageSize,
          },
        };
      }

      if (validatedQuery?.typeOfPaginations === 'Prescriptions') {
        const doctorUser = alias(UserModel, 'doctorUser');
        const doctorSpeciality = sql<string>`(SELECT speciality FROM user_professionals WHERE user_id = ${doctorUser.id} LIMIT 1)`;
        // The generated PDF wins over a manual upload for the same visit.
        const prescriptionPdf = sql<string>`coalesce(${ReportCardModel.prescriptionPdf}, ${doctorManualPrescriptionModel.doctorManualPrescription})`;

        const conditions: SQL<unknown>[] = [
          eq(AppointmentModel.patientId, validatedParams.patientId),
          eq(AppointmentModel.clinicId, clinicId),
          sql`${prescriptionPdf} IS NOT NULL`,
        ];
        if (ownVisitsOnly) {
          conditions.push(eq(AppointmentModel.doctorId, user.id));
        }
        const searchTerm = String(validatedQuery?.searchBy ?? '').trim();
        if (searchTerm.length > 0) {
          const pattern = `%${ReportHistoryService.escapeLike(searchTerm)}%`;
          conditions.push(
            or(
              sql`${doctorUser.name} ILIKE ${pattern}`,
              sql`${doctorSpeciality} ILIKE ${pattern}`,
              sql`to_char(${AppointmentModel.appointmentDate}, 'DD/MM/YYYY') ILIKE ${pattern}`
            ) as SQL<unknown>
          );
        }

        const rows = await tx
          .select({
            id: AppointmentModel.id,
            appointmentId: AppointmentModel.id,
            prescriptionPdf,
            appointmentDate: AppointmentModel.appointmentDate,
            appointmentTime: AppointmentModel.appointmentTime,
            tokenNo: AppointmentModel.tokenNo,
            doctorName: doctorUser.name,
            doctorSpeciality,
            createdAt: sql<Date>`coalesce(${ReportCardModel.createdAt}, ${doctorManualPrescriptionModel.createdAt})`,
            totalCount: sql<number>`count(*) over()`,
          })
          .from(AppointmentModel)
          .leftJoin(doctorUser, eq(doctorUser.id, AppointmentModel.doctorId))
          .leftJoin(
            ReportCardModel,
            and(
              eq(ReportCardModel.appointmentId, AppointmentModel.id),
              eq(ReportCardModel.petientId, validatedParams.patientId)
            )
          )
          .leftJoin(
            doctorManualPrescriptionModel,
            eq(doctorManualPrescriptionModel.appointmentId, AppointmentModel.id)
          )
          .where(and(...conditions))
          .orderBy(
            desc(AppointmentModel.appointmentDate),
            desc(AppointmentModel.createdAt)
          )
          .limit(limit)
          .offset(offset);

        const totalCount = Number(rows[0]?.totalCount) || 0;
        const totalPages = Math.ceil(totalCount / pageSize);
        const paginatedPrescriptions = rows.map(
          ({ totalCount: _total, ...row }) => row
        );

        return {
          prescriptions: paginatedPrescriptions,
          pagination: {
            totalRecords: totalCount,
            totalPages,
            currentPage: pageNumber,
            pageSize,
          },
        };
      }

      if (validatedQuery?.typeOfPaginations === 'Medcial history') {
        // Report cards carry no clinic, so scope runs through the visit.
        const visit = alias(AppointmentModel, 'history_visit');
        const conditions = [
          eq(ReportCardModel.petientId, validatedParams.patientId),
          exists(
            tx
              .select({ id: visit.id })
              .from(visit)
              .where(
                and(
                  eq(visit.id, ReportCardModel.appointmentId),
                  eq(visit.clinicId, clinicId),
                  ownVisitsOnly ? eq(visit.doctorId, user.id) : undefined
                )
              )
          ),
        ];
        if (validatedQuery?.searchBy) {
          const raw = String(validatedQuery.searchBy).trim();
          if (raw.length > 0) {
            const terms = raw.split(/\s+/).slice(0, 5);
            const termConditions: SQL<unknown>[] = terms
              .map((term): SQL<unknown> | undefined => {
                const escaped = ReportHistoryService.escapeLike(term);
                const pattern = `%${escaped}%`.toLowerCase();
                return or(
                  sql`lower(coalesce(array_to_string(${ReportCardModel.comorbidities}, ' '), '')) LIKE ${pattern}`,
                  sql`lower(coalesce(array_to_string(${ReportCardModel.habits}, ' '), '')) LIKE ${pattern}`
                );
              })
              .filter((cond): cond is SQL<unknown> => cond !== undefined);
            if (termConditions.length) {
              conditions.push(...termConditions);
            }
          }
        }

        const totalRecords = await tx
          .select({ count: sql`COUNT(DISTINCT ${ReportCardModel.id})` })
          .from(ReportCardModel)
          .where(and(...conditions));

        const totalCount = Number(totalRecords[0]?.count) || 0;
        const totalPages = Math.ceil(totalCount / pageSize);

        const medicalHistories = await tx
          .select({
            ...getTableColumns(ReportCardModel),
            additionalInformation: ExaminationService.findingsColumn(
              ReportCardModel.appointmentId,
              ReportCardModel.additionalInformation
            ),
          })
          .from(ReportCardModel)
          .where(and(...conditions))
          .limit(limit)
          .offset(offset)
          .orderBy(desc(ReportCardModel.updatedAt));

        return {
          medicalHistories,
          pagination: {
            totalRecords: totalCount,
            totalPages,
            currentPage: pageNumber,
            pageSize,
          },
        };
      }
    });
  }

  static async getReportCard(
    query: GetReportIdsQueryDto,
    clinicId: string,
    userType?: string
  ) {
    return await database.transaction(async (tx) => {
      const conditions = [];

      if (query?.appointmentId) {
        conditions.push(eq(ReportCardModel.appointmentId, query.appointmentId));
      }
      if (query?.reportCardId) {
        conditions.push(eq(ReportCardModel.id, query.reportCardId));
      }

      const reportCardResult = await tx
        .select({
          id: ReportCardModel.id,
          petientId: ReportCardModel.petientId,
          appointmentId: ReportCardModel.appointmentId,
          reportId: ReportCardModel.reportId,
          comorbidities: ReportCardModel.comorbidities,
          habits: ReportCardModel.habits,
          generalExamination: ReportCardModel.generalExamination,
          systemExamination: ReportCardModel.systemExamination,
          provisionalDiagnosis: ReportCardModel.provisionalDiagnosis,
          differentialDiagnosis: ReportCardModel.differentialDiagnosis,
          finalDiagnosis: ReportCardModel.finalDiagnosis,
          investigations: ReportCardModel.investigations,
          advice: ReportCardModel.advice,
          preDiagnosis: ReportCardModel.preDiagnosis,
          clinicalNotes: ReportCardModel.clinicalNotes,
          allergies: ReportCardModel.allergies,
          surgerySuggested: ReportCardModel.surgerySuggested,
          visitingDays: ReportCardModel.visitingDays,
          visitingNotes: ReportCardModel.visitingNotes,
          additionalInformation: ExaminationService.findingsColumn(
            ReportCardModel.appointmentId,
            ReportCardModel.additionalInformation
          ),
          prescriptionPdf: ReportCardModel.prescriptionPdf,
          printLanguage: ReportCardModel.printLanguage,
          followUpInDays: ReportCardModel.followUpInDays,
          followUpDate: ReportCardModel.followUpDate,
          createdAt: ReportCardModel.createdAt,
          updatedAt: ReportCardModel.updatedAt,
        })
        .from(ReportCardModel)
        .innerJoin(
          AppointmentModel,
          eq(ReportCardModel.appointmentId, AppointmentModel.id)
        )
        .where(and(...conditions, eq(AppointmentModel.clinicId, clinicId)))
        .orderBy(desc(ReportCardModel.updatedAt))
        .limit(1);

      let reportCardData: any = reportCardResult[0] || {};
      if (reportCardData.additionalInformation) {
        reportCardData = {
          ...reportCardData,
          additionalInformation: ExaminationService.notesFor(
            reportCardData.additionalInformation,
            userType
          ),
        };
      }
      let prescriptions: any[] = [];

      // If no report card found for the specific appointment, fetch last report card data for the patient
      if (!reportCardResult.length && query?.appointmentId) {
        // First get the patientId from the appointment
        const appointment = await tx
          .select({
            patientId: AppointmentModel.patientId,
          })
          .from(AppointmentModel)
          .where(
            and(
              eq(AppointmentModel.id, query.appointmentId),
              eq(AppointmentModel.clinicId, clinicId)
            )
          )
          .limit(1);

        if (appointment.length) {
          const patientId = appointment[0].patientId;

          // Get the most recent report card for this patient
          const lastReportCard = await tx
            .select({
              id: ReportCardModel.id,
              habits: ReportCardModel.habits,
              provisionalDiagnosis: ReportCardModel.provisionalDiagnosis,
              allergies: ReportCardModel.allergies,
              surgerySuggested: ReportCardModel.surgerySuggested,
              updatedAt: ReportCardModel.updatedAt,
            })
            .from(ReportCardModel)
            .innerJoin(
              AppointmentModel,
              eq(ReportCardModel.appointmentId, AppointmentModel.id)
            )
            .where(
              and(
                eq(ReportCardModel.petientId, patientId),
                eq(AppointmentModel.clinicId, clinicId)
              )
            )
            .orderBy(desc(ReportCardModel.updatedAt))
            .limit(1);

          if (lastReportCard.length) {
            // Return only habits, provisionalDiagnosis, and allergies from last report card
            reportCardData = {
              habits: lastReportCard[0].habits,
              provisionalDiagnosis: lastReportCard[0].provisionalDiagnosis,
              allergies: lastReportCard[0].allergies,
              surgerySuggested: lastReportCard[0].surgerySuggested,
            };
          } else {
            // No report card exists for this patient at all
            reportCardData = {};
          }
        } else {
          reportCardData = {};
        }
      }

      // Fetch prescriptions only if we have a valid report card ID and it's from the current appointment
      if (reportCardResult.length && reportCardResult[0]?.id) {
        prescriptions = await tx
          .select({
            id: PrescriptionModel.id,
            reportCardId: PrescriptionModel.reportCardId,
            petientId: PrescriptionModel.petientId,
            medicineId: PrescriptionModel.medicineId,
            prescribedBy: PrescriptionModel.prescribedBy,
            medicineName: PrescriptionModel.medicineName,
            composition: PrescriptionModel.composition,
            strength: PrescriptionModel.strength,
            dosage: PrescriptionModel.dosage,
            frequency: PrescriptionModel.frequency,
            duration: PrescriptionModel.duration,
            manufacturer: PrescriptionModel.manufacturer,
            medicineCount: PrescriptionModel.medicineCount,
            marketer: PrescriptionModel.marketer,
            imageUrl: PrescriptionModel.imageUrl,
            notes: PrescriptionModel.notes,
            uses: PrescriptionModel.uses,
            createdAt: PrescriptionModel.createdAt,
            updatedAt: PrescriptionModel.updatedAt,
            medicine: {
              id: MedicineModel.id,
              name: MedicineModel.name,
              strength: MedicineModel.strength,
              form: MedicineModel.form,
            },
          })
          .from(PrescriptionModel)
          .leftJoin(
            MedicineModel,
            eq(PrescriptionModel.medicineId, MedicineModel.id)
          )
          .where(eq(PrescriptionModel.reportCardId, reportCardResult[0].id))
          .orderBy(desc(PrescriptionModel.updatedAt));
      }

      const pharmacyAssigned = await tx
        .select({
          pharmacyId: PharmacyAssignModel.pharmacyId,
        })
        .from(PharmacyAssignModel)
        .where(eq(PharmacyAssignModel.clinicId, clinicId))
        .limit(1);

      const clinicResult = await tx
        .select({
          id: ClinicModel.id,
          clinicName: ClinicModel.clinicName,
          Tagline: ClinicModel.Tagline,
          clinicAddress: ClinicModel.clinicAddress,
          clinicLocation: ClinicModel.clinicLocation,
          clinicPhone: ClinicModel.clinicPhone,
          City: ClinicModel.City,
          State: ClinicModel.State,
          ZipCode: ClinicModel.ZipCode,
          clinicLogo: ClinicModel.clinicLogo,
        })
        .from(ClinicModel)
        .where(eq(ClinicModel.id, clinicId))
        .limit(1);

      // Tests ordered for this visit, so the prescription page needs no second request for them.
      const tests = query?.appointmentId
        ? await tx
            .select({ id: TestCatalogModel.id, name: TestCatalogModel.name })
            .from(LabOrderModel)
            .innerJoin(
              TestCatalogModel,
              eq(LabOrderModel.testId, TestCatalogModel.id)
            )
            .innerJoin(
              AppointmentModel,
              eq(LabOrderModel.appointmentId, AppointmentModel.id)
            )
            .where(
              and(
                eq(LabOrderModel.appointmentId, query.appointmentId),
                eq(AppointmentModel.clinicId, clinicId)
              )
            )
            .orderBy(desc(LabOrderModel.createdAt))
        : [];

      return {
        tests,
        clinic: clinicResult.length
          ? {
              ...clinicResult[0],
              isPharmacyAvailable: !!pharmacyAssigned.length,
            }
          : {},
        reportCard: reportCardData,
        prescriptions,
      };
    });
  }
}
