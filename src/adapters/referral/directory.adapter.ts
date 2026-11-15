import { inArray } from 'drizzle-orm';
import { database } from '../../configurations/dbConnection';
import type { DirectoryPort } from '../../main/referral';
import { ClinicModel } from '../../main/clinic/models/clinic.model';
import { UserModel } from '../../main/users/models/user.model';

/** Read-only name lookups for referral lists. */
export const directoryAdapter: DirectoryPort = {
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

  async getUserRoles(userIds) {
    if (!userIds.length) return new Map();
    const rows = await database
      .select({ id: UserModel.id, role: UserModel.userType })
      .from(UserModel)
      .where(inArray(UserModel.id, userIds));
    return new Map(rows.map((row) => [row.id, row.role ?? 'User']));
  },

  async getClinicNames(clinicIds) {
    if (!clinicIds.length) return new Map();
    const rows = await database
      .select({ id: ClinicModel.id, name: ClinicModel.clinicName })
      .from(ClinicModel)
      .where(inArray(ClinicModel.id, clinicIds));
    return new Map(rows.map((row) => [row.id, row.name ?? 'Unnamed clinic']));
  },
};
