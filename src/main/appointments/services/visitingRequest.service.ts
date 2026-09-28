import { and, desc, eq, gte, inArray, lte, asc, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { AuthUser } from '../../../middlewear/auth.middleware';
import { pagination } from '../../../utils/utils';
import { AppointmentModel } from '../models/appointment.model';
import { VisitingRequestModel } from '../models/visitingRequest.model';
import { UserModel } from '../../users/models/user.model';
import { ReportCardModel } from '../../reports/models/reports.model';
import {
  FindVisitingRequestQueryDto,
  GetAllVisitingRequestQueryDto,
} from '../schemas/visitingRequest.schemas';
import { UserProfessionalModel } from '../../users/models';

export class VisitingRequestService {
  static async getAllVisitingRequests(
    clinicId: string,
    query: GetAllVisitingRequestQueryDto
  ) {
    const pageSize = Math.max(Number(query?.pageSize) || 10, 1);
    const pageNumber = Math.max(Number(query?.pageNumber) || 1, 1);
    const { limit, offset } = pagination(pageNumber, pageSize);

    const doctorUser = alias(UserModel, 'doctorUser');
    const patientUser = alias(UserModel, 'patientUser');
    const mainReportCard = alias(ReportCardModel, 'mainReportCard');
    const sourceAppointment = alias(AppointmentModel, 'sourceAppointment');
    const generatedAppointment = alias(
      AppointmentModel,
      'generatedAppointment'
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const whereClauses: any[] = [eq(VisitingRequestModel.clinicId, clinicId)];

    if (query.doctorId) {
      whereClauses.push(eq(VisitingRequestModel.doctorId, query.doctorId));
    }

    if (query.startDate) {
      const [sy, sm, sd] = query.startDate.split('-').map(Number);
      whereClauses.push(
        gte(
          VisitingRequestModel.requestedDate,
          new Date(sy, sm - 1, sd, 0, 0, 0, 0)
        )
      );
    }
    if (query.endDate) {
      const [ey, em, ed] = query.endDate.split('-').map(Number);
      whereClauses.push(
        lte(
          VisitingRequestModel.requestedDate,
          new Date(ey, em - 1, ed, 23, 59, 59, 999)
        )
      );
    }

    if (query.status) {
      const statuses = Array.isArray(query.status)
        ? query.status
        : [query.status];
      whereClauses.push(inArray(VisitingRequestModel.status, statuses));
    }

    if (query.search?.trim()) {
      const escaped = query.search.trim().replace(/[%_\\]/g, (m) => `\\${m}`);
      const pattern = `%${escaped.toLowerCase()}%`;
      whereClauses.push(
        or(
          sql`lower(${doctorUser.name}) LIKE ${pattern}`,
          sql`lower(${patientUser.name}) LIKE ${pattern}`
        )
      );
    }

    const whereCondition = and(...whereClauses);

    const rows = await database
      .select({
        id: VisitingRequestModel.id,
        sourceAppointmentId: VisitingRequestModel.sourceAppointmentId,
        reportCardId: VisitingRequestModel.reportCardId,
        doctorId: VisitingRequestModel.doctorId,
        doctorName: doctorUser.name,
        speciality: UserProfessionalModel.speciality,
        patientId: VisitingRequestModel.patientId,
        patientName: patientUser.name,
        patientMobile: patientUser.mobile,
        appointmentDate: sourceAppointment.appointmentDate,
        appointmentTime: sourceAppointment.appointmentTime,
        tokenNo: sourceAppointment.tokenNo,
        mainPrescriptionPdf: mainReportCard.prescriptionPdf,
        clinicId: VisitingRequestModel.clinicId,
        requestedDate: VisitingRequestModel.requestedDate,
        status: VisitingRequestModel.status,
        generatedAppointmentId: VisitingRequestModel.generatedAppointmentId,
        generatedAppointmentDate: generatedAppointment.appointmentDate,
        generatedAppointmentTime: generatedAppointment.appointmentTime,
        generatedTokenNo: generatedAppointment.tokenNo,
        prescriptionPdf: ReportCardModel.prescriptionPdf,
        createdAt: VisitingRequestModel.createdAt,
        updatedAt: VisitingRequestModel.updatedAt,
      })
      .from(VisitingRequestModel)
      .leftJoin(doctorUser, eq(VisitingRequestModel.doctorId, doctorUser.id))
      .leftJoin(patientUser, eq(VisitingRequestModel.patientId, patientUser.id))
      .leftJoin(
        UserProfessionalModel,
        eq(VisitingRequestModel.doctorId, UserProfessionalModel.userId)
      )
      .leftJoin(
        ReportCardModel,
        eq(VisitingRequestModel.reportCardId, ReportCardModel.id)
      )
      .leftJoin(
        mainReportCard,
        eq(
          VisitingRequestModel.sourceAppointmentId,
          mainReportCard.appointmentId
        )
      )
      .leftJoin(
        sourceAppointment,
        eq(VisitingRequestModel.sourceAppointmentId, sourceAppointment.id)
      )
      .leftJoin(
        generatedAppointment,
        eq(VisitingRequestModel.generatedAppointmentId, generatedAppointment.id)
      )
      .where(whereCondition)
      .orderBy(asc(VisitingRequestModel.requestedDate));

    type VisitingRequestGroup = {
      doctorId: string;
      doctorName: string | null;
      speciality: string | null;
      patientId: string;
      patientName: string | null;
      patientMobile: string | null;
      appointmentDate: Date | null;
      slot: string | null;
      mainPrescriptionPdf: string | null;
      clinicId: string;
      requests: Array<{
        id: string;
        sourceAppointmentId: string;
        reportCardId: string | null;
        requestedDate: Date;
        status: string;
        generatedAppointmentId: string | null;
        generatedAppointmentDate: Date | null;
        generatedSlot: string | null;
        prescriptionPdf: string | null;
        createdAt: Date;
        updatedAt: Date | null;
      }>;
    };

    // Token-based booking wins the display slot when both are present — a
    // clinic in token mode still stores a placeholder appointmentTime
    // ('23:59', see AppointmentService.createAppointment), which is never
    // meant to be shown to staff.
    const resolveSlot = (
      tokenNo: number | null,
      appointmentTime: string | null
    ): string | null =>
      tokenNo != null ? String(tokenNo) : (appointmentTime ?? null);

    const groupsByDoctorPatient = new Map<string, VisitingRequestGroup>();
    for (const row of rows) {
      const key = `${row.doctorId}::${row.patientId}::${row.sourceAppointmentId}`;
      let group = groupsByDoctorPatient.get(key);
      if (!group) {
        group = {
          doctorId: row.doctorId,
          doctorName: row.doctorName,
          speciality: row.speciality,
          patientId: row.patientId,
          patientName: row.patientName,
          patientMobile: row.patientMobile,
          appointmentDate: row.appointmentDate,
          slot: resolveSlot(row.tokenNo, row.appointmentTime),
          mainPrescriptionPdf: row.mainPrescriptionPdf,
          clinicId: row.clinicId,
          requests: [],
        };
        groupsByDoctorPatient.set(key, group);
      }
      group.requests.push({
        id: row.id,
        sourceAppointmentId: row.sourceAppointmentId,
        reportCardId: row.reportCardId,
        requestedDate: row.requestedDate,
        status: row.status,
        generatedAppointmentId: row.generatedAppointmentId,
        generatedAppointmentDate: row.generatedAppointmentDate,
        generatedSlot: resolveSlot(
          row.generatedTokenNo,
          row.generatedAppointmentTime
        ),
        prescriptionPdf: row.prescriptionPdf,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }

    // Groups inherit ordering from the requestedDate-asc row fetch above, so
    // they come out earliest-upcoming-request-first.
    const allGroups = Array.from(groupsByDoctorPatient.values());
    const totalCount = allGroups.length;
    const pagedGroups = allGroups.slice(offset, offset + limit);

    // Computed from the full filtered set (all matching rows/groups, not
    // just the current page) so the stat card stays stable while paging —
    // it only moves when the doctorId/date/search filters change.
    const stats = {
      totalVisitingRequests: rows.length,
      pendingCount: rows.filter((row) => row.status === 'Pending').length,
      scheduledCount: rows.filter((row) => row.status === 'Scheduled').length,
      cancelledCount: rows.filter((row) => row.status === 'Cancelled').length,
      doctorPatientRelationsCount: totalCount,
    };

    return {
      visitingRequests: pagedGroups,
      stats,
      pagination: {
        totalRecords: totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
        currentPage: pageNumber,
        pageSize,
      },
    };
  }

  /**
   * Resolves an appointmentId to the rest of its follow-up family:
   * - Passed the *source* appointment → returns every appointment generated
   *   from its visiting requests.
   * - Passed a *generated* appointment → resolves the source, then returns
   *   the source plus any of its other generated siblings.
   */
  static async getRelatedAppointments(appointmentId: string, clinicId: string) {
    const [appointment] = await database
      .select({ id: AppointmentModel.id, clinicId: AppointmentModel.clinicId })
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);

    if (!appointment || appointment.clinicId !== clinicId) {
      throw new HttpError(404, 'Appointment not found');
    }

    const asSource = await database
      .select({
        generatedAppointmentId: VisitingRequestModel.generatedAppointmentId,
      })
      .from(VisitingRequestModel)
      .where(
        and(
          eq(VisitingRequestModel.sourceAppointmentId, appointmentId),
          eq(VisitingRequestModel.clinicId, clinicId)
        )
      );

    if (asSource.length > 0) {
      const relatedAppointmentIds = Array.from(
        new Set(
          asSource
            .map((row) => row.generatedAppointmentId)
            .filter((id): id is string => !!id)
        )
      );

      return {
        appointmentId,
        sourceAppointmentId: appointmentId,
        relatedAppointmentIds,
      };
    }

    const [asGenerated] = await database
      .select({ sourceAppointmentId: VisitingRequestModel.sourceAppointmentId })
      .from(VisitingRequestModel)
      .where(
        and(
          eq(VisitingRequestModel.generatedAppointmentId, appointmentId),
          eq(VisitingRequestModel.clinicId, clinicId)
        )
      )
      .limit(1);

    if (!asGenerated) {
      return {
        appointmentId,
        sourceAppointmentId: null,
        relatedAppointmentIds: [],
      };
    }

    const siblings = await database
      .select({
        generatedAppointmentId: VisitingRequestModel.generatedAppointmentId,
      })
      .from(VisitingRequestModel)
      .where(
        and(
          eq(
            VisitingRequestModel.sourceAppointmentId,
            asGenerated.sourceAppointmentId
          ),
          eq(VisitingRequestModel.clinicId, clinicId)
        )
      );

    const relatedAppointmentIds = Array.from(
      new Set(
        [
          asGenerated.sourceAppointmentId,
          ...siblings.map((row) => row.generatedAppointmentId),
        ].filter((id): id is string => !!id && id !== appointmentId)
      )
    );

    return {
      appointmentId,
      sourceAppointmentId: asGenerated.sourceAppointmentId,
      relatedAppointmentIds,
    };
  }

  /**
   * Clinic staff (Admin/Receptionist/etc.) can cancel any Pending request for
   * a doctor in their own clinic; a Doctor can only cancel their own.
   */
  static async cancelVisitingRequest(
    id: string,
    clinicId: string,
    user: AuthUser
  ) {
    const [visitingRequest] = await database
      .select()
      .from(VisitingRequestModel)
      .where(eq(VisitingRequestModel.id, id))
      .limit(1);

    if (!visitingRequest || visitingRequest.clinicId !== clinicId) {
      throw new HttpError(404, 'Visiting request not found');
    }

    if (user.userType === 'Doctor' && visitingRequest.doctorId !== user.id) {
      throw new HttpError(
        403,
        'You can only cancel your own visiting requests'
      );
    }

    if (visitingRequest.status !== 'Pending') {
      throw new HttpError(
        400,
        `Only pending visiting requests can be cancelled (current status: ${visitingRequest.status})`
      );
    }

    const [updated] = await database
      .update(VisitingRequestModel)
      .set({ status: 'Cancelled', updatedAt: sql`NOW()` })
      .where(eq(VisitingRequestModel.id, id))
      .returning();

    return updated;
  }

  /**
   * Looks up whether a visiting request already exists for this doctor,
   * patient, and calendar day — any status, not just Pending, since the
   * caller is checking for an existing record, not just a bookable one.
   * If more than one somehow matches (different source visits landing on
   * the same day), the most recently created one wins.
   */
  static async findVisitingRequest(
    clinicId: string,
    query: FindVisitingRequestQueryDto
  ) {
    const [y, m, d] = query.requestedDate.split('-').map(Number);
    const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
    const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999);

    const [visitingRequest] = await database
      .select({
        id: VisitingRequestModel.id,
        mainPrescriptionPdf: ReportCardModel.prescriptionPdf,
      })
      .from(VisitingRequestModel)
      .leftJoin(
        ReportCardModel,
        eq(
          VisitingRequestModel.sourceAppointmentId,
          ReportCardModel.appointmentId
        )
      )
      .where(
        and(
          eq(VisitingRequestModel.clinicId, clinicId),
          eq(VisitingRequestModel.doctorId, query.doctorId),
          eq(VisitingRequestModel.patientId, query.patientId),
          eq(VisitingRequestModel.status, 'Pending'),
          gte(VisitingRequestModel.requestedDate, dayStart),
          lte(VisitingRequestModel.requestedDate, dayEnd)
        )
      )
      .orderBy(desc(VisitingRequestModel.createdAt))
      .limit(1);

    return {
      visitingRequestId: visitingRequest?.id ?? null,
      mainPrescriptionPdf: visitingRequest?.mainPrescriptionPdf ?? null,
    };
  }
}
