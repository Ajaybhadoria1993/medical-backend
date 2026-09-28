import { and, asc, eq, inArray, isNull, or, sql, SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { database } from '../../../configurations/dbConnection';
import { pagination } from '../../../utils/utils';
import { LabsModel, UserLabAssignmentsModel } from '../../lab/models/lab.model';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import {
  StaffDoctorAssignmentModel,
  StaffScopeModel,
} from '../../permissions/models/staffAssignment.model';
import {
  PharmacyAssignModel,
  PharmacyModel,
} from '../../pharmacy/models/pharmacy.model';
import { UserModel } from '../models/user.model';
import { UserProfessionalModel } from '../models/userProfessional.model';
import { UserProfileModel } from '../models/userProfile.model';
import { StaffDirectoryQueryDto } from '../schemas/staffDirectory.schema';
import {
  StaffDirectoryFilterOptions,
  StaffDirectoryResult,
  StaffDirectorySummary,
  StaffDirectoryRole,
  StaffDirectoryRow,
} from '../types/staffDirectory.types';
import { ROLE_FILTERS, escapeLike } from '../utils/staffDirectory.utils';

// Separate from getAllUser so that endpoint's other consumers do not pay for
// lab/pharmacy/assignment joins they never read. The requested role decides
// which joins run at all.
export class StaffDirectoryService {
  static async list(
    clinicId: string,
    query: StaffDirectoryQueryDto
  ): Promise<StaffDirectoryResult> {
    const role = query.role as StaffDirectoryRole;
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.max(query.pageSize ?? 10, 1);
    const { limit, offset } = pagination(page, pageSize);

    const conditions: SQL[] = [eq(ClinicAssignModel.clinicId, clinicId)];

    // An Admin with doctor access is listed among the doctors.
    if (role === 'Doctor') {
      const doctorCondition = or(
        eq(UserModel.userType, 'Doctor'),
        eq(UserModel.isAdminDoctorAccess, true)
      );
      if (doctorCondition) conditions.push(doctorCondition);
    } else {
      conditions.push(eq(UserModel.userType, role));
    }

    if (query.status) {
      conditions.push(eq(UserModel.userStatus, query.status));
    }

    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`.toLowerCase();
      const searchCondition = or(
        sql`lower(${UserModel.name}) LIKE ${pattern}`,
        sql`lower(${UserModel.email}) LIKE ${pattern}`,
        sql`lower(${UserModel.mobile}) LIKE ${pattern}`
      );
      if (searchCondition) conditions.push(searchCondition);
    }

    if (role === 'Doctor' && query.speciality) {
      conditions.push(eq(UserProfessionalModel.speciality, query.speciality));
    }

    const supportsScope = ROLE_FILTERS[role].includes('location');
    const supportsAssignedDoctor =
      ROLE_FILTERS[role].includes('assignedDoctor');
    // Column data, not filter-driven: `lab`/`pharmacy` were removed from
    // ROLE_FILTERS (a clinic has at most one of each, so filtering by it is
    // meaningless) but the table still shows which lab/pharmacy a person
    // belongs to, so that join must not be gated on the filter list.
    const showsLabColumn = role === 'Lab_Assistant';
    const showsPharmacyColumn = role === 'Pharmacist';
    const supportsLab = ROLE_FILTERS[role].includes('lab');
    const supportsPharmacy = ROLE_FILTERS[role].includes('pharmacy');

    if (supportsScope && query.location) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${StaffScopeModel} ss
            WHERE ss.user_id = ${UserModel.id}
              AND ss.clinic_id = ${clinicId}
              AND ss.location = ${query.location})`
      );
    }

    if (supportsAssignedDoctor && query.assignedDoctorId) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${StaffDoctorAssignmentModel} sda
            WHERE sda.staff_user_id = ${UserModel.id}
              AND sda.clinic_id = ${clinicId}
              AND sda.doctor_user_id = ${query.assignedDoctorId})`
      );
    }

    if (supportsLab && query.labId) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${UserLabAssignmentsModel} ula
            WHERE ula.user_id = ${UserModel.id}
              AND ula.clinic_id = ${clinicId}
              AND ula.lab_id = ${query.labId})`
      );
    }

    if (supportsPharmacy && query.pharmacyId) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${PharmacyAssignModel} pa
            WHERE pa.user_id = ${UserModel.id}
              AND pa.clinic_id = ${clinicId}
              AND pa.pharmacy_id = ${query.pharmacyId})`
      );
    }

    const whereClause = and(...conditions);

    const [countRow] = await database
      .select({ count: sql<number>`COUNT(DISTINCT ${UserModel.id})::int` })
      .from(ClinicAssignModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .leftJoin(
        UserProfessionalModel,
        eq(UserProfessionalModel.userId, UserModel.id)
      )
      .where(whereClause);

    const totalRecords = Number(countRow?.count ?? 0);

    const baseRows = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
        mobile: UserModel.mobile,
        profileImage: UserProfileModel.profileImage,
        status: UserModel.userStatus,
        userType: UserModel.userType,
        isAdminDoctorAccess: UserModel.isAdminDoctorAccess,
        isArchive: UserModel.isArchive,
        createdAt: UserModel.createdAt,
        speciality: UserProfessionalModel.speciality,
      })
      .from(ClinicAssignModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .leftJoin(
        UserProfessionalModel,
        eq(UserProfessionalModel.userId, UserModel.id)
      )
      .where(whereClause)
      .orderBy(asc(UserModel.name))
      .limit(limit)
      .offset(offset);

    const userIds = baseRows.map((row) => row.id);

    const rows: StaffDirectoryRow[] = baseRows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      mobile: row.mobile,
      profileImage: row.profileImage,
      status: row.status,
      userType: row.userType,
      isAdminDoctorAccess: row.isAdminDoctorAccess === true,
      isArchive: row.isArchive === true,
      createdAt: row.createdAt,
      ...(role === 'Doctor' ? { speciality: row.speciality } : {}),
    }));

    const rowById = new Map(rows.map((row) => [row.id, row]));

    // Second pass rather than a join: a staff member with three doctors would
    // otherwise become three rows and break the page size.
    if (userIds.length && supportsAssignedDoctor) {
      const doctorUser = alias(UserModel, 'assigned_doctor_user');
      const assignments = await database
        .select({
          staffUserId: StaffDoctorAssignmentModel.staffUserId,
          doctorId: StaffDoctorAssignmentModel.doctorUserId,
          doctorName: doctorUser.name,
        })
        .from(StaffDoctorAssignmentModel)
        .leftJoin(
          doctorUser,
          eq(doctorUser.id, StaffDoctorAssignmentModel.doctorUserId)
        )
        .where(
          and(
            eq(StaffDoctorAssignmentModel.clinicId, clinicId),
            inArray(StaffDoctorAssignmentModel.staffUserId, userIds)
          )
        );

      for (const row of rows) row.assignedDoctors = [];
      for (const assignment of assignments) {
        rowById.get(assignment.staffUserId)?.assignedDoctors?.push({
          id: assignment.doctorId,
          name: assignment.doctorName,
        });
      }
    }

    if (userIds.length && supportsScope) {
      const scopes = await database
        .select({
          userId: StaffScopeModel.userId,
          location: StaffScopeModel.location,
          accessScope: StaffScopeModel.accessScope,
        })
        .from(StaffScopeModel)
        .where(
          and(
            eq(StaffScopeModel.clinicId, clinicId),
            inArray(StaffScopeModel.userId, userIds)
          )
        );

      // No row means no admin has configured this staff member yet — same
      // convention as StaffScopeService.getScope: they keep the clinic-wide
      // view they had before assignments existed.
      for (const row of rows) {
        row.location = null;
        row.assignedDoctorsScope = 'all_doctors';
      }
      for (const scope of scopes) {
        const row = rowById.get(scope.userId);
        if (row) {
          row.location = scope.location;
          row.assignedDoctorsScope = scope.accessScope;
        }
      }
    }

    if (userIds.length && showsLabColumn) {
      const labs = await database
        .select({
          userId: UserLabAssignmentsModel.userId,
          labId: LabsModel.id,
          labName: LabsModel.name,
        })
        .from(UserLabAssignmentsModel)
        .innerJoin(LabsModel, eq(LabsModel.id, UserLabAssignmentsModel.labId))
        .where(
          and(
            eq(UserLabAssignmentsModel.clinicId, clinicId),
            inArray(UserLabAssignmentsModel.userId, userIds)
          )
        );

      for (const row of rows) row.lab = null;
      for (const lab of labs) {
        const row = rowById.get(lab.userId);
        if (row && !row.lab) row.lab = { id: lab.labId, name: lab.labName };
      }
    }

    if (userIds.length && showsPharmacyColumn) {
      const pharmacies = await database
        .select({
          userId: PharmacyAssignModel.userId,
          pharmacyId: PharmacyModel.id,
          pharmacyName: PharmacyModel.name,
        })
        .from(PharmacyAssignModel)
        .innerJoin(
          PharmacyModel,
          eq(PharmacyModel.id, PharmacyAssignModel.pharmacyId)
        )
        .where(
          and(
            eq(PharmacyAssignModel.clinicId, clinicId),
            inArray(PharmacyAssignModel.userId, userIds)
          )
        );

      for (const row of rows) row.pharmacy = null;
      for (const pharmacy of pharmacies) {
        const row = rowById.get(pharmacy.userId);
        if (row && !row.pharmacy) {
          row.pharmacy = {
            id: pharmacy.pharmacyId,
            name: pharmacy.pharmacyName,
          };
        }
      }
    }

    // Independent of each other, so awaiting them inside the object literal
    // just serialised two round trips for no reason.
    const [summary, filterOptions] = await Promise.all([
      this.buildSummary(clinicId, role),
      this.buildFilterOptions(clinicId, role),
    ]);

    return {
      users: rows,
      summary,
      filterOptions,
      availableFilters: [...ROLE_FILTERS[role]],
      pagination: {
        page,
        pageSize,
        totalRecords,
        totalPages: Math.ceil(totalRecords / pageSize) || 0,
      },
    };
  }

  // Counted over the whole role and deliberately not narrowed by the active
  // filters, so the cards describe the role rather than the current view.
  private static async buildSummary(
    clinicId: string,
    role: StaffDirectoryRole
  ): Promise<StaffDirectorySummary> {
    const roleCondition =
      role === 'Doctor'
        ? or(
            eq(UserModel.userType, 'Doctor'),
            eq(UserModel.isAdminDoctorAccess, true)
          )
        : eq(UserModel.userType, role);

    const [row] = await database
      .select({
        total: sql<number>`COUNT(DISTINCT ${UserModel.id})::int`,
        active: sql<number>`COUNT(DISTINCT ${UserModel.id}) FILTER (WHERE ${UserModel.userStatus} = 'Active')::int`,
        inactive: sql<number>`COUNT(DISTINCT ${UserModel.id}) FILTER (WHERE ${UserModel.userStatus} = 'Inactive')::int`,
        rejected: sql<number>`COUNT(DISTINCT ${UserModel.id}) FILTER (WHERE ${UserModel.userStatus} = 'Rejected')::int`,
        newThisMonth: sql<number>`COUNT(DISTINCT ${UserModel.id}) FILTER (WHERE date_trunc('month', ${UserModel.createdAt}) = date_trunc('month', now()))::int`,
      })
      .from(ClinicAssignModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .where(and(eq(ClinicAssignModel.clinicId, clinicId), roleCondition));

    return {
      total: Number(row?.total ?? 0),
      active: Number(row?.active ?? 0),
      inactive: Number(row?.inactive ?? 0),
      rejected: Number(row?.rejected ?? 0),
      newThisMonth: Number(row?.newThisMonth ?? 0),
    };
  }

  // Clinic-wide rather than page-derived, so a dropdown offers the same choices
  // however the list is paged or filtered.
  private static async buildFilterOptions(
    clinicId: string,
    role: StaffDirectoryRole
  ): Promise<StaffDirectoryFilterOptions> {
    const filters = ROLE_FILTERS[role];
    const options: StaffDirectoryFilterOptions = {};

    if (filters.includes('speciality')) {
      const rows = await database
        .selectDistinct({ speciality: UserProfessionalModel.speciality })
        .from(ClinicAssignModel)
        .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
        .innerJoin(
          UserProfessionalModel,
          eq(UserProfessionalModel.userId, UserModel.id)
        )
        .where(
          and(
            eq(ClinicAssignModel.clinicId, clinicId),
            or(
              eq(UserModel.userType, 'Doctor'),
              eq(UserModel.isAdminDoctorAccess, true)
            )
          )
        );

      options.speciality = rows
        .map((row) => String(row.speciality ?? '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ label: value, value }));
    }

    if (filters.includes('assignedDoctor')) {
      const doctorUser = alias(UserModel, 'assigned_doctor_option');
      const rows = await database
        .selectDistinct({
          id: StaffDoctorAssignmentModel.doctorUserId,
          name: doctorUser.name,
        })
        .from(StaffDoctorAssignmentModel)
        .leftJoin(
          doctorUser,
          eq(doctorUser.id, StaffDoctorAssignmentModel.doctorUserId)
        )
        .where(eq(StaffDoctorAssignmentModel.clinicId, clinicId));

      options.assignedDoctor = rows
        .filter((row) => row.id)
        .map((row) => ({ label: row.name ?? 'Unnamed doctor', value: row.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }

    if (filters.includes('location')) {
      const rows = await database
        .selectDistinct({ location: StaffScopeModel.location })
        .from(StaffScopeModel)
        .where(eq(StaffScopeModel.clinicId, clinicId));

      options.location = rows
        .map((row) => String(row.location ?? '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ label: value, value }));
    }

    if (filters.includes('lab')) {
      const rows = await database
        .select({ id: LabsModel.id, name: LabsModel.name })
        .from(LabsModel)
        .where(
          and(eq(LabsModel.clinicId, clinicId), isNull(LabsModel.deletedAt))
        )
        .orderBy(asc(LabsModel.name));

      options.lab = rows.map((row) => ({ label: row.name, value: row.id }));
    }

    if (filters.includes('pharmacy')) {
      const rows = await database
        .select({ id: PharmacyModel.id, name: PharmacyModel.name })
        .from(PharmacyModel)
        .where(
          and(
            eq(PharmacyModel.clinicId, clinicId),
            eq(PharmacyModel.isDeleted, false)
          )
        )
        .orderBy(asc(PharmacyModel.name));

      options.pharmacy = rows.map((row) => ({
        label: row.name,
        value: row.id,
      }));
    }

    return options;
  }
}
