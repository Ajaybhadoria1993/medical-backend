import { and, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { database } from '../../configurations/dbConnection';
import { ClinicAssignModel } from '../../main/clinic/models/clinic.model';
import type { PatientPort } from '../../main/treatmentPlan';
import { PatientFamilyLinksModel } from '../../main/patient/models/patientFamilyLinks.model';
import { UserModel } from '../../main/users/models/user.model';
import { UserProfileModel } from '../../main/users/models/userProfile.model';

export const patientAdapter: PatientPort = {
  // Same rule as the clinic's patient list: a patient belongs to a clinic through clinic_assign.
  async getClinicPatient(clinicId, patientId) {
    const [row] = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        allergies: UserProfileModel.allergies,
      })
      .from(UserModel)
      .innerJoin(
        ClinicAssignModel,
        and(
          eq(ClinicAssignModel.userId, UserModel.id),
          eq(ClinicAssignModel.clinicId, clinicId)
        )
      )
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .where(
        and(eq(UserModel.id, patientId), eq(UserModel.userType, 'Patient'))
      )
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name ?? 'Patient',
      allergies: (row.allergies ?? []).filter((a) => !!a?.trim()),
    };
  },

  async getNames(patientIds) {
    if (!patientIds.length) return new Map();
    const rows = await database
      .select({ id: UserModel.id, name: UserModel.name })
      .from(UserModel)
      .where(inArray(UserModel.id, patientIds));
    return new Map(rows.map((r) => [r.id, r.name ?? 'Patient']));
  },

  async getMobiles(clinicId, patientIds) {
    if (!patientIds.length) return new Map();
    // Own mobile, else the primary family contact's when that contact is in the same clinic (as the patient list).
    // "users"."id" spelled out: Drizzle prints ${UserModel.id} as a bare "id", which l and p both have.
    const mobile = sql<string | null>`coalesce(${UserModel.mobile}, (
      select p.mobile from ${PatientFamilyLinksModel} l
      join ${UserModel} p on p.id = l.primary_patient_id
      join ${ClinicAssignModel} c on c.user_id = p.id and c.clinic_id = ${clinicId}
      where l.linked_patient_id = "users"."id" and p.mobile is not null
      limit 1))`;
    const rows = await database
      .select({ id: UserModel.id, mobile })
      .from(UserModel)
      .where(inArray(UserModel.id, patientIds));
    return new Map(
      rows.filter((r) => r.mobile).map((r) => [r.id, r.mobile as string])
    );
  },

  async searchIds(clinicId, q, limit) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await database
      .selectDistinct({ id: UserModel.id })
      .from(UserModel)
      .innerJoin(
        ClinicAssignModel,
        and(
          eq(ClinicAssignModel.userId, UserModel.id),
          eq(ClinicAssignModel.clinicId, clinicId)
        )
      )
      .where(
        and(
          eq(UserModel.userType, 'Patient'),
          or(ilike(UserModel.name, like), ilike(UserModel.mobile, like))
        )
      )
      .limit(limit);
    return rows.map((r) => r.id);
  },
};
