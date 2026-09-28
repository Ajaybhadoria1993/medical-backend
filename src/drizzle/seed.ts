import logger from '../utils/logger';
import { seedSuperAdmin } from './seeds/superadmin.seed';
import { seedSubscriptions } from './seeds/subscriptions.seed';
import { seedPatientTests } from './seeds/patientTest.seed';
import { seedLabReportTemplates } from './seeds/labReportTemplates.seed';
import { seedLabDepartmentCatalog } from './seeds/labDepartmentCatalog.seed';
import { seedAddOns } from './seeds/addons.seed';
import { seedCancellationPolicy } from './seeds/cancellationPolicy.seed';
import { seedRazorpayConfig } from './seeds/razorpayConfig.seed';
import { seedHsnTaxMaster } from './seeds/hsnTaxMaster.seed';
import { seedPermissions } from './seeds/permissions.seed';

async function main() {
  try {
    logger.info('--- Starting Database Seeding ---');

    await seedSuperAdmin();
    await seedSubscriptions();
    await seedAddOns();
    await seedPatientTests();
    await seedLabReportTemplates();
    await seedLabDepartmentCatalog();
    await seedHsnTaxMaster();
    await seedCancellationPolicy();
    await seedRazorpayConfig();
    await seedPermissions();

    logger.info('--- Database Seeding Completed Successfully ---');
    process.exit(0);
  } catch (error) {
    logger.error('--- Database Seeding Failed ---', error);
    process.exit(1);
  }
}

main();
