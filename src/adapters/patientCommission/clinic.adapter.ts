import { inArray } from 'drizzle-orm';
import { database } from '../../configurations/dbConnection';
import { ClinicModel } from '../../main/clinic/models/clinic.model';
import type { ClinicPort } from '../../main/patientCommission';
import { UserModel } from '../../main/users/models/user.model';

/** Read-only name lookups for the per-patient pricing screens. */
export const clinicAdapter: ClinicPort = {
  async getClinicNames(clinicIds) {
    if (!clinicIds.length) return new Map();
    const rows = await database
      .select({ id: ClinicModel.id, name: ClinicModel.clinicName })
      .from(ClinicModel)
      .where(inArray(ClinicModel.id, clinicIds));
    return new Map(rows.map((row) => [row.id, row.name ?? 'Unnamed clinic']));
  },

  async getUserNames(userIds) {
    if (!userIds.length) return new Map();
    const rows = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
      })
      .from(UserModel)
      .where(inArray(UserModel.id, userIds));
    return new Map(
      rows.map((row) => [row.id, row.name ?? row.email ?? 'Unknown user'])
    );
  },
};
