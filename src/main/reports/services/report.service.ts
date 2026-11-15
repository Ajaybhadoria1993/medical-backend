import { and, eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { isDoctorAssignedToClinic } from '../../../utils/clinicOwnership';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import { ReportsModel } from '../models/reports.model';
import { createReportDto, updateReportDto } from '../schemas/report.schemas';

export class ReportService {
  static async craeteReport(payload: createReportDto, clinicId: string) {
    // The patient must belong to the caller's clinic; another clinic's patient reads as absent.
    if (!(await isDoctorAssignedToClinic(payload.petientId, clinicId))) {
      throw new HttpError(404, 'Patient not found');
    }
    return await database
      .insert(ReportsModel)
      .values({ ...payload })
      .onConflictDoUpdate({
        target: [ReportsModel.reportType, ReportsModel.petientId],
        set: { ...payload, updatedAt: new Date() },
      })
      .returning();
  }

  static async updateRport(
    userId: string,
    reportId: string,
    payload: updateReportDto
  ) {
    return await database
      .update(ReportsModel)
      .set({ ...payload, updatedAt: new Date() })
      .where(
        and(eq(ReportsModel.petientId, userId), eq(ReportsModel.id, reportId))
      )
      .returning();
  }

  static async getALlReport(userId: string, clinicId: string) {
    return await database
      .select({
        id: ReportsModel.id,
        reportType: ReportsModel.reportType,
        description: ReportsModel.description,
        petientId: ReportsModel.petientId,
        reportDocs: ReportsModel.reportDocs,
        reportStatus: ReportsModel.reportStatus,
        createdAt: ReportsModel.createdAt,
        updatedAt: ReportsModel.updatedAt,
      })
      .from(ReportsModel)
      .innerJoin(
        ClinicAssignModel,
        eq(ReportsModel.petientId, ClinicAssignModel.userId)
      )
      .where(
        and(
          eq(ReportsModel.petientId, userId),
          eq(ClinicAssignModel.clinicId, clinicId)
        )
      );
  }

  static async getReport(reportId: string, clinicId: string) {
    return await database
      .select({
        id: ReportsModel.id,
        reportType: ReportsModel.reportType,
        description: ReportsModel.description,
        petientId: ReportsModel.petientId,
        reportDocs: ReportsModel.reportDocs,
        reportStatus: ReportsModel.reportStatus,
        createdAt: ReportsModel.createdAt,
        updatedAt: ReportsModel.updatedAt,
      })
      .from(ReportsModel)
      .innerJoin(
        ClinicAssignModel,
        eq(ReportsModel.petientId, ClinicAssignModel.userId)
      )
      .where(
        and(
          eq(ReportsModel.id, reportId),
          eq(ClinicAssignModel.clinicId, clinicId)
        )
      )
      .limit(1);
  }
}
