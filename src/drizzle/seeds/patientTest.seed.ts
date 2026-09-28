import { database } from '../../configurations/dbConnection';
import { TestCatalogModel } from '../../main/test/models/testCatalog.model';
import logger from '../../utils/logger';

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
  { name: 'HBsAg', category: 'Serology' },
  { name: 'HIV 1 & 2', category: 'Serology' },
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
];

export async function seedPatientTests() {
  try {
    logger.info('Seeding patient tests...');

    for (const test of tests) {
      await database
        .insert(TestCatalogModel)
        .values({
          name: test.name,
          category: test.category,
        })
        .onConflictDoNothing();
    }

    logger.info('Patient tests seeded successfully');
  } catch (error) {
    logger.error('Error seeding patient tests', error);
    throw error;
  }
}
