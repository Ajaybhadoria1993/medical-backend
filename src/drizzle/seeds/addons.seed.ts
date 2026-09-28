import { database } from '../../configurations/dbConnection';
import { AddOnModel } from '../../main/subscription/models/addon.model';
import { eq } from 'drizzle-orm';
import logger from '../../utils/logger';

interface AddOnSeed {
  name: string;
  description: string;
  featureKey: string;
  unitValue: number;
  monthlyPrice: string;
  yearlyPrice: string;
  currency: string;
  maxCap?: number | null;
  isActive: boolean;
}

const defaultAddOns: AddOnSeed[] = [
  {
    name: 'Additional Doctor',
    description: 'Add 1 extra doctor account to your clinic',
    featureKey: 'additional_doctor',
    unitValue: 1,
    monthlyPrice: '499.00',
    yearlyPrice: '4790.00', // 20% discount (499 * 12 * 0.8)
    currency: 'INR',
    maxCap: 9, // Max total doctor accounts = 9
    isActive: true,
  },
  {
    name: 'Additional Staff Member',
    description:
      'Add 1 extra staff account (Receptionist, Nurse, Pharmacist, Lab Assistant, Radiologist)',
    featureKey: 'additional_staff',
    unitValue: 1,
    monthlyPrice: '99.00',
    yearlyPrice: '950.00', // 20% discount (99 * 12 * 0.8)
    currency: 'INR',
    maxCap: 20, // Max total staff accounts = 20
    isActive: true,
  },
  {
    name: 'Additional 1 GB Storage',
    description: 'Increase your storage capacity by 1GB',
    featureKey: 'additional_storage',
    unitValue: 1024, // 1024 MB (1 GB)
    monthlyPrice: '199.00',
    yearlyPrice: '1910.00', // 20% discount (199 * 12 * 0.8)
    currency: 'INR',
    maxCap: 5120, // Max total storage = 5 GB (5120 MB)
    isActive: true,
  },
  {
    name: 'Additional Branch',
    description: 'Add support for 1 additional clinic branch',
    featureKey: 'additional_branch',
    unitValue: 1,
    monthlyPrice: '999.00',
    yearlyPrice: '9590.00', // 20% discount (999 * 12 * 0.8)
    currency: 'INR',
    maxCap: null, // No cap limit
    isActive: true,
  },
];

/**
 * Seed default add-ons into the database
 */
export async function seedAddOns() {
  try {
    logger.info('Seeding default add-ons...');

    for (const addOn of defaultAddOns) {
      // Check if add-on with this featureKey already exists
      const [existing] = await database
        .select({ id: AddOnModel.id })
        .from(AddOnModel)
        .where(eq(AddOnModel.featureKey, addOn.featureKey))
        .limit(1);

      if (existing) {
        // Update existing add-on
        await database
          .update(AddOnModel)
          .set({
            name: addOn.name,
            description: addOn.description,
            unitValue: addOn.unitValue,
            monthlyPrice: addOn.monthlyPrice,
            yearlyPrice: addOn.yearlyPrice,
            currency: addOn.currency,
            maxCap: addOn.maxCap ?? null,
            isActive: addOn.isActive,
            updatedAt: new Date(),
          })
          .where(eq(AddOnModel.id, existing.id));

        logger.info(`  ↻ Updated add-on: ${addOn.name}`);
      } else {
        // Create new add-on
        await database.insert(AddOnModel).values({
          name: addOn.name,
          description: addOn.description,
          featureKey: addOn.featureKey,
          unitValue: addOn.unitValue,
          monthlyPrice: addOn.monthlyPrice,
          yearlyPrice: addOn.yearlyPrice,
          currency: addOn.currency,
          maxCap: addOn.maxCap ?? null,
          isActive: addOn.isActive,
        });

        logger.info(`  ✓ Created add-on: ${addOn.name}`);
      }
    }

    logger.info('Default add-ons seeded successfully!');
  } catch (error) {
    logger.error('Error seeding add-ons:', error);
    throw error;
  }
}

/**
 * Get seeded add-on IDs (useful for testing)
 */
export async function getAddOnIds(): Promise<Record<string, string>> {
  const addOns = await database.select().from(AddOnModel);
  const ids: Record<string, string> = {};

  for (const addOn of addOns) {
    ids[addOn.featureKey] = addOn.id;
  }

  return ids;
}
