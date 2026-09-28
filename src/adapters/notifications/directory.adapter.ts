/**
 * DirectoryPort implementation — the only place notification code touches
 * another feature's tables, kept outside the module so extraction is a swap.
 */

import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { database } from '../../configurations/dbConnection';
import { AppointmentModel } from '../../main/appointments/models/appointment.model';
import {
  ClinicAssignModel,
  ClinicModel,
} from '../../main/clinic/models/clinic.model';
import { ClinicSettingsModel } from '../../main/clinic/models/clinicSettings.model';
import { UserLabAssignmentsModel } from '../../main/lab/models/lab.model';
import {
  resolvePatientMobile,
  resolvePatientMobiles,
} from '../../main/patient/services/patientMobile.service';
import type {
  AppointmentContext,
  ChannelSettings,
  DirectoryPort,
  NotificationUser,
} from '../../main/notifications/ports';
import {
  StaffDoctorAssignmentModel,
  StaffScopeModel,
} from '../../main/permissions/models/staffAssignment.model';
import { ROLE_DEFAULT_PERMISSIONS } from '../../main/permissions/utils/permission.constants';
import { PermissionService } from '../../main/permissions/services/permission.service';
import {
  SCOPED_STAFF_ROLES,
  UNRESTRICTED_ROLES,
} from '../../main/permissions/utils/staffScope.utils';
import { UserModel, userTypeEnum } from '../../main/users/models/user.model';

/** The user_type enum, so role lists stay checkable against the column. */
type UserType = (typeof userTypeEnum.enumValues)[number];

const STAFF_ROLES = [...UNRESTRICTED_ROLES, ...SCOPED_STAFF_ROLES].filter(
  (role) => role !== 'Super_Admin'
) as UserType[];

const UNRESTRICTED = [...UNRESTRICTED_ROLES] as UserType[];

