import { and, desc, eq, or, SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { LabOrderModel } from '../../test/models/labOrder.model';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { LabsModel, UserLabAssignmentsModel } from '../models/lab.model';
import {
  LabUpdatedTestModel,
  LabUpdatedTestPackageModel,
} from '../models/labUpdated.model';
import { GetLabPatientsQueryInput } from '../schemas/labPatients.schemas';
import { pageMeta, pagination } from './labCatalog.service';

type DbTransaction = Parameters<Parameters<typeof database.transaction>[0]>[0];

type LabPatientsContext = {
  labId: string;
  userId: string;
  userRole: string;
};

type LabScope = {
  id: string;
  clinicId: string;
  name: string;
};

type LabPatientRow = {
  patientId: string;
  testId: string | null;
  labUpdatedTestId: string | null;
  labUpdatedTestPackageId: string | null;
  doctorId: string | null;
  referringDoctorName: string | null;
  workflowStatus: string;
  patientName: string | null;
  patientMobile: string | null;
  patientAddress: string | null;
  patientCity: string | null;
  patientState: string | null;
  patientEmail: string | null;
  patientStatus: string | null;
  patientGender: string | null;
  patientAge: number | null;
  patientDob: string | null;
  patientProfileImage: string | null;
  createdAt: Date;
};

type ReferredDoctor = {
  doctorName: string;
};

type LabDoctorRow = ReferredDoctor & {
  lastVisit: Date;
};

type PatientGroup = {
  patientDetails: {
    id: string;
    name: string | null;
    mobile: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    email: string | null;
    userStatus: string | null;
    gender: string | null;
    age: number | null;
    dob: string | null;
    profileImage: string | null;
  };
  lastVisit: Date;
  totalOrders: number;
};

export class LabPatientsService {
  private static async getLabScope(
    trx: DbTransaction,
    context: LabPatientsContext
  ): Promise<LabScope> {
    const [lab] = await trx
      .select({
        id: LabsModel.id,
        clinicId: LabsModel.clinicId,
        name: LabsModel.name,
      })
      .from(LabsModel)
      .where(eq(LabsModel.id, context.labId))
      .limit(1);

    if (!lab) {
      throw new HttpError(404, 'Lab not found');
    }

    if (
      context.userRole !== 'Admin' &&
      context.userRole !== 'Super_Admin' &&
      context.userRole !== 'Receptionist'
    ) {
      const [assignment] = await trx
        .select({ id: UserLabAssignmentsModel.id })
        .from(UserLabAssignmentsModel)
        .where(
          and(
            eq(UserLabAssignmentsModel.labId, context.labId),
            eq(UserLabAssignmentsModel.userId, context.userId),
            eq(UserLabAssignmentsModel.clinicId, lab.clinicId)
          )
        )
        .limit(1);

      if (!assignment) {
        throw new HttpError(403, 'User is not assigned to this lab');
      }
    }

    return lab;
  }

  private static getLabOrderScopeCondition(lab: LabScope) {
    return or(
      eq(LabOrderModel.clinicId, lab.clinicId),
      eq(LabUpdatedTestModel.labId, lab.id),
      eq(LabUpdatedTestPackageModel.labId, lab.id)
    ) as SQL;
  }

  private static getLabOrderGroupKey(row: LabPatientRow) {
    const patientKey = row.patientId;

    if (row.testId) {
      return [
        'prescribed',
        patientKey,
        row.doctorId ?? row.referringDoctorName ?? 'no-doctor',
        row.createdAt.toISOString().slice(0, 10),
      ].join(':');
    }

    if (row.labUpdatedTestPackageId) {
      return [
        'walkin_package',
        patientKey,
        row.labUpdatedTestPackageId,
        row.createdAt.toISOString(),
      ].join(':');
    }

    return ['walkin_test', patientKey, row.createdAt.toISOString()].join(':');
  }

  private static getWorkflowStatusGroupKey(status: string) {
    const normalizedStatus = status.toUpperCase();

    if (normalizedStatus === 'REJECTED') return 'REJECTED';
    if (normalizedStatus === 'NO_SHOW') return 'NO_SHOW';
    if (normalizedStatus === 'ON_HOLD') return 'ON_HOLD';
    if (normalizedStatus === 'TEST_NOT_AVAILABLE') {
      return 'TEST_NOT_AVAILABLE';
    }

    return 'OTHER';
  }

  private static groupPatients(rows: LabPatientRow[]) {
    const patientMap = new Map<string, PatientGroup>();
    const orderGroupKeysByPatient = new Map<string, Set<string>>();

    for (const row of rows) {
      const patientGroup =
        patientMap.get(row.patientId) ??
        ({
          patientDetails: {
            id: row.patientId,
            name: row.patientName,
            mobile: row.patientMobile,
            address: row.patientAddress,
            city: row.patientCity,
            state: row.patientState,
            email: row.patientEmail,
            userStatus: row.patientStatus,
            gender: row.patientGender,
            age: row.patientAge,
            dob: row.patientDob,
            profileImage: row.patientProfileImage,
          },
          lastVisit: row.createdAt,
          totalOrders: 0,
        } satisfies PatientGroup);

      if (row.createdAt > patientGroup.lastVisit) {
        patientGroup.lastVisit = row.createdAt;
      }

      const orderGroupKeys =
        orderGroupKeysByPatient.get(row.patientId) ?? new Set<string>();
      const orderGroupKey = [
        this.getLabOrderGroupKey(row),
        this.getWorkflowStatusGroupKey(row.workflowStatus),
      ].join(':');
      if (!orderGroupKeys.has(orderGroupKey)) {
        orderGroupKeys.add(orderGroupKey);
        patientGroup.totalOrders += 1;
      }
      orderGroupKeysByPatient.set(row.patientId, orderGroupKeys);

      patientMap.set(row.patientId, patientGroup);
    }

    return Array.from(patientMap.values()).sort(
      (a, b) => b.lastVisit.getTime() - a.lastVisit.getTime()
    );
  }

  private static formatReferredDoctors(rows: LabDoctorRow[]) {
    const doctorByName = new Map<string, LabDoctorRow>();

    for (const row of rows) {
      const doctorName = row.doctorName
        .trim()
        .replace(/^dr\.?\s*/i, '')
        .trim();
      if (!doctorName) continue;

      const key = doctorName.toLowerCase();
      const existing = doctorByName.get(key);

      if (!existing || row.lastVisit > existing.lastVisit) {
        doctorByName.set(key, { doctorName, lastVisit: row.lastVisit });
      }
    }

    return Array.from(doctorByName.values())
      .sort((a, b) => b.lastVisit.getTime() - a.lastVisit.getTime())
      .map(({ doctorName }) => ({ doctorName }));
  }

  static async getLabPatients(
    context: LabPatientsContext,
    query: GetLabPatientsQueryInput
  ) {
    return await database.transaction(async (trx) => {
      const lab = await this.getLabScope(trx, context);
      const { page, limit } = pagination(query);
      const patientUser = alias(UserModel, 'lab_patient_user');
      const doctorUser = alias(UserModel, 'lab_patient_doctor_user');
      const patientProfile = alias(UserProfileModel, 'lab_patient_profile');
      const doctorNameExpression = sql<string | null>`coalesce(
        ${doctorUser.name},
        ${LabOrderModel.referringDoctorName}
      )`;

      const labPatientConditions: SQL[] = [
        this.getLabOrderScopeCondition(lab),
        sql`${LabOrderModel.patientId} IS NOT NULL`,
      ];
      const conditions: SQL[] = [...labPatientConditions];

      if (query.search) {
        const pattern = `%${query.search}%`;
        conditions.push(
          or(
            sql`${patientUser.name} ILIKE ${pattern}`,
            sql`${patientUser.mobile} ILIKE ${pattern}`
          ) as SQL
        );
      }

      const rows: LabPatientRow[] = await trx
        .select({
          patientId: sql<string>`${LabOrderModel.patientId}`,
          testId: LabOrderModel.testId,
          labUpdatedTestId: LabOrderModel.labUpdatedTestId,
          labUpdatedTestPackageId: LabOrderModel.labUpdatedTestPackageId,
          doctorId: LabOrderModel.doctorId,
          referringDoctorName: LabOrderModel.referringDoctorName,
          workflowStatus: LabOrderModel.workflowStatus,
          patientName: patientUser.name,
          patientMobile: patientUser.mobile,
          patientAddress: patientProfile.address,
          patientCity: patientProfile.city,
          patientState: patientProfile.state,
          patientEmail: patientUser.email,
          patientStatus: patientUser.userStatus,
          patientGender: patientProfile.gender,
          patientAge: patientProfile.age,
          patientDob: patientProfile.dob,
          patientProfileImage: patientProfile.profileImage,
          createdAt: LabOrderModel.createdAt,
        })
        .from(LabOrderModel)
        .leftJoin(
          LabUpdatedTestModel,
          eq(LabOrderModel.labUpdatedTestId, LabUpdatedTestModel.id)
        )
        .leftJoin(
          LabUpdatedTestPackageModel,
          eq(
            LabOrderModel.labUpdatedTestPackageId,
            LabUpdatedTestPackageModel.id
          )
        )
        .innerJoin(patientUser, eq(LabOrderModel.patientId, patientUser.id))
        .leftJoin(patientProfile, eq(patientProfile.userId, patientUser.id))
        .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
        .where(and(...conditions))
        .orderBy(desc(LabOrderModel.createdAt));

      const doctorRows = await trx
        .select({
          doctorName: sql<string>`${doctorNameExpression}`,
          lastVisit: LabOrderModel.createdAt,
        })
        .from(LabOrderModel)
        .leftJoin(
          LabUpdatedTestModel,
          eq(LabOrderModel.labUpdatedTestId, LabUpdatedTestModel.id)
        )
        .leftJoin(
          LabUpdatedTestPackageModel,
          eq(
            LabOrderModel.labUpdatedTestPackageId,
            LabUpdatedTestPackageModel.id
          )
        )
        .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
        .where(
          and(
            ...labPatientConditions,
            or(
              sql`${doctorUser.name} IS NOT NULL`,
              sql`${LabOrderModel.referringDoctorName} IS NOT NULL`
            ) as SQL
          )
        )
        .orderBy(desc(LabOrderModel.createdAt));

      const patients = this.groupPatients(rows);
      const referredDoctors = this.formatReferredDoctors(doctorRows);
      const total = patients.length;
      const offset = (page - 1) * limit;

      return {
        lab: {
          id: lab.id,
          name: lab.name,
        },
        referredDoctors,
        patients: patients.slice(offset, offset + limit),
        pagination: pageMeta(total, page, limit),
      };
    });
  }
}
