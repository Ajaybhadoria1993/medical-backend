import { and, desc, eq, inArray, or, sql, SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { database } from '../../../configurations/dbConnection';
import { pagination } from '../../../utils/utils';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentClinicalModel } from '../../appointments/models/appointmentClinical.model';
import { ClinicSymptomModel } from '../../clinic/models/clinic-symptom.model';
import { LabOrderModel } from '../../test/models/labOrder.model';
import { TestCatalogModel } from '../../test/models/testCatalog.model';
import { UserModel } from '../../users/models/user.model';
import { UserProfessionalModel } from '../../users/models/userProfessional.model';
import { PrescriptionModel, ReportCardModel } from '../models/reports.model';
import type { GetPatientIdQueryDto } from '../schemas/report.schemas';

type VisitScope = {
  patientId: string;
  clinicId: string;
  // Set for a Doctor caller: only the visits they handled.
  ownDoctorId?: string;
};

export class PatientVisitHistoryService {
  /** One page of a patient's past visits with diagnosis, medicines, vitals and tests.
   *  Four queries per page, never one per visit. */
  static async listVisits(scope: VisitScope, query: GetPatientIdQueryDto) {
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 10, 1), 50);
    const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);
    const { limit, offset } = pagination(pageNumber, pageSize);

    const doctorUser = alias(UserModel, 'visit_doctor');

    const rows = await database
      .select({
        appointmentId: AppointmentModel.id,
        appointmentDate: AppointmentModel.appointmentDate,
        appointmentTime: AppointmentModel.appointmentTime,
        tokenNo: AppointmentModel.tokenNo,
        appointmentStatus: AppointmentModel.appointmentStatus,
        doctorName: doctorUser.name,
        doctorSpeciality: UserProfessionalModel.speciality,
        reportCardId: ReportCardModel.id,
        provisionalDiagnosis: ReportCardModel.provisionalDiagnosis,
        finalDiagnosis: ReportCardModel.finalDiagnosis,
        clinicalNotes: ReportCardModel.clinicalNotes,
        advice: ReportCardModel.advice,
        investigations: ReportCardModel.investigations,
        allergies: ReportCardModel.allergies,
        comorbidities: ReportCardModel.comorbidities,
        followUpDate: ReportCardModel.followUpDate,
        vitals: AppointmentClinicalModel.vitals,
        commonSymptoms: AppointmentClinicalModel.commonSymptoms,
        clinicSymptomIds: AppointmentClinicalModel.clinicSymptomIds,
        appointmentNotes: AppointmentClinicalModel.appointmentNotes,
        totalCount: sql<number>`count(*) over()`,
      })
      .from(AppointmentModel)
      .leftJoin(doctorUser, eq(doctorUser.id, AppointmentModel.doctorId))
      // user_id is unique there, so this join never multiplies visit rows.
      .leftJoin(
        UserProfessionalModel,
        eq(UserProfessionalModel.userId, AppointmentModel.doctorId)
      )
      .leftJoin(
        ReportCardModel,
        eq(ReportCardModel.appointmentId, AppointmentModel.id)
      )
      .leftJoin(
        AppointmentClinicalModel,
        eq(AppointmentClinicalModel.appointmentId, AppointmentModel.id)
      )
      .where(and(...this.buildConditions(scope, query)))
      .orderBy(
        desc(AppointmentModel.appointmentDate),
        desc(AppointmentModel.createdAt)
      )
      .limit(limit)
      .offset(offset);

    const requested = query.sections
      ? new Set(query.sections.split(','))
      : null;
    const wants = (section: string) => !requested || requested.has(section);

    const reportCardIds = rows
      .map((r) => r.reportCardId)
      .filter((id): id is string => !!id);
    const appointmentIds = rows.map((r) => r.appointmentId);
    const symptomIds = wants('diagnosis')
      ? [...new Set(rows.flatMap((r) => r.clinicSymptomIds ?? []))]
      : [];

    const [medicines, tests, symptoms] = await Promise.all([
      wants('medicines') && reportCardIds.length
        ? database
            .select({
              reportCardId: PrescriptionModel.reportCardId,
              medicineName: PrescriptionModel.medicineName,
              strength: PrescriptionModel.strength,
              dosage: PrescriptionModel.dosage,
              frequency: PrescriptionModel.frequency,
              duration: PrescriptionModel.duration,
              notes: PrescriptionModel.notes,
            })
            .from(PrescriptionModel)
            .where(inArray(PrescriptionModel.reportCardId, reportCardIds))
            .orderBy(PrescriptionModel.createdAt)
        : Promise.resolve([]),
      wants('tests') && appointmentIds.length
        ? database
            .select({
              appointmentId: LabOrderModel.appointmentId,
              testName: TestCatalogModel.name,
              reportStatus: LabOrderModel.reportStatus,
            })
            .from(LabOrderModel)
            .leftJoin(
              TestCatalogModel,
              eq(TestCatalogModel.id, LabOrderModel.testId)
            )
            .where(inArray(LabOrderModel.appointmentId, appointmentIds))
        : Promise.resolve([]),
      symptomIds.length
        ? database
            .select({
              id: ClinicSymptomModel.id,
              name: ClinicSymptomModel.name,
            })
            .from(ClinicSymptomModel)
            .where(inArray(ClinicSymptomModel.id, symptomIds))
        : Promise.resolve([]),
    ]);

    const symptomName = new Map(symptoms.map((s) => [s.id, s.name]));
    const totalCount = Number(rows[0]?.totalCount) || 0;

    return {
      // Unrequested sections are left out (undefined) so the page payload stays small.
      visits: rows.map(
        ({ totalCount: _total, clinicSymptomIds, commonSymptoms, ...row }) => ({
          appointmentId: row.appointmentId,
          appointmentDate: row.appointmentDate,
          appointmentTime: row.appointmentTime,
          tokenNo: row.tokenNo,
          appointmentStatus: row.appointmentStatus,
          doctorName: row.doctorName,
          doctorSpeciality: row.doctorSpeciality,
          reportCardId: row.reportCardId,
          provisionalDiagnosis: row.provisionalDiagnosis,
          finalDiagnosis: row.finalDiagnosis,
          followUpDate: row.followUpDate,
          symptoms: wants('diagnosis')
            ? [
                ...(commonSymptoms ?? []),
                ...(clinicSymptomIds ?? [])
                  .map((id) => symptomName.get(id))
                  .filter(Boolean),
              ]
            : undefined,
          vitals: wants('vitals') ? row.vitals : undefined,
          allergies: wants('allergies') ? row.allergies : undefined,
          comorbidities: wants('allergies') ? row.comorbidities : undefined,
          medicines: wants('medicines')
            ? medicines
                .filter((m) => m.reportCardId === row.reportCardId)
                .map(({ reportCardId: _id, ...m }) => m)
            : undefined,
          tests: wants('tests')
            ? tests
                .filter((t) => t.appointmentId === row.appointmentId)
                .map((t) => ({
                  testName: t.testName ?? 'Lab Test',
                  reportStatus: t.reportStatus,
                }))
            : undefined,
          investigations: wants('tests') ? row.investigations : undefined,
          clinicalNotes: wants('notes') ? row.clinicalNotes : undefined,
          appointmentNotes: wants('notes') ? row.appointmentNotes : undefined,
          advice: wants('notes') ? row.advice : undefined,
        })
      ),
      pagination: {
        totalRecords: totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
        currentPage: pageNumber,
        pageSize,
      },
    };
  }

  private static buildConditions(
    scope: VisitScope,
    query: GetPatientIdQueryDto
  ): SQL<unknown>[] {
    const conditions: SQL<unknown>[] = [
      eq(AppointmentModel.patientId, scope.patientId),
      eq(AppointmentModel.clinicId, scope.clinicId),
      // A visit is a consultation that happened: completed, or written up.
      or(
        eq(AppointmentModel.appointmentStatus, 'Completed'),
        sql`${ReportCardModel.id} IS NOT NULL`
      ) as SQL<unknown>,
    ];

    // The token wins over the query: a Doctor can't widen to other doctors.
    const doctorId = scope.ownDoctorId ?? query.doctorId;
    if (doctorId) conditions.push(eq(AppointmentModel.doctorId, doctorId));
    if (query.fromDate)
      conditions.push(
        sql`${AppointmentModel.appointmentDate}::date >= ${query.fromDate}::date`
      );
    if (query.toDate)
      conditions.push(
        sql`${AppointmentModel.appointmentDate}::date <= ${query.toDate}::date`
      );

    const term = String(query.searchBy ?? '').trim();
    if (term.length >= 2) {
      const pattern = `%${term.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      conditions.push(
        or(
          sql`${ReportCardModel.provisionalDiagnosis} ILIKE ${pattern}`,
          sql`${ReportCardModel.finalDiagnosis} ILIKE ${pattern}`,
          sql`EXISTS (SELECT 1 FROM prescriptions p WHERE p.report_card_id = ${ReportCardModel.id} AND p.medicine_name ILIKE ${pattern})`
        ) as SQL<unknown>
      );
    }
    return conditions;
  }
}
