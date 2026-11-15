import logger from '../utils/logger';
import { CacheKeys, invalidateCacheMany } from '../utils/cache.util';
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
import { seedCredits } from './seeds/credits.seed';
import { seedTreatmentPlan } from './seeds/treatmentPlan.seed';

// Order matters: plan add-on limits look up add_ons rows by featureKey.
const SEEDS: [string, () => Promise<unknown>][] = [
  ['super admin', seedSuperAdmin],
  ['add-ons', seedAddOns],
  ['subscriptions', seedSubscriptions],
  ['patient tests', seedPatientTests],
  ['lab report templates', seedLabReportTemplates],
  ['lab departments', seedLabDepartmentCatalog],
  ['HSN tax master', seedHsnTaxMaster],
  ['cancellation policy', seedCancellationPolicy],
  ['fee configs', seedRazorpayConfig],
  ['permissions', seedPermissions],
  ['credits', seedCredits],
  ['treatment plans', seedTreatmentPlan],
];

/** Runs every seed in order and stops at the first failure, naming it. */
async function main() {
  const started = Date.now();
  logger.info(
    `[seed] starting ${SEEDS.length} seeds (${process.env.NODE_ENV ?? 'unknown'})`
  );
  for (const [name, run] of SEEDS) {
    const t = Date.now();
    try {
      await run();
    } catch (error) {
      logger.error(`[seed] ${name} failed; later seeds were not run`, error);
      process.exit(1);
    }
    logger.debug(`[seed] ${name} took ${Date.now() - t} ms`);
  }
  // Seeds write past the services, so drop the plan and add-on catalogs they cache (failures are logged).
  await invalidateCacheMany([CacheKeys.allPlans, CacheKeys.addOnCatalog]);
  logger.info(`[seed] done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  process.exit(0);
}

main();
