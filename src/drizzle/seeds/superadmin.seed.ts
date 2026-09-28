import { database } from '../../configurations/dbConnection';
import { UserModel } from '../../main/users/models/user.model';
import { hashPassword } from '../../utils/authUtils';
import { envConfig } from '../../utils/envConfig';
import logger from '../../utils/logger';
import { eq } from 'drizzle-orm';

export async function seedSuperAdmin() {
  try {
    logger.info('Seeding superadmin credentials...');

    const superAdminEmail = envConfig.SUPER_ADMIN_EMAIL;
    const superAdminName = envConfig.SUPER_ADMIN_NAME;
    const superAdminPassword = envConfig.SUPER_ADMIN_PASSWORD;

    // Check if superadmin already exists
    const existingAdmin = await database
      .select()
      .from(UserModel)
      .where(eq(UserModel.email, superAdminEmail))
      .limit(1);

    if (existingAdmin.length > 0) {
      logger.info('Superadmin already exists. Skipping...');
      return;
    }

    const hashedPassword = await hashPassword(superAdminPassword);

    await database.insert(UserModel).values({
      name: superAdminName,
      email: superAdminEmail,
      password: hashedPassword,
      userType: 'Super_Admin',
      userStatus: 'Active',
      emailVerifiedAt: new Date(),
      isAdminDoctorAccess: true,
    });

    logger.info('Superadmin seeded successfully!');
  } catch (error) {
    logger.error('Error seeding superadmin:', error);
    throw error;
  }
}
