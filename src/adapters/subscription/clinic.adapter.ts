import { eq, inArray } from 'drizzle-orm';
import { database } from '../../configurations/dbConnection';
import type { ClinicPort } from '../../main/subscription';
import { ClinicModel } from '../../main/clinic/models/clinic.model';
import { UserModel } from '../../main/users/models/user.model';

/** Read-only clinic lookups for subscription billing. */
export const clinicAdapter: ClinicPort = {
  async getClinics(clinicIds) {
    const ids = [...new Set(clinicIds)];
    if (!ids.length) return new Map();
    const rows = await database
      .select({
        id: ClinicModel.id,
        name: ClinicModel.clinicName,
        code: ClinicModel.clinicCode,
        phone: ClinicModel.clinicPhone,
        ownerUserId: ClinicModel.userId,
      })
      .from(ClinicModel)
      .where(inArray(ClinicModel.id, ids));
    return new Map(
      rows.map(({ id, ...c }) => [
        id,
        {
          name: c.name,
          code: c.code,
          phone: c.phone,
          ownerUserId: c.ownerUserId,
        },
      ])
    );
  },

  async getBillingParty(clinicId) {
    const [row] = await database
      .select({
        name: ClinicModel.clinicName,
        address: ClinicModel.clinicAddress,
        city: ClinicModel.City,
        state: ClinicModel.State,
        zip: ClinicModel.ZipCode,
      })
      .from(ClinicModel)
      .where(eq(ClinicModel.id, clinicId))
      .limit(1);
    return row ? { ...row, zip: row.zip ? String(row.zip) : null } : null;
  },

  async getOwnerContact(clinicId) {
    const [row] = await database
      .select({
        phone: ClinicModel.clinicPhone,
        email: UserModel.email,
        mobile: UserModel.mobile,
      })
      .from(ClinicModel)
      .leftJoin(UserModel, eq(UserModel.id, ClinicModel.userId))
      .where(eq(ClinicModel.id, clinicId))
      .limit(1);
    const phone = row?.phone ?? row?.mobile;
    return row?.email && phone ? { email: row.email, phone } : null;
  },

  async isApproved(clinicId) {
    const [row] = await database
      .select({ status: UserModel.userStatus })
      .from(ClinicModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicModel.userId))
      .where(eq(ClinicModel.id, clinicId))
      .limit(1);
    return row?.status === 'Active';
  },
};
