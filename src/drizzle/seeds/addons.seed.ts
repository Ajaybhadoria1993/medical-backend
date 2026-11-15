import { database } from '../../configurations/dbConnection';
import { AddOnModel } from '../../main/subscription/models/addon.model';
import { eq } from 'drizzle-orm';
import { logSeed, newCounts, syncRow, tally } from './seedSync';

interface AddOnSeed {
  name: string;
  description: string;
  featureKey: string;
  unitValue: number;
  monthlyPrice: string;
  yearlyPrice: string;
  currency: string;
  isActive: boolean;
}

const defaultAddOns: AddOnSeed[] = [
  {
    name: 'Additional Doctor',
    description: 'Add 1 extra doctor account to your clinic',
    featureKey: 'additional_doctor',
    unitValue: 1,
    monthlyPrice: '499.00',
    yearlyPrice: '5988.00', // 499 * 12 (No discount)
    currency: 'INR',
    isActive: true,
  },
  {
    name: 'Additional Staff Member',
    description:
      'Add 1 extra staff account (Receptionist, Nurse, Pharmacist, Lab Assistant, Radiologist)',
    featureKey: 'additional_staff',
    unitValue: 1,
    monthlyPrice: '99.00',
    yearlyPrice: '1188.00', // 99 * 12 (No discount)
    currency: 'INR',
    isActive: true,
  },
  {
    name: 'Additional 1 GB Storage',
    description: 'Increase your storage capacity by 1GB',
    featureKey: 'additional_storage',
    unitValue: 1024, // 1024 MB (1 GB)
    monthlyPrice: '199.00',
    yearlyPrice: '2388.00', // 199 * 12 (No discount)
    currency: 'INR',
    isActive: true,
  },
  {
    name: 'Additional Branch',
    description: 'Add support for 1 additional clinic branch',
    featureKey: 'additional_branch',
    unitValue: 1,
    monthlyPrice: '999.00',
    yearlyPrice: '11988.00', // 999 * 12 (No discount)
    currency: 'INR',
    isActive: true,
  },
];

/** Add-ons by featureKey; name, prices and on/off are the Super Admin's once created. */
export async function seedAddOns() {
  const counts = newCounts();
  const changed: string[] = [];
  for (const addOn of defaultAddOns) {
    const { result } = await syncRow({
      table: AddOnModel,
      where: eq(AddOnModel.featureKey, addOn.featureKey),
      values: {
        featureKey: addOn.featureKey,
        unitValue: addOn.unitValue,
        currency: addOn.currency,
      },
      createOnly: {
        name: addOn.name,
        description: addOn.description,
        monthlyPrice: addOn.monthlyPrice,
        yearlyPrice: addOn.yearlyPrice,
        isActive: addOn.isActive,
      },
    });
    tally(counts, changed, addOn.featureKey, result);
  }
  logSeed('add-ons', counts, changed);
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