export const directoryAdapter: DirectoryPort = {
  async getUser(userId: string): Promise<NotificationUser | null> {
    const [user] = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        userType: UserModel.userType,
      })
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);

    return user ? { ...user, name: user.name ?? '' } : null;
  },

  /**
   * Staff responsible for one doctor, in one query. Staff with no scope row
   * count as all-doctors, mirroring StaffScopeService (D1a).
   */
  async getStaffResponsibleForDoctor(
    clinicId: string,
    doctorId: string | null
  ): Promise<NotificationUser[]> {
    const assignment = alias(StaffDoctorAssignmentModel, 'assignment');

    const rows = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        userType: UserModel.userType,
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
      .leftJoin(
        assignment,
        and(
          eq(assignment.staffUserId, UserModel.id),
          eq(assignment.clinicId, clinicId),
          doctorId
            ? eq(assignment.doctorUserId, doctorId)
            : isNull(assignment.id)
        )
      )
      .where(
        and(
          eq(ClinicAssignModel.clinicId, clinicId),
          inArray(UserModel.userType, STAFF_ROLES),
          or(
            // Unrestricted by role. Kept as-is because this lookup also serves
            // payment notifications, where clinic-wide admin oversight is
            // wanted. Appointment events narrow it further in their own
            // recipient rule (appointmentStaff) rather than here.
            inArray(UserModel.userType, UNRESTRICTED),
            // No scope configured yet — mirrors StaffScopeService's default.
            isNull(StaffScopeModel.id),
            eq(StaffScopeModel.accessScope, 'all_doctors'),
            // Explicitly assigned to this doctor.
            eq(assignment.doctorUserId, doctorId ?? '')
          )
        )
      );

    // The joins can repeat a user across assignment rows.
    const seen = new Map<string, NotificationUser>();
    for (const row of rows) {
      if (!seen.has(row.id)) seen.set(row.id, { ...row, name: row.name ?? '' });
    }
    return [...seen.values()];
  },

  async getStaffByRole(
    clinicId: string,
    roles: string[]
  ): Promise<NotificationUser[]> {
    if (!roles.length) return [];

    const rows = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        userType: UserModel.userType,
      })
      .from(ClinicAssignModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .where(
        and(
          eq(ClinicAssignModel.clinicId, clinicId),
          // Callers pass plain strings; the column is an enum. A role that is
          // not a valid user_type simply matches nothing.
          inArray(UserModel.userType, roles as UserType[])
        )
      );

    return rows.map((r) => ({ ...r, name: r.name ?? '' }));
  },

  async getLabUsers(clinicId: string): Promise<NotificationUser[]> {
    const rows = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        userType: UserModel.userType,
      })
      .from(UserLabAssignmentsModel)
      .innerJoin(UserModel, eq(UserModel.id, UserLabAssignmentsModel.userId))
      .where(eq(UserLabAssignmentsModel.clinicId, clinicId));

    const seen = new Map<string, NotificationUser>();
    for (const row of rows) {
      if (!seen.has(row.id)) seen.set(row.id, { ...row, name: row.name ?? '' });
    }
    return [...seen.values()];
  },

  async getSuperAdmins(): Promise<NotificationUser[]> {
    const rows = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        userType: UserModel.userType,
      })
      .from(UserModel)
      .where(eq(UserModel.userType, 'Super_Admin'));

    return rows.map((r) => ({ ...r, name: r.name ?? '' }));
  },

  /** Keeps only recipients holding the permission the click target needs. */
  async filterByPermission(
    userIds: string[],
    clinicId: string,
    permissionKey: string
  ): Promise<string[]> {
    if (!userIds.length) return [];

    const users = await database
      .select({ id: UserModel.id, userType: UserModel.userType })
      .from(UserModel)
      .where(inArray(UserModel.id, userIds));

    // Role defaults answer most recipients without touching the database at
    // all — a receptionist holding appointment:view by role needs no lookup.
    // Only whoever is left falls through to their granted keys.
    const byRole: string[] = [];
    const needsLookup: { id: string; userType: string }[] = [];

    for (const user of users) {
      if (
        user.userType === 'Super_Admin' ||
        ((ROLE_DEFAULT_PERMISSIONS[user.userType] ?? []) as string[]).includes(
          permissionKey
        )
      ) {
        byRole.push(user.id);
      } else {
        needsLookup.push(user);
      }
    }

    if (!needsLookup.length) return byRole;

    const granted = await Promise.all(
      needsLookup.map(async (user) =>
        (await PermissionService.hasPermission(
          user.id,
          user.userType,
          clinicId,
          permissionKey
        ))
          ? user.id
          : null
      )
    );

    return [...byRole, ...granted.filter((id): id is string => id !== null)];
  },

  async getUserMobiles(userIds: string[]): Promise<Map<string, string>> {
    if (!userIds.length) return new Map();

    const rows = await database
      .select({ id: UserModel.id, mobile: UserModel.mobile })
      .from(UserModel)
      .where(inArray(UserModel.id, userIds));

    const ownMobiles = new Map(
      rows
        .filter((r): r is { id: string; mobile: string } => Boolean(r.mobile))
        .map((r) => [r.id, r.mobile])
    );

    // Dependents have no mobile of their own; resolve those via family links.
    const missingIds = userIds.filter((id) => !ownMobiles.has(id));
    return resolvePatientMobiles(ownMobiles, missingIds);
  },

  async getClinicChannelSettings(
    clinicId: string
  ): Promise<ChannelSettings | null> {
    const [settings] = await database
      .select({
        smsEnabled: ClinicSettingsModel.smsEnabled,
        whatsappEnabled: ClinicSettingsModel.whatsappEnabled,
      })
      .from(ClinicSettingsModel)
      .where(eq(ClinicSettingsModel.clinicId, clinicId))
      .limit(1);

    if (!settings) return null;
    return {
      smsEnabled: settings.smsEnabled ?? false,
      whatsappEnabled: settings.whatsappEnabled ?? false,
    };
  },

  async getAppointmentContext(
    appointmentId: string
  ): Promise<AppointmentContext | null> {
    const doctor = alias(UserModel, 'doctor');
    const patient = alias(UserModel, 'patient');

    const [row] = await database
      .select({
        patientId: AppointmentModel.patientId,
        doctorName: doctor.name,
        patientName: patient.name,
        patientMobile: patient.mobile,
        clinicName: ClinicModel.clinicName,
        appointmentDate: AppointmentModel.appointmentDate,
        appointmentTime: AppointmentModel.appointmentTime,
        tokenNo: AppointmentModel.tokenNo,
      })
      .from(AppointmentModel)
      .leftJoin(doctor, eq(doctor.id, AppointmentModel.doctorId))
      .leftJoin(patient, eq(patient.id, AppointmentModel.patientId))
      .leftJoin(ClinicModel, eq(ClinicModel.id, AppointmentModel.clinicId))
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);

    if (!row) return null;

    const patientMobile = row.patientId
      ? await resolvePatientMobile(row.patientId, row.patientMobile)
      : row.patientMobile;

    return {
      // The doctor is left-joined because appointments.doctor_id is nullable —
      // an unassigned appointment must still produce a usable message.
      doctorName: row.doctorName?.trim() || 'your doctor',
      patientName: row.patientName?.trim() || 'the patient',
      patientMobile,
      clinicName: row.clinicName,
      appointmentDate: row.appointmentDate,
      appointmentTime: row.appointmentTime,
      tokenNo: row.tokenNo,
    };
  },
};
