import logger from '../../utils/logger';
import { database } from '../../configurations/dbConnection';
import { HsnTaxMasterModel } from '../../main/pharmacy/models/inventoryMasters.model';

export async function seedHsnTaxMaster() {
  try {
    logger.info('Seeding HSN tax master...');

    const rows = [
      {
        hsnCode: '3001',
        gstPercentage: '12',
        description: 'Glands & organo-therapeutic products',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3002',
        gstPercentage: '0',
        description: 'Human blood & components',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3002',
        gstPercentage: '5',
        description: 'Vaccines (animal/human blood vaccines)',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3002',
        gstPercentage: '12',
        description: 'Antisera, blood fractions, toxins, cultures',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3003',
        gstPercentage: '12',
        description: 'Bulk/unpackaged medicaments',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3004',
        gstPercentage: '0',
        description: 'Life-saving drugs',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3004',
        gstPercentage: '5',
        description: 'Insulin formulations',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3004',
        gstPercentage: '5',
        description: 'Most finished medicines (general formulations)',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3004',
        gstPercentage: '5',
        description:
          'Ayurvedic, Unani, Siddha, Homeopathic, Biochemic (retail pack)',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3004',
        gstPercentage: '5',
        description: 'Veterinary medicaments (retail pack)',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3004',
        gstPercentage: '5',
        description: 'Hormones, steroids, alkaloids, vitamins',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3004',
        gstPercentage: '5',
        description: 'Nutraceuticals & vitamin supplements (non-essential)',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3005',
        gstPercentage: '5',
        description: 'Wadding, gauze, bandages, dressings',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3006',
        gstPercentage: '0',
        description: 'Contraceptives (all types)',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3006',
        gstPercentage: '12',
        description:
          'Sterile surgical catgut, sutures, tissue adhesives, haemostatics',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3006',
        gstPercentage: '12',
        description: 'Waste pharmaceuticals',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '28044010',
        gstPercentage: '5',
        description: 'Medical grade oxygen',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '2847',
        gstPercentage: '5',
        description: 'Hydrogen peroxide (medicinal grade)',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '2933',
        gstPercentage: '18',
        description: 'Active pharmaceutical ingredients (APIs)',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3822',
        gstPercentage: '5',
        description: 'Diagnostic kits & reagents',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3301',
        gstPercentage: '5',
        description: 'Essential oils (medicinal use)',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3304',
        gstPercentage: '18',
        description: 'Skin care cosmetics (non-medicated)',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3305',
        gstPercentage: '18',
        description: 'Hair care products',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3306',
        gstPercentage: '18',
        description: 'Oral hygiene products (non-medicated)',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3307',
        gstPercentage: '18',
        description: 'Shaving preparations, deodorants',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3401',
        gstPercentage: '5',
        description: 'Toilet soap (ordinary, non-medicated)',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3401',
        gstPercentage: '18',
        description: 'Toilet soap (medicated/therapeutic)',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3401',
        gstPercentage: '9',
        description: 'Liquid hand wash / body wash',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3401',
        gstPercentage: '9',
        description: 'Industrial / laundry soap',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '9004',
        gstPercentage: '5',
        description: 'Corrective spectacles & goggles',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '9018',
        gstPercentage: '5',
        description: 'Medical/surgical instruments & devices',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '9018',
        gstPercentage: '5',
        description: 'Implants (stents, artificial kidneys)',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '9019',
        gstPercentage: '5',
        description: 'Therapy & respiratory apparatus',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '9020',
        gstPercentage: '5',
        description: 'Breathing appliances',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '9021',
        gstPercentage: '5',
        description: 'Orthopaedic & fracture appliances',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '9022',
        gstPercentage: '5',
        description: 'X-ray & radiation apparatus',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '9025',
        gstPercentage: '5',
        description: 'Medical thermometers',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '9027',
        gstPercentage: '5',
        description: 'Analysis instruments (medical use)',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '4015',
        gstPercentage: '5',
        description: 'Surgical / medical examination gloves',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '3926',
        gstPercentage: '12',
        description: 'Plastic medical consumables',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '4818',
        gstPercentage: '0',
        description: 'Sanitary napkins & tampons',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '4818',
        gstPercentage: '5',
        description: 'Tissues & paper wipes (medicated)',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '4818',
        gstPercentage: '12',
        description: 'Tissues & paper wipes (non-medicated)',
        effectiveFrom: '2024-01-01',
      },
      {
        hsnCode: '98041000',
        gstPercentage: '5',
        description: 'Drugs & medicines (personal import)',
        effectiveFrom: '2024-01-01',
      },
    ];

    await database
      .insert(HsnTaxMasterModel)
      .values(rows)
      .onConflictDoNothing({
        target: [HsnTaxMasterModel.hsnCode, HsnTaxMasterModel.effectiveFrom],
      });

    logger.info('HSN tax master seeded successfully!');
  } catch (error) {
    logger.error('Error seeding HSN tax master', error);
    throw error;
  }
}
