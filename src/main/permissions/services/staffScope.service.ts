import { and, asc, eq, inArray } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { AuthUser } from '../../../middlewear/auth.middleware';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  CacheKeys,
  getOrSetCache,
  invalidateCache,
} from '../../../utils/cache.util';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { UserProfessionalModel } from '../../users/models/userProfessional.model';
import {
  StaffDoctorAssignmentModel,
  StaffScopeModel,
} from '../models/staffAssignment.model';
import { StaffScope, ScopedDoctor } from '../types/staffScope.types';
import {
  doctorCondition,
  isScopedStaffRole,
  UNRESTRICTED_ROLES,
} from '../utils/staffScope.utils';

type ScopeActor = Pick<AuthUser, 'id' | 'userType'>;

export class StaffScopeService {
  private static CACHE_TTL = 300;

  // `null` means unrestricted; `[]` means a configured receptionist assigned to
  // nobody, who must see nothing. Callers have to keep the two apart.
  static async getAccessibleDoctorIds(
    user: ScopeActor,
    clinicId: string
  ): Promise<string[] | null> {
    if (UNRESTRICTED_ROLES.has(user.userType)) return null;
    if (!isScopedStaffRole(user.userType)) return null;

    const scope = await this.getScope(user.id, clinicId);
    if (scope.accessScope === 'all_doctors') return null;
    return scope.doctorIds;
  }

  static async getScope(userId: string, clinicId: string): Promise<StaffScope> {
    return getOrSetCache(
      CacheKeys.staffScope(userId, clinicId),
      this.CACHE_TTL,
      async () => {
        const [row] = await database
          .select({
            accessScope: StaffScopeModel.accessScope,
            location: StaffScopeModel.location,
            responsibility: StaffScopeModel.responsibility,
          })
          .from(StaffScopeModel)
          .where(
            and(
              eq(StaffScopeModel.userId, userId),
              eq(StaffScopeModel.clinicId, clinicId)
            )
          )
          .limit(1);

        // No row means no admin has configured this receptionist yet. They keep
        // the clinic-wide view they had before assignments existed, so that
        // deploying this feature never blanks a live dashboard mid-shift.
        if (!row) {
          return {
            accessScope: 'all_doctors' as const,
            location: null,
            responsibility: null,
            doctorIds: [],
            isDefault: true,
          };
        }

        const assignments = await database
          .select({
            doctorUserId: StaffDoctorAssignmentModel.doctorUserId,
          })
          .from(StaffDoctorAssignmentModel)
          .where(
            and(
              eq(StaffDoctorAssignmentModel.staffUserId, userId),
              eq(StaffDoctorAssignmentModel.clinicId, clinicId)
            )
          );

        return {
          accessScope: row.accessScope,
          location: row.location,
          responsibility: row.responsibility,
          doctorIds: assignments.map((a) => a.doctorUserId),
          isDefault: false,
        };
      }
    );
  }

  static async assertDoctorAllowed(
    user: ScopeActor,
    clinicId: string,
    doctorId: string
  ): Promise<void> {
    const allowed = await this.getAccessibleDoctorIds(user, clinicId);
    if (allowed === null || allowed.includes(doctorId)) return;

    throw new HttpError(
      403,
      'You are not assigned to this doctor. Ask your clinic admin to update your assignment.'
    );
  }

  // Access follows the appointment's own doctor, never who created it.
  static async assertAppointmentAllowed(
    user: ScopeActor,
    clinicId: string,
    appointmentId: string
  ): Promise<void> {
    const allowed = await this.getAccessibleDoctorIds(user, clinicId);
    if (allowed === null) return;

    const [appointment] = await database
      .select({ doctorId: AppointmentModel.doctorId })
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.id, appointmentId),
          eq(AppointmentModel.clinicId, clinicId)
        )
      )
      .limit(1);

    if (!appointment) throw new HttpError(404, 'Appointment not found');
    if (appointment.doctorId && allowed.includes(appointment.doctorId)) return;

    throw new HttpError(
      403,
      'This appointment belongs to a doctor you are not assigned to.'
    );
  }

  static async getScopedDoctors(
    user: ScopeActor,
    clinicId: string
  ): Promise<ScopedDoctor[]> {
    const allowed = await this.getAccessibleDoctorIds(user, clinicId);

    // An empty `inArray` is not a valid filter, and dropping it would hand a
    // receptionist assigned to nobody the entire clinic.
    if (allowed !== null && !allowed.length) return [];

    return database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        speciality: UserProfessionalModel.speciality,
        status: UserModel.userStatus,
      })
      .from(ClinicAssignModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .leftJoin(
        UserProfessionalModel,
        eq(UserProfessionalModel.userId, UserModel.id)
      )
      .where(
        and(
          eq(ClinicAssignModel.clinicId, clinicId),
          doctorCondition,
          ...(allowed ? [inArray(UserModel.id, allowed)] : [])
        )
      )
      .orderBy(asc(UserModel.name));
  }

  static async invalidate(userId: string, clinicId: string): Promise<void> {
    await invalidateCache(CacheKeys.staffScope(userId, clinicId));
  }
}
