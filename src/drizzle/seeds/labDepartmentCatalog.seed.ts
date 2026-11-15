import { eq } from 'drizzle-orm';
import { LabDepartmentsMasterModel } from '../../main/lab/models/lab.model';
import { logSeed, newCounts, syncRow, tally } from './seedSync';

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

/** Departments by code; status is the Super Admin's once created. */
export async function seedLabDepartmentCatalog() {
  const counts = newCounts();
  const changed: string[] = [];
  for (const department of departments) {
    const { result } = await syncRow({
      table: LabDepartmentsMasterModel,
      where: eq(LabDepartmentsMasterModel.code, department.code),
      values: { code: department.code, name: department.name },
      createOnly: { status: 'active' },
    });
    tally(counts, changed, department.code, result);
  }
  logSeed('lab departments', counts, changed);
}
