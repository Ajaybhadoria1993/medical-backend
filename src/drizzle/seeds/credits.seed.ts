import { seedCreditPacks, seedCreditSettings } from '../../main/credits';
import logger from '../../utils/logger';

/** Both entry points add only what is missing and return how many they added. */
export async function seedCredits() {
  const settings = await seedCreditSettings();
  const packs = await seedCreditPacks();
  logger.info(
    `[seed] credits: ${settings} setting type(s) and ${packs} pack type(s) created`
  );
}
