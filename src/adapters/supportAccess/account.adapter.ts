import { eq, inArray } from 'drizzle-orm';
import { database } from '../../configurations/dbConnection';
import type { AccountPort } from '../../main/supportAccess';
import { UserModel } from '../../main/users/models/user.model';
import { findUserClinic } from '../../utils/userClinic';

/** Read-only user lookups for the supportAccess module. */
export const accountAdapter: AccountPort = {
  async getUser(userId) {
    const [row] = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
        userType: UserModel.userType,
        userStatus: UserModel.userStatus,
        emailVerifiedAt: UserModel.emailVerifiedAt,
      })
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);
    return row ?? null;
  },

  async getUserClinicId(userId, userType) {
    return (await findUserClinic(userId, userType))?.clinicId ?? null;
  },

  async getUserNames(userIds) {
    if (!userIds.length) return new Map();
    const rows = await database
      .select({ id: UserModel.id, name: UserModel.name })
      .from(UserModel)
      .where(inArray(UserModel.id, userIds));
    return new Map(rows.map((r) => [r.id, r.name ?? 'Unnamed user']));
  },
};
