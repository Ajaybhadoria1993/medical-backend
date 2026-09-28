import { and, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { appointmentInstantIST } from '../../../utils/istDateTime';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import { doctorManualPrescriptionModel } from '../../appointments/models/doctorManualPrescription.model';
import { buildActiveAppointmentFilter } from '../../appointments/services/appointment.service';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { ReportCardModel } from '../../reports/models/reports.model';
import { LabOrderModel } from '../../test/models/labOrder.model';
import { TestCatalogModel } from '../../test/models/testCatalog.model';
import { UserModel } from '../../users/models/user.model';
import { PatientFamilyLinksModel } from '../models/patientFamilyLinks.model';
import type { PatientRecentActivityQueryDto } from '../schemas/patient.schemas';
import type {
  RecentActivityItem,
  RecentActivityResponse,
  RecentActivityType,
} from '../types/recentActivity.types';
import {
  activityDisplayName,
  buildAppointmentStatusChip,
  buildLabReportStatusChip,
  buildPaymentStatusChip,
  formatActivityDisplayDate,
  resolvePrimaryChip,
} from '../utils/recentActivity.utils';

const patientUser = alias(UserModel, 'activity_patient_user');
const doctorUser = alias(UserModel, 'activity_doctor_user');
const relationshipColumn = sql<string>`COALESCE(${PatientFamilyLinksModel.relationship}, 'self')`;

export class PatientRecentActivityService {
  static async getRecentActivity(
    userId: string,
    query: PatientRecentActivityQueryDto
  ): Promise<RecentActivityResponse> {
    const page = Math.max(parseInt(query.pageNumber || '1', 10), 1);
    const limit = Math.max(parseInt(query.pageSize || '5', 10), 1);
    const offset = (page - 1) * limit;
    const fetchLimit = offset + limit;

    const filterPatientIds = await this.resolvePatientScope(
      userId,
      query.patientId
    );

    const requested: RecentActivityType[] =
      query.type === 'all'
        ? ['appointment', 'lab_test', 'prescription']
        : [query.type];

    const [appointments, labTests, prescriptions] = await Promise.all([
      requested.includes('appointment')
        ? this.getAppointmentActivities(userId, filterPatientIds, fetchLimit)
        : Promise.resolve([]),
      requested.includes('lab_test')
        ? this.getLabTestActivities(userId, filterPatientIds, fetchLimit)
        : Promise.resolve([]),
      requested.includes('prescription')
        ? this.getPrescriptionActivities(userId, filterPatientIds, fetchLimit)
        : Promise.resolve([]),
    ]);

    const [appointmentCount, labTestCount, prescriptionCount] =
      await Promise.all([
        requested.includes('appointment')
          ? this.countAppointments(filterPatientIds)
          : Promise.resolve(0),
        requested.includes('lab_test')
          ? this.countLabTests(filterPatientIds)
          : Promise.resolve(0),
        requested.includes('prescription')
          ? this.countPrescriptions(filterPatientIds)
          : Promise.resolve(0),
      ]);

    const merged = [...appointments, ...labTests, ...prescriptions].sort(
      (a, b) =>
        new Date(b.activityAt).getTime() - new Date(a.activityAt).getTime()
    );

    const totalRecords = appointmentCount + labTestCount + prescriptionCount;

    return {
      data: merged.slice(offset, offset + limit),
      pagination: {
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
        pageNumber: page,
        pageSize: limit,
      },
      counts: {
        appointment: appointmentCount,
        lab_test: labTestCount,
        prescription: prescriptionCount,
      },
    };
  }

  private static async resolvePatientScope(
    userId: string,
    patientId?: string
  ): Promise<string[]> {
    const familyMembers = await database
      .select({ linkedPatientId: PatientFamilyLinksModel.linkedPatientId })
      .from(PatientFamilyLinksModel)
      .where(eq(PatientFamilyLinksModel.primaryPatientId, userId));

    const allAuthorizedPatientIds = [
      userId,
      ...familyMembers.map((m) => m.linkedPatientId),
    ];

    if (!patientId) return allAuthorizedPatientIds;

    if (!allAuthorizedPatientIds.includes(patientId)) {
      throw new HttpError(
        403,
        'Access denied. You can only view activity for yourself or linked family members.'
      );
    }

    return [patientId];
  }

  private static familyLinkJoin(userId: string) {
    return and(
      eq(PatientFamilyLinksModel.linkedPatientId, patientUser.id),
      eq(PatientFamilyLinksModel.primaryPatientId, userId)
    );
  }

  private static async getAppointmentActivities(
    userId: string,
    patientIds: string[],
    limit: number
  ): Promise<RecentActivityItem[]> {
    const rows = await database
      .select({
        id: AppointmentModel.id,
        appointmentDate: AppointmentModel.appointmentDate,
        appointmentTime: AppointmentModel.appointmentTime,
        appointmentType: AppointmentModel.appointmentType,
        appointmentStatus: AppointmentModel.appointmentStatus,
        createdAt: AppointmentModel.createdAt,
        paymentStatus: AppointmentPaymentModel.paymentStatus,
        patientId: patientUser.id,
        patientName: patientUser.name,
        relationship: relationshipColumn,
        doctorId: doctorUser.id,
        doctorName: doctorUser.name,
        clinicId: ClinicModel.id,
        clinicName: ClinicModel.clinicName,
      })
      .from(AppointmentModel)
      .innerJoin(patientUser, eq(patientUser.id, AppointmentModel.patientId))
      .leftJoin(PatientFamilyLinksModel, this.familyLinkJoin(userId))
      .leftJoin(doctorUser, eq(doctorUser.id, AppointmentModel.doctorId))
      .leftJoin(ClinicModel, eq(ClinicModel.id, AppointmentModel.clinicId))
      .leftJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .where(
        and(
          inArray(AppointmentModel.patientId, patientIds),
          buildActiveAppointmentFilter()
        )
      )
      .orderBy(desc(AppointmentModel.createdAt))
      .limit(limit);

    return rows.map((row) => {
      const occurredAt = appointmentInstantIST(
        row.appointmentDate,
        row.appointmentTime
      );
      const statusChip = buildAppointmentStatusChip(row.appointmentStatus);
      const paymentChip = buildPaymentStatusChip(row.paymentStatus);
      const patientName = activityDisplayName(row.patientName);

      return {
        id: `appointment:${row.id}`,
        type: 'appointment' as const,
        referenceId: row.id,
        appointmentId: row.id,
        title: 'Appointment',
        subtitle: `Appointment for ${patientName}`,
        description: row.doctorName
          ? `Dr. ${row.doctorName}`
          : (row.clinicName ?? row.appointmentType),
        patient: {
          id: row.patientId,
          name: row.patientName,
          relationship: row.relationship,
        },
        doctor: row.doctorId
          ? { id: row.doctorId, name: row.doctorName }
          : null,
        clinic: row.clinicId
          ? { id: row.clinicId, name: row.clinicName }
          : null,
        occurredAt: occurredAt.toISOString(),
        displayDate: formatActivityDisplayDate(occurredAt),
        activityAt: (row.createdAt ?? occurredAt).toISOString(),
        status: resolvePrimaryChip(statusChip, paymentChip),
        paymentStatus: paymentChip,
        actionLabel: 'View Details',
        detailEndpoint: `/api/v1/patient/appointments/detail/${row.id}`,
      };
    });
  }

  private static async getLabTestActivities(
    userId: string,
    patientIds: string[],
    limit: number
  ): Promise<RecentActivityItem[]> {
    const rows = await database
      .select({
        id: LabOrderModel.id,
        appointmentId: LabOrderModel.appointmentId,
        reportStatus: LabOrderModel.reportStatus,
        paymentStatus: LabOrderModel.paymentStatus,
        createdAt: LabOrderModel.createdAt,
        updatedAt: LabOrderModel.updatedAt,
        testName: TestCatalogModel.name,
        testCategory: TestCatalogModel.category,
        patientId: patientUser.id,
        patientName: patientUser.name,
        relationship: relationshipColumn,
        doctorId: doctorUser.id,
        doctorName: doctorUser.name,
        clinicId: ClinicModel.id,
        clinicName: ClinicModel.clinicName,
      })
      .from(LabOrderModel)
      .innerJoin(
        TestCatalogModel,
        eq(TestCatalogModel.id, LabOrderModel.testId)
      )
      .innerJoin(patientUser, eq(patientUser.id, LabOrderModel.patientId))
      .leftJoin(PatientFamilyLinksModel, this.familyLinkJoin(userId))
      .leftJoin(doctorUser, eq(doctorUser.id, LabOrderModel.doctorId))
      .leftJoin(ClinicModel, eq(ClinicModel.id, LabOrderModel.clinicId))
      .where(inArray(LabOrderModel.patientId, patientIds))
      .orderBy(desc(LabOrderModel.createdAt))
      .limit(limit);

    return rows.map((row) => {
      const occurredAt = row.createdAt;
      const statusChip = buildLabReportStatusChip(row.reportStatus);
      const paymentChip = buildPaymentStatusChip(row.paymentStatus);
      const patientName = activityDisplayName(row.patientName);

      return {
        id: `lab_test:${row.id}`,
        type: 'lab_test' as const,
        referenceId: row.id,
        appointmentId: row.appointmentId,
        title: 'Lab Tests',
        subtitle: `Lab Test for ${patientName}`,
        description: row.testName ?? row.testCategory,
        patient: {
          id: row.patientId,
          name: row.patientName,
          relationship: row.relationship,
        },
        doctor: row.doctorId
          ? { id: row.doctorId, name: row.doctorName }
          : null,
        clinic: row.clinicId
          ? { id: row.clinicId, name: row.clinicName }
          : null,
        occurredAt: occurredAt.toISOString(),
        displayDate: formatActivityDisplayDate(occurredAt),
        activityAt: (row.updatedAt ?? occurredAt).toISOString(),
        status: resolvePrimaryChip(statusChip, paymentChip),
        paymentStatus: paymentChip,
        actionLabel: 'View Details',
        detailEndpoint: `/api/v1/patient/lab-reports?patientId=${row.patientId}`,
      };
    });
  }

  private static async getPrescriptionActivities(
    userId: string,
    patientIds: string[],
    limit: number
  ): Promise<RecentActivityItem[]> {
    const rows = await database
      .select({
        appointmentId: AppointmentModel.id,
        appointmentDate: AppointmentModel.appointmentDate,
        appointmentTime: AppointmentModel.appointmentTime,
        appointmentStatus: AppointmentModel.appointmentStatus,
        reportCardId: ReportCardModel.id,
        reportCardCreatedAt: ReportCardModel.createdAt,
        manualPrescriptionId: doctorManualPrescriptionModel.id,
        manualCreatedAt: doctorManualPrescriptionModel.createdAt,
        patientId: patientUser.id,
        patientName: patientUser.name,
        relationship: relationshipColumn,
        doctorId: doctorUser.id,
        doctorName: doctorUser.name,
        clinicId: ClinicModel.id,
        clinicName: ClinicModel.clinicName,
      })
      .from(AppointmentModel)
      .leftJoin(
        ReportCardModel,
        eq(ReportCardModel.appointmentId, AppointmentModel.id)
      )
      .leftJoin(
        doctorManualPrescriptionModel,
        eq(doctorManualPrescriptionModel.appointmentId, AppointmentModel.id)
      )
      .innerJoin(patientUser, eq(patientUser.id, AppointmentModel.patientId))
      .leftJoin(PatientFamilyLinksModel, this.familyLinkJoin(userId))
      .leftJoin(doctorUser, eq(doctorUser.id, AppointmentModel.doctorId))
      .leftJoin(ClinicModel, eq(ClinicModel.id, AppointmentModel.clinicId))
      .where(and(...this.prescriptionFilters(patientIds)))
      .orderBy(desc(AppointmentModel.appointmentDate))
      .limit(limit);

    return rows.map((row) => {
      const occurredAt = appointmentInstantIST(
        row.appointmentDate,
        row.appointmentTime
      );
      const issuedAt =
        row.reportCardCreatedAt ?? row.manualCreatedAt ?? occurredAt;
      const patientName = activityDisplayName(row.patientName);

      return {
        id: `prescription:${row.appointmentId}`,
        type: 'prescription' as const,
        referenceId:
          row.reportCardId ?? row.manualPrescriptionId ?? row.appointmentId,
        appointmentId: row.appointmentId,
        title: 'Prescription',
        subtitle: `Prescription for ${patientName}`,
        description: row.doctorName ? `Dr. ${row.doctorName}` : row.clinicName,
        patient: {
          id: row.patientId,
          name: row.patientName,
          relationship: row.relationship,
        },
        doctor: row.doctorId
          ? { id: row.doctorId, name: row.doctorName }
          : null,
        clinic: row.clinicId
          ? { id: row.clinicId, name: row.clinicName }
          : null,
        occurredAt: issuedAt.toISOString(),
        displayDate: formatActivityDisplayDate(issuedAt),
        activityAt: issuedAt.toISOString(),
        status: {
          code: 'Issued',
          label: 'Prescription Ready',
          tone: 'success',
        },
        paymentStatus: null,
        actionLabel: 'View Details',
        detailEndpoint: `/api/v1/patient/appointments/detail/${row.appointmentId}`,
      };
    });
  }

  private static prescriptionFilters(patientIds: string[]) {
    return [
      inArray(AppointmentModel.patientId, patientIds),
      or(
        isNotNull(ReportCardModel.prescriptionPdf),
        isNotNull(doctorManualPrescriptionModel.doctorManualPrescription)
      ),
    ];
  }

  private static async countAppointments(patientIds: string[]) {
    const [row] = await database
      .select({
        count: sql<number>`count(distinct ${AppointmentModel.id})::int`,
      })
      .from(AppointmentModel)
      // buildActiveAppointmentFilter() references appointment_payments columns,
      // so the payment table must be joined here too
      .leftJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .where(
        and(
          inArray(AppointmentModel.patientId, patientIds),
          buildActiveAppointmentFilter()
        )
      );
    return Number(row?.count || 0);
  }

  private static async countLabTests(patientIds: string[]) {
    const [row] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(LabOrderModel)
      .where(inArray(LabOrderModel.patientId, patientIds));
    return Number(row?.count || 0);
  }

  private static async countPrescriptions(patientIds: string[]) {
    const [row] = await database
      .select({
        count: sql<number>`count(distinct ${AppointmentModel.id})::int`,
      })
      .from(AppointmentModel)
      .leftJoin(
        ReportCardModel,
        eq(ReportCardModel.appointmentId, AppointmentModel.id)
      )
      .leftJoin(
        doctorManualPrescriptionModel,
        eq(doctorManualPrescriptionModel.appointmentId, AppointmentModel.id)
      )
      .where(and(...this.prescriptionFilters(patientIds)));
    return Number(row?.count || 0);
  }
}
