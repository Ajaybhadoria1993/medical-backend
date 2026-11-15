import { and, eq, isNull } from 'drizzle-orm';
import { TestCatalogModel } from '../../main/test/models/testCatalog.model';
import { logSeed, newCounts, syncRow, tally } from './seedSync';

const tests = [
  // -------- MD / General Physician --------
  { name: 'CBC', category: 'Blood' },
  { name: 'ESR', category: 'Blood' },
  { name: 'CRP', category: 'Blood' },
  { name: 'Random Blood Sugar', category: 'Blood' },
  { name: 'Fasting Blood Sugar', category: 'Blood' },
  { name: 'Post Prandial Blood Sugar', category: 'Blood' },
  { name: 'HbA1c', category: 'Blood' },
  { name: 'Lipid Profile', category: 'Blood' },
  { name: 'Liver Function Test', category: 'Blood' },
  { name: 'Kidney Function Test', category: 'Blood' },
  { name: 'Serum Electrolytes', category: 'Blood' },
  { name: 'Urine Routine', category: 'Urine' },
  { name: 'Urine Microscopy', category: 'Urine' },
  { name: 'Urine Culture', category: 'Microbiology' },
  { name: 'Blood Culture', category: 'Microbiology' },
  { name: 'Widal Test', category: 'Serology' },
  { name: 'Dengue NS1', category: 'Serology' },
  { name: 'Dengue IgM', category: 'Serology' },
  { name: 'Malaria Antigen', category: 'Serology' },
  { name: 'Procalcitonin', category: 'Blood' },

  // -------- Pulmonology --------
  { name: 'Pulmonary Function Test', category: 'Pulmonology' },
  { name: 'Spirometry', category: 'Pulmonology' },
  { name: 'DLCO', category: 'Pulmonology' },
  { name: 'ABG', category: 'Blood' },
  { name: 'Chest X-Ray', category: 'Radiology' },
  { name: 'HRCT Chest', category: 'Radiology' },
  { name: 'CT Chest', category: 'Radiology' },
  { name: 'Sputum AFB', category: 'Microbiology' },
  { name: 'Sputum Culture', category: 'Microbiology' },
  { name: 'CBNAAT / GeneXpert', category: 'Microbiology' },
  { name: 'Mantoux Test', category: 'Immunology' },
  { name: 'Serum IgE', category: 'Blood' },
  { name: 'Allergy Panel', category: 'Immunology' },
  { name: 'Peak Flow Test', category: 'Pulmonology' },
  { name: 'Six Minute Walk Test', category: 'Pulmonology' },

  // -------- Cardiology --------
  { name: 'ECG', category: 'Cardiology' },
  { name: '2D Echo', category: 'Cardiology' },
  { name: 'Stress Test / TMT', category: 'Cardiology' },
  { name: 'Holter Monitoring', category: 'Cardiology' },
  { name: 'Troponin I', category: 'Blood' },
  { name: 'Troponin T', category: 'Blood' },
  { name: 'CK-MB', category: 'Blood' },
  { name: 'NT-proBNP', category: 'Blood' },
  { name: 'Homocysteine', category: 'Blood' },
  { name: 'CT Coronary Angiography', category: 'Radiology' },
  { name: 'Coronary Angiography', category: 'Cardiology' },
  { name: 'Carotid Doppler', category: 'Radiology' },
  { name: 'BP Holter', category: 'Cardiology' },

  // -------- Dentist --------
  { name: 'OPG X-Ray', category: 'Radiology' },
  { name: 'Intraoral Periapical X-Ray', category: 'Radiology' },
  { name: 'CBCT Scan', category: 'Radiology' },
  { name: 'Dental CT Scan', category: 'Radiology' },
  { name: 'Bleeding Time', category: 'Blood' },
  { name: 'Clotting Time', category: 'Blood' },
  { name: 'PT INR', category: 'Blood' },
  { name: 'APTT', category: 'Blood' },
  { name: 'Factor VIII Assay', category: 'Blood' },
  { name: 'Factor IX Assay', category: 'Blood' },
  { name: 'HBsAg', category: 'Serology' },
  { name: 'HIV 1 & 2', category: 'Serology' },
  { name: 'Anti HCV', category: 'Serology' },
  { name: 'Oral Biopsy', category: 'Histopathology' },
  { name: 'FNAC Oral Lesion', category: 'Histopathology' },

  // -------- Orthopedics --------
  { name: 'X-Ray Knee', category: 'Radiology' },
  { name: 'X-Ray Spine', category: 'Radiology' },
  { name: 'X-Ray Shoulder', category: 'Radiology' },
  { name: 'MRI Knee', category: 'Radiology' },
  { name: 'MRI Spine', category: 'Radiology' },
  { name: 'Vitamin D', category: 'Blood' },
  { name: 'Calcium', category: 'Blood' },
  { name: 'RA Factor', category: 'Blood' },
  { name: 'Anti CCP', category: 'Blood' },
  { name: 'HLA B27', category: 'Blood' },

  // -------- Gynecology --------
  { name: 'Urine Pregnancy Test', category: 'Urine' },
  { name: 'Beta hCG', category: 'Blood' },
  { name: 'Pelvic Ultrasound', category: 'Radiology' },
  { name: 'PAP Smear', category: 'Cytology' },
  { name: 'HPV DNA Test', category: 'Molecular' },
  { name: 'TORCH Profile', category: 'Serology' },
  { name: 'FSH', category: 'Blood' },
  { name: 'LH', category: 'Blood' },
  { name: 'AMH', category: 'Blood' },

  // -------- Neurology --------
  { name: 'MRI Brain', category: 'Radiology' },
  { name: 'CT Brain', category: 'Radiology' },
  { name: 'CT Spine', category: 'Radiology' },
  { name: 'EEG', category: 'Neurology' },
  { name: 'NCV', category: 'Neurology' },
  { name: 'EMG', category: 'Neurology' },
  { name: 'Vitamin B12', category: 'Blood' },

  // -------- Gastro --------
  { name: 'Amylase', category: 'Blood' },
  { name: 'Lipase', category: 'Blood' },
  { name: 'USG Abdomen', category: 'Radiology' },
  { name: 'Upper GI Endoscopy', category: 'Endoscopy' },
  { name: 'Colonoscopy', category: 'Endoscopy' },
  { name: 'Occult Blood Stool', category: 'Stool' },

  // -------- Urology --------
  { name: 'PSA Total', category: 'Blood' },
  { name: 'PSA Free', category: 'Blood' },
  { name: 'Uroflowmetry', category: 'Urology' },
  { name: 'CT KUB', category: 'Radiology' },
  { name: 'Semen Analysis', category: 'Andrology' },

  // -------- Specialty gaps (step I); names need a specialist's check --------
  // Endocrine / Fertility
  { name: 'Thyroid Profile (T3, T4, TSH)', category: 'Blood' },
  { name: 'TSH', category: 'Blood' },
  { name: 'Free T4', category: 'Blood' },
  { name: 'Serum Cortisol', category: 'Blood' },
  { name: 'Serum Prolactin', category: 'Blood' },
  { name: 'PTH', category: 'Blood' },
  { name: 'DEXA Scan', category: 'Radiology' },
  { name: 'HSG', category: 'Radiology' },
  // Blood
  { name: 'Serum Ferritin', category: 'Blood' },
  { name: 'Iron Studies', category: 'Blood' },
  { name: 'Serum Folate', category: 'Blood' },
  { name: 'Peripheral Smear', category: 'Blood' },
  { name: 'Hb Electrophoresis', category: 'Blood' },
  // Kidney / Rheum
  { name: 'Serum Creatinine', category: 'Blood' },
  { name: 'Blood Urea', category: 'Blood' },
  { name: 'Serum Uric Acid', category: 'Blood' },
  { name: 'Urine ACR', category: 'Urine' },
  { name: 'USG KUB', category: 'Radiology' },
  // Gyn
  { name: 'OGTT', category: 'Blood' },
  { name: 'NT Scan', category: 'Radiology' },
  { name: 'Anomaly Scan', category: 'Radiology' },
  { name: 'Growth Scan', category: 'Radiology' },
  // Immunology
  { name: 'ANA', category: 'Immunology' },
  { name: 'Specific IgE Panel', category: 'Immunology' },
  { name: 'Immunoglobulins (IgG, IgA, IgM)', category: 'Immunology' },
  { name: 'Complement C3 / C4', category: 'Immunology' },
  // Oncology
  { name: 'CEA', category: 'Blood' },
  { name: 'CA-125', category: 'Blood' },
  { name: 'CA 19-9', category: 'Blood' },
  { name: 'AFP', category: 'Blood' },
  { name: 'PET-CT', category: 'Radiology' },
  { name: 'Immunohistochemistry (IHC)', category: 'Histopathology' },
  // Psychiatry
  { name: 'Serum Lithium Level', category: 'Blood' },
  { name: 'Serum Valproate Level', category: 'Blood' },
  // Gastro / Chest
  { name: 'FibroScan', category: 'Radiology' },
  { name: 'Urea Breath Test (H. pylori)', category: 'Gastroenterology' },
  { name: 'Sleep Study (Polysomnography)', category: 'Pulmonology' },
  // Eye
  { name: 'OCT', category: 'Ophthalmology' },
  { name: 'Perimetry (Visual Field)', category: 'Ophthalmology' },
  { name: 'Fundus Photography', category: 'Ophthalmology' },
  { name: 'A-Scan Biometry', category: 'Ophthalmology' },
  { name: 'B-Scan Ultrasound', category: 'Ophthalmology' },
  { name: 'Corneal Topography', category: 'Ophthalmology' },
  // ENT
  { name: 'Pure Tone Audiometry', category: 'ENT' },
  { name: 'Tympanometry', category: 'ENT' },
  { name: 'BERA', category: 'ENT' },
  { name: 'CT PNS', category: 'Radiology' },
  // Vascular
  { name: 'Venous Doppler (Legs)', category: 'Radiology' },
  { name: 'Arterial Doppler (Legs)', category: 'Radiology' },
  { name: 'CT Peripheral Angiography', category: 'Radiology' },
  { name: 'Ankle Brachial Index (ABI)', category: 'Cardiology' },
  { name: 'D-Dimer', category: 'Blood' },
  // Derm
  { name: 'KOH Mount', category: 'Dermatology' },
  { name: 'Skin Biopsy', category: 'Histopathology' },
  { name: 'Patch Test', category: 'Dermatology' },
  { name: 'Wood Lamp Examination', category: 'Dermatology' },
  { name: 'Dermoscopy', category: 'Dermatology' },
];

/** Global tests (no clinic) by name; a changed category is updated. */
export async function seedPatientTests() {
  const counts = newCounts();
  const changed: string[] = [];
  for (const test of tests) {
    const { result } = await syncRow({
      table: TestCatalogModel,
      where: and(
        eq(TestCatalogModel.name, test.name),
        isNull(TestCatalogModel.clinicId)
      ),
      values: { name: test.name, category: test.category },
    });
    tally(counts, changed, test.name, result);
  }
  logSeed('patient tests', counts, changed);
}
