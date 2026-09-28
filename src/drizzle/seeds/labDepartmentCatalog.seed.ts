import { database } from '../../configurations/dbConnection';
import { LabDepartmentsMasterModel } from '../../main/lab/models/lab.model';
import logger from '../../utils/logger';

const departments = [
  { name: 'Hematology', code: 'HEMATOLOGY' },
  { name: 'Biochemistry', code: 'BIOCHEMISTRY' },
  { name: 'Clinical Pathology', code: 'CLINICAL_PATHOLOGY' },
  { name: 'Microbiology', code: 'MICROBIOLOGY' },
  { name: 'Serology / Immunology', code: 'SEROLOGY_IMMUNOLOGY' },
  { name: 'Coagulation', code: 'COAGULATION' },
  { name: 'Parasitology', code: 'PARASITOLOGY' },
  { name: 'Histopathology', code: 'HISTOPATHOLOGY' },
  { name: 'Cytology', code: 'CYTOLOGY' },
  { name: 'Molecular Diagnostics', code: 'MOLECULAR_DIAGNOSTICS' },
  { name: 'Blood Bank', code: 'BLOOD_BANK' },
];

export async function seedLabDepartmentCatalog() {
  try {
    logger.info('Seeding lab department catalog...');

    for (const department of departments) {
      await database
        .insert(LabDepartmentsMasterModel)
        .values({
          name: department.name,
          code: department.code,
          status: 'active',
        })
        .onConflictDoUpdate({
          target: LabDepartmentsMasterModel.code,
          set: {
            name: department.name,
            status: 'active',
            updatedAt: new Date(),
          },
        });
    }

    logger.info('Lab department catalog seeded successfully');
  } catch (error) {
    logger.error('Error seeding lab department catalog', error);
    throw error;
  }
}
