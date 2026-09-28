import { and, asc, eq, inArray } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { UserProfessionalModel } from '../../users/models/userProfessional.model';
import {
  StaffDoctorAssignmentModel,
  StaffScopeModel,
} from '../models/staffAssignment.model';
import { UpdateStaffAssignmentDto } from '../schemas/staffAssignment.schema';
import {
  DoctorStaffSummary,
  StaffAssignmentView,
} from '../types/staffScope.types';
import {
  doctorCondition,
  isScopedStaffRole,
  SCOPED_STAFF_ROLES,
} from '../utils/staffScope.utils';
import { StaffScopeService } from './staffScope.service';

export class StaffAssignmentService {
  static async getAssignment(
    userId: string,
    clinicId: string
  ): Promise<StaffAssignmentView> {
    const [user] = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
        userType: UserModel.userType,
      })
      .from(ClinicAssignModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .where(
        and(
          eq(ClinicAssignModel.userId, userId),
          eq(ClinicAssignModel.clinicId, clinicId)
        )
      )
      .limit(1);

    if (!user) throw new HttpError(404, 'User is not assigned to this clinic');

    const scope = await StaffScopeService.getScope(userId, clinicId);

    const doctors = scope.doctorIds.length
      ? await database
          .select({
            id: UserModel.id,
            name: UserModel.name,
            speciality: UserProfessionalModel.speciality,
          })
          .from(UserModel)
          .leftJoin(
            UserProfessionalModel,
            eq(UserProfessionalModel.userId, UserModel.id)
          )
          .where(inArray(UserModel.id, scope.doctorIds))
          .orderBy(asc(UserModel.name))
      : [];

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      userType: user.userType,
      accessScope: scope.accessScope,
      location: scope.location,
      responsibility: scope.responsibility,
      isDefault: scope.isDefault,
      doctors,
    };
  }

  static async listAssignments(
    clinicId: string
  ): Promise<StaffAssignmentView[]> {
    const staff = await database
      .select({ id: UserModel.id })
      .from(ClinicAssignModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .where(
        and(
          eq(ClinicAssignModel.clinicId, clinicId),
          inArray(UserModel.userType, [...SCOPED_STAFF_ROLES])
        )
      )
      .orderBy(asc(UserModel.name));

    return Promise.all(
      staff.map((row) => this.getAssignment(row.id, clinicId))
    );
  }

  static async listDoctorStaff(
    doctorId: string,
    clinicId: string
  ): Promise<DoctorStaffSummary[]> {
    const explicit = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        userType: UserModel.userType,
        location: StaffScopeModel.location,
      })
      .from(StaffDoctorAssignmentModel)
      .innerJoin(
        UserModel,
        eq(UserModel.id, StaffDoctorAssignmentModel.staffUserId)
      )
      .leftJoin(
        StaffScopeModel,
        and(
          eq(StaffScopeModel.userId, UserModel.id),
          eq(StaffScopeModel.clinicId, clinicId)
        )
      )
      .where(
        and(
          eq(StaffDoctorAssignmentModel.clinicId, clinicId),
          eq(StaffDoctorAssignmentModel.doctorUserId, doctorId)
        )
      )
      .orderBy(asc(UserModel.name));

    const clinicStaff = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        userType: UserModel.userType,
        location: StaffScopeModel.location,
      })
      .from(ClinicAssignModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .leftJoin(
        StaffScopeModel,
        and(
          eq(StaffScopeModel.userId, UserModel.id),
          eq(StaffScopeModel.clinicId, clinicId)
        )
      )
      .where(
        and(
          eq(ClinicAssignModel.clinicId, clinicId),
          inArray(UserModel.userType, [...SCOPED_STAFF_ROLES])
        )
      )
      .orderBy(asc(UserModel.name));

    const explicitIds = new Set(explicit.map((row) => row.id));

    // Clinic-wide staff cover every doctor without an assignment row, so
    // answering "who is responsible for this doctor?" from the join alone would
    // leave them out.
    const clinicWide = await Promise.all(
      clinicStaff
        .filter((row) => !explicitIds.has(row.id))
        .map(async (row) => ({
          row,
          scope: await StaffScopeService.getScope(row.id, clinicId),
        }))
    );

    return [
      ...explicit.map((row) => ({ ...row, viaAllDoctorsAccess: false })),
      ...clinicWide
        .filter(({ scope }) => scope.accessScope === 'all_doctors')
        .map(({ row }) => ({ ...row, viaAllDoctorsAccess: true })),
    ];
  }

  static async updateAssignment(params: {
    userId: string;
    clinicId: string;
    performedBy: string;
    payload: UpdateStaffAssignmentDto;
  }): Promise<StaffAssignmentView> {
    const { userId, clinicId, performedBy, payload } = params;

    const [target] = await database
      .select({ userType: UserModel.userType })
      .from(ClinicAssignModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .where(
        and(
          eq(ClinicAssignModel.userId, userId),
          eq(ClinicAssignModel.clinicId, clinicId)
        )
      )
      .limit(1);

    if (!target)
      throw new HttpError(404, 'User is not assigned to this clinic');
    if (!isScopedStaffRole(target.userType)) {
      throw new HttpError(
        400,
        `Doctor assignments apply to ${SCOPED_STAFF_ROLES.join(', ')} only.`
      );
    }

    const doctorIds = Array.from(new Set(payload.doctorIds));

    if (doctorIds.length) {
      const valid = await database
        .select({ id: UserModel.id })
        .from(ClinicAssignModel)
        .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
        .where(
          and(
            eq(ClinicAssignModel.clinicId, clinicId),
            inArray(UserModel.id, doctorIds),
            doctorCondition
          )
        );

      if (valid.length !== doctorIds.length) {
        throw new HttpError(
          400,
          'One or more selected doctors do not belong to this clinic.'
        );
      }
    }

    await database.transaction(async (tx) => {
      await tx
        .insert(StaffScopeModel)
        .values({
          userId,
          clinicId,
          accessScope: payload.accessScope,
          location: payload.location ?? null,
          responsibility: payload.responsibility ?? null,
          updatedBy: performedBy,
        })
        .onConflictDoUpdate({
          target: [StaffScopeModel.userId, StaffScopeModel.clinicId],
          set: {
            accessScope: payload.accessScope,
            location: payload.location ?? null,
            responsibility: payload.responsibility ?? null,
            updatedBy: performedBy,
            updatedAt: new Date(),
          },
        });

      await tx
        .delete(StaffDoctorAssignmentModel)
        .where(
          and(
            eq(StaffDoctorAssignmentModel.staffUserId, userId),
            eq(StaffDoctorAssignmentModel.clinicId, clinicId)
          )
        );

      if (doctorIds.length) {
        await tx.insert(StaffDoctorAssignmentModel).values(
          doctorIds.map((doctorUserId) => ({
            staffUserId: userId,
            clinicId,
            doctorUserId,
            assignedBy: performedBy,
          }))
        );
      }
    });

    await StaffScopeService.invalidate(userId, clinicId);

    return this.getAssignment(userId, clinicId);
  }
}
