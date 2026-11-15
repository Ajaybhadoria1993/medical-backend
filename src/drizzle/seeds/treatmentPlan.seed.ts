import {
  seedTreatmentSpecialtyConfigs,
  seedTreatmentTemplates,
} from '../../main/treatmentPlan';
import logger from '../../utils/logger';

/** Both entry points add only what is missing and return how many they added. */
export async function seedTreatmentPlan() {
  const templates = await seedTreatmentTemplates();
  const fieldSets = await seedTreatmentSpecialtyConfigs();
  logger.info(
    `[seed] treatment plans: ${templates} template(s) and ${fieldSets} specialty field set(s) created`
  );
}
