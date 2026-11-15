import { eq } from 'drizzle-orm';
import { database } from '../../configurations/dbConnection';
import { UserModel } from '../../main/users/models/user.model';
import { hashPassword } from '../../utils/authUtils';
import { envConfig } from '../../utils/envConfig';
import logger from '../../utils/logger';

/** Creates the env Super Admin once, or reactivates it; never changes the password. */
export async function seedSuperAdmin() {
  const email = envConfig.SUPER_ADMIN_EMAIL;

  const [existing] = await database
    .select({
      id: UserModel.id,
      userType: UserModel.userType,
      userStatus: UserModel.userStatus,
    })
    .from(UserModel)
    .where(eq(UserModel.email, email))
    .limit(1);

  if (!existing) {
    await database.insert(UserModel).values({
      name: envConfig.SUPER_ADMIN_NAME,
      email,
      password: await hashPassword(envConfig.SUPER_ADMIN_PASSWORD),
      userType: 'Super_Admin',
      userStatus: 'Active',
      emailVerifiedAt: new Date(),
      isAdminDoctorAccess: true,
    });
    logger.info('[seed] super admin: 1 created');
    return;
  }

  // Never promote another account: that would hand Super Admin to whoever owns this email.
  if (existing.userType !== 'Super_Admin') {
    throw new Error(
      `SUPER_ADMIN_EMAIL belongs to a ${existing.userType} account; use a different email for the Super Admin`
    );
  }

  if (existing.userStatus !== 'Active') {
    await database
      .update(UserModel)
      .set({ userStatus: 'Active', updatedAt: new Date() })
      .where(eq(UserModel.id, existing.id));
    logger.warn(
      `[seed] super admin: reactivated (was ${existing.userStatus}); password unchanged`
    );
    return;
  }

  logger.info('[seed] super admin: 0 created, 1 unchanged');
}
