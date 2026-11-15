import { z } from 'zod';

interface QualificationCategory {
  code: string;
  label: string;
  /** Orders "highest qualification"; 0 = pursuing, never counted as highest. */
  rank: number;
  degrees: readonly string[];
}

/** Served by `GET /api/v1/doctor/qualifications`; source: doctor_qualifications_8.xlsx.
 *  The label is stored in `qualification_title`, the degree in `qualification_type`. */
export const QUALIFICATION_CATALOG: readonly QualificationCategory[] = [
  {
    code: 'UG',
    label: 'Undergraduate (UG)',
    rank: 1,
    degrees: ['MBBS', 'BDS', 'BAMS', 'BUMS', 'BSMS', 'BSRMS', 'BHMS', 'BNYS'],
  },
  {
    code: 'PG_DEGREE',
    label: 'Postgraduate (PG) Degree',
    rank: 4,
    degrees: [
      'MD Aerospace Medicine',
      'MD Anaesthesiology',
      'MD Anatomy',
      'MD Biochemistry',
      'MD Biophysics',
      'MD Community Health Administration',
      'MD Community Medicine',
      'MD Dermatology, Venereology & Leprosy',
      'MD Emergency Medicine',
      'MD Family Medicine',
      'MD Forensic Medicine',
      'MD General Medicine',
      'MD Geriatrics',
      'MD Health Administration',
      'MD Hospital Administration',
      'MD Immuno-Haematology & Blood Transfusion',
      'MD Infectious Diseases',
      'MD Laboratory Medicine',
      'MD Marine Medicine',
      'MD Medical Genetics',
      'MD Microbiology',
      'MD Nuclear Medicine',
      'MD Paediatrics',
      'MD Palliative Medicine',
      'MD Pathology',
      'MD Pharmacology',
      'MD Physical Medicine & Rehabilitation',
      'MD Physiology',
      'MD Psychiatry',
      'MD Radiation Oncology',
      'MD Radio-Diagnosis',
      'MD Respiratory Medicine',
      'MD Sports Medicine',
      'MD Tropical Medicine',
      'Master of Public Health (Epidemiology)',
      'MS General Surgery',
      'MS Obstetrics & Gynaecology',
      'MS Ophthalmology',
      'MS Orthopaedics',
      'MS Otorhinolaryngology (ENT)',
      'MS Traumatology & Surgery',
      'DNB Anaesthesiology',
      'DNB Community Medicine',
      'DNB Dermatology, Venereology & Leprosy',
      'DNB Emergency Medicine',
      'DNB Family Medicine',
      'DNB General Medicine',
      'DNB General Surgery',
      'DNB Immuno-Haematology & Blood Transfusion',
      'DNB Microbiology',
      'DNB Nuclear Medicine',
      'DNB Obstetrics & Gynaecology',
      'DNB Ophthalmology',
      'DNB Orthopaedics',
      'DNB Otorhinolaryngology (ENT)',
      'DNB Paediatrics',
      'DNB Pathology',
      'DNB Physical Medicine & Rehabilitation',
      'DNB Psychiatry',
      'DNB Radiation Oncology',
      'DNB Radio-Diagnosis',
      'DNB Respiratory Medicine',
      'MDS Conservative Dentistry & Endodontics',
      'MDS Oral & Maxillofacial Pathology & Oral Microbiology',
      'MDS Oral & Maxillofacial Surgery',
      'MDS Oral Medicine & Radiology',
      'MDS Orthodontics & Dentofacial Orthopaedics',
      'MDS Paediatric & Preventive Dentistry',
      'MDS Periodontology',
      'MDS Prosthodontics & Crown & Bridge',
      'MDS Public Health Dentistry',
      'MD (Ayurveda)',
      'MS (Ayurveda)',
      'MD (Unani)',
      'MS (Unani)',
      'MD (Siddha)',
      'MD (Homoeopathy)',
      'MD (Sowa-Rigpa)',
      'MD (Naturopathy)',
      'MD (Yoga)',
      'DNB Anatomy',
      'DNB Biochemistry',
      'DNB Forensic Medicine',
      'DNB Geriatric Medicine',
      'DNB Hospital Administration',
      'DNB Maternal & Child Health',
      'DNB Palliative Medicine',
      'DNB Pharmacology',
      'DNB Physiology',
      'DNB (Post-Diploma) Anaesthesiology',
      'DNB (Post-Diploma) Dermatology, Venereology & Leprosy',
      'DNB (Post-Diploma) Nuclear Medicine',
      'DNB (Post-Diploma) Obstetrics & Gynaecology',
      'DNB (Post-Diploma) Ophthalmology',
      'DNB (Post-Diploma) Orthopaedics',
      'DNB (Post-Diploma) Otorhinolaryngology (ENT)',
      'DNB (Post-Diploma) Paediatrics',
      'DNB (Post-Diploma) Pathology',
      'DNB (Post-Diploma) Physical Medicine & Rehabilitation',
      'DNB (Post-Diploma) Psychiatry',
      'DNB (Post-Diploma) Radiation Oncology',
      'DNB (Post-Diploma) Radio-Diagnosis',
      'DNB (Post-Diploma) Respiratory Medicine',
    ],
  },
  {
    code: 'PG_DIPLOMA',
    label: 'Postgraduate (PG) Diploma',
    rank: 3,
    degrees: [
      'Diploma in Anaesthesiology (DA)',
      'Diploma in Paediatrics / Child Health (DCH)',
      'Diploma in Family Medicine',
      'Diploma in Obstetrics & Gynaecology (DGO)',
      'Diploma in Ophthalmology (DO)',
      'Diploma in Otorhinolaryngology (DLO)',
      'Diploma in Radio-Diagnosis (DMRD)',
      'Diploma in Tuberculosis & Chest Diseases (DTCD)',
      'Diploma in Clinical Pathology (DCP)',
      'Diploma in Dermatology, Venereology & Leprosy (DDVL)',
      'Diploma in Industrial / Occupational Health (DIH)',
      'Diploma in Medical Radio-Therapy (DMRT)',
      'Diploma in Orthopaedics (D.Ortho)',
      'Diploma in Psychological Medicine (DPM)',
      'Diploma in Public Health (DPH)',
      // On NMC's course list (College and Course Search, 2026-10) but not in the source sheet.
      'Diploma in Community Medicine (DCM)',
      'Diploma in Diabetology',
      'Diploma in Forensic Medicine (DFM)',
      'Diploma in Health Administration (DHA)',
      'Diploma in Health Education (DHE)',
      'Diploma in Immuno-Haematology & Blood Transfusion (DIHBT)',
      'Diploma in Marine Medicine',
      'Diploma in Microbiology (D.Micro)',
      'Diploma in Nutrition (DN)',
      'Diploma in Physical Medicine & Rehabilitation (D.Phy.Med.R)',
      'Diploma in Radiation Medicine (DRM)',
      'Diploma in Sports Medicine (DSM)',
      'Diploma in Tropical Medicine & Health (DTM&H)',
      'Diploma in Virology (D.Vir)',
      'Diploma in Panchakarma (Ayurveda)',
      'Diploma in Kshar Karma (Ayurveda)',
      'Diploma in Ras Shastra & Bhaishajya Kalpana (Ayurveda)',
      'Diploma in Ayurvedic Cosmetology & Skin Disease (Ayurveda)',
      'Diploma in Ayurvedic Dietetics (Ayurveda)',
      'Diploma in Swasthavritta & Yoga (Ayurveda)',
      'Diploma in Prasuti & Striroga (Ayurveda)',
      'Diploma in Balroga (Ayurveda)',
      'Diploma in Dravyaguna (Ayurveda)',
      'Diploma in Manasik Swasthya Vigyan (Ayurveda)',
      'Diploma in Netra Roga Vigyan (Ayurveda)',
      'Diploma in Rasayan & Vajikaran (Ayurveda)',
      'Diploma in Ayurvedic Sangyaharan (Ayurveda)',
      'Diploma in Chhaya evam Vikiran Vigyan (Ayurveda)',
      'Diploma in Marma evam Asthi Chikitsa (Ayurveda)',
      'Diploma in Rog Nidan Vidhi (Ayurveda)',
    ],
  },
  {
    code: 'PG_PURSUING',
    label: 'Postgraduate (PG) – Pursuing',
    rank: 0,
    degrees: [
      'MD Anaesthesiology (Pursuing)',
      'MD Anatomy (Pursuing)',
      'MD Biochemistry (Pursuing)',
      'MD Community Medicine (Pursuing)',
      'MD Dermatology, Venereology & Leprosy (Pursuing)',
      'MD Emergency Medicine (Pursuing)',
      'MD Family Medicine (Pursuing)',
      'MD General Medicine (Pursuing)',
      'MD Microbiology (Pursuing)',
      'MD Nuclear Medicine (Pursuing)',
      'MD Paediatrics (Pursuing)',
      'MD Pathology (Pursuing)',
      'MD Psychiatry (Pursuing)',
      'MD Radiation Oncology (Pursuing)',
      'MD Radio-Diagnosis (Pursuing)',
      'MS General Surgery (Pursuing)',
      'MS Obstetrics & Gynaecology (Pursuing)',
      'MS Ophthalmology (Pursuing)',
      'MS Orthopaedics (Pursuing)',
      'MS Otorhinolaryngology (ENT) (Pursuing)',
      'DM Cardiology (Pursuing)',
      'DM Critical Care Medicine (Pursuing)',
      'DM Medical Gastroenterology (Pursuing)',
      'DM Nephrology (Pursuing)',
      'DM Neurology (Pursuing)',
      'DM Pulmonary, Critical Care & Sleep Medicine (Pursuing)',
      'MCh Cardio-Vascular & Thoracic Surgery (Pursuing)',
      'MCh Neurosurgery (Pursuing)',
      'MCh Vascular Surgery (Pursuing)',
      'DNB General Medicine (Pursuing)',
      'DNB General Surgery (Pursuing)',
      'DNB Dermatology, Venereology & Leprosy (Pursuing)',
      'DNB Emergency Medicine (Pursuing)',
      'DNB Paediatrics (Pursuing)',
      'DNB Radio-Diagnosis (Pursuing)',
      'DrNB Cardiology (Pursuing)',
      'DrNB Neurology (Pursuing)',
      'Diploma in Anaesthesiology (DA) (Pursuing)',
      'Diploma in Paediatrics / Child Health (DCH) (Pursuing)',
      'Diploma in Ophthalmology (DO) (Pursuing)',
      'Diploma in Otorhinolaryngology (DLO) (Pursuing)',
      'DM – Other Specialty (Pursuing)',
      'MCh – Other Specialty (Pursuing)',
      'DrNB – Other Specialty (Pursuing)',
      'MDS – Any Specialty (Pursuing)',
      'MD (Ayurveda) (Pursuing)',
      'MS (Ayurveda) (Pursuing)',
      'MD (Unani) (Pursuing)',
      'MD (Siddha) (Pursuing)',
      'MD (Homoeopathy) (Pursuing)',
    ],
  },
  {
    code: 'SUPER_SPECIALITY',
    label: 'Super Speciality (DM / MCh / DrNB)',
    rank: 5,
    degrees: [
      'DM Cardiac Anaesthesia',
      'DM Cardiology',
      'DM Child & Adolescent Psychiatry',
      'DM Clinical Haematology',
      'DM Clinical Immunology & Rheumatology',
      'DM Clinical Pharmacology',
      'DM Critical Care Medicine',
      'DM Endocrinology',
      'DM Medical Gastroenterology',
      'DM Geriatric Mental Health',
      'DM Hepatology',
      'DM Infectious Diseases',
      'DM Interventional Radiology',
      'DM Medical Genetics',
      'DM Medical Oncology',
      'DM Neonatology',
      'DM Nephrology',
      'DM Neuro-Anaesthesia',
      'DM Neurology',
      'DM Neuro-Radiology',
      'DM Onco-Pathology',
      'DM Organ Transplant Anaesthesia & Critical Care',
      'DM Paediatric & Neonatal Anaesthesia',
      'DM Paediatric Cardiology',
      'DM Paediatric Critical Care',
      'DM Paediatric Gastroenterology',
      'DM Paediatric Hepatology',
      'DM Paediatric Nephrology',
      'DM Paediatric Neurology',
      'DM Paediatric Oncology',
      'DM Pulmonary, Critical Care & Sleep Medicine',
      'DM Virology',
      'MCh Cardio-Vascular & Thoracic Surgery',
      'MCh Endocrine Surgery',
      'MCh Gynaecological Oncology',
      'MCh Hand Surgery',
      'MCh Head & Neck Surgery',
      'MCh Hepato-Pancreato-Biliary Surgery',
      'MCh Neurosurgery',
      'MCh Paediatric Cardio-Thoracic Vascular Surgery',
      'MCh Paediatric Orthopaedics',
      'MCh Paediatric Surgery',
      'MCh Plastic & Reconstructive Surgery',
      'MCh Reproductive Medicine & Surgery',
      'MCh Surgical Gastroenterology',
      'MCh Surgical Oncology',
      'MCh Urology',
      'MCh Vascular Surgery',
      'DrNB Cardiology',
      'DrNB Cardio-Thoracic & Vascular Surgery',
      'DrNB Clinical Haematology',
      'DrNB Critical Care Medicine',
      'DrNB Endocrinology',
      'DrNB Gastroenterology',
      'DrNB Infectious Diseases',
      'DrNB Medical Oncology',
      'DrNB Neonatology',
      'DrNB Nephrology',
      'DrNB Neurology',
      'DrNB Neurosurgery',
      'DrNB Paediatric Surgery',
      'DrNB Plastic & Reconstructive Surgery',
      'DrNB Pulmonary Medicine',
      'DrNB Surgical Gastroenterology',
      'DrNB Surgical Oncology',
      'DrNB Urology',
      'MCh Neurosurgery (6-year, post-MBBS)',
      'MCh – Other Specialty (6-year, post-MBBS)',
    ],
  },
  {
    code: 'POST_DOCTORAL',
    label: 'Post-Doctoral',
    rank: 6,
    degrees: [
      'PDCC (Post-Doctoral Certificate Course)',
      'PDF (Post-Doctoral Fellowship)',
    ],
  },
  {
    code: 'DOCTORAL',
    label: 'Doctoral / Research',
    rank: 4,
    degrees: ['PhD (Medical / Health Sciences)', 'MD-PhD'],
  },
  {
    code: 'MSC_MEDICAL',
    label: 'Medical MSc (Non-Clinical)',
    rank: 3,
    degrees: [
      'MSc Medical Anatomy',
      'MSc Medical Physiology',
      'MSc Medical Biochemistry',
      'MSc Medical Microbiology',
      'MSc Medical Pharmacology',
    ],
  },
  {
    code: 'FELLOWSHIP',
    label: 'Fellowship & Certification',
    rank: 2,
    degrees: [
      'FNB (Fellowship of National Board)',
      'FMAS (Fellowship in Minimal Access Surgery)',
      'FIAGES (Fellowship of IAGES)',
      'FICS (Fellowship of International College of Surgeons)',
      'FIAP (Fellowship of Indian Academy of Pediatrics)',
      'IDCCM (Indian Diploma in Critical Care Medicine)',
      'IFCCM (Indian Fellowship in Critical Care Medicine)',
      'Fellowship in Arthroscopy',
      'Fellowship in Cardiology',
      'Fellowship in Cosmetic Surgery',
      'Fellowship in Diabetic Foot',
      'Fellowship in Diabetology',
      'Fellowship in Emergency Medicine',
      'Fellowship in Endoscopy',
      'Fellowship in Gastroenterology',
      'Fellowship in Joint Replacement',
      'Fellowship in Neonatology',
      'Fellowship in Neurocritical Care',
      'Fellowship in Paediatric Cardiology',
      'Fellowship in Paediatric Neurology',
      'Fellowship in Pain Medicine',
      'Fellowship in Radiology',
      'Fellowship in Reproductive Medicine',
      'Fellowship in Spine Surgery',
      'Fellowship in Sports Medicine',
      'Fellowship in Trauma Care',
      'FDS RCS (England)',
      'MFDS RCS (England)',
      'MFDS RCS (Edinburgh)',
      'FDS RCS (Edinburgh)',
      'FICOI (Fellow, International Congress of Oral Implantologists)',
      'Fellowship in Oral Implantology',
      'Fellowship in Aesthetic / Cosmetic Dentistry',
      'Fellowship in Endodontics',
      'Fellowship in Orthodontics (Aligners)',
      'Fellowship in Laser Dentistry',
    ],
  },
  {
    code: 'CERTIFICATE',
    label: 'Certificate Courses',
    rank: 1,
    degrees: [
      'CCEBDM (Certificate Course in Evidence Based Management of Diabetes)',
      'CCGDM (Certificate Course in Gestational Diabetes Mellitus)',
      'BLS (Basic Life Support)',
      'ACLS (Advanced Cardiovascular Life Support)',
      'PALS (Pediatric Advanced Life Support)',
      'ATLS (Advanced Trauma Life Support)',
      'PGDHHM (PG Diploma in Hospital & Health Management)',
    ],
  },
  {
    code: 'INTERNATIONAL',
    label: 'International Qualifications',
    rank: 2,
    degrees: [
      'MRCP (UK)',
      'MRCS (UK)',
      'FRCP (UK)',
      'FRCS (UK)',
      'FRCR',
      'MRCOG',
      'FRCOG',
      'FACP',
      'FACC',
      'FCCP',
      'FAAP',
      'FACS',
      'MBBS (UK)',
      'MB ChB (UK)',
      'MB BCh BAO (Ireland)',
      'MD (US)',
      'US Medical Graduate (USMG)',
      'DO (US)',
      'International Medical Graduate (IMG)',
      'Canadian Medical Graduate',
      'Australian Medical Graduate',
      'European Medical Graduate',
      'Foreign Medical Graduate (FMG)',
      'Foreign Medical Degree – Russia',
      'Foreign Medical Degree – China',
      'Foreign Medical Degree – Philippines',
      'Foreign Medical Degree – Ukraine',
      'Foreign Medical Degree – Kazakhstan',
      'Foreign Medical Degree – Kyrgyzstan',
      'Foreign Medical Degree – Uzbekistan',
      'Foreign Medical Degree – Georgia',
      'Foreign Medical Degree – Bangladesh',
      'Foreign Medical Degree – Nepal',
      'Foreign Medical Degree – Armenia',
      'Foreign Medical Degree – Other Country',
      'FMGE / NExT Passed',
    ],
  },
];

const MAX_QUALIFICATION_DEGREE_LENGTH = 100;

// Labels the earlier FE-only list saved; mapped to their catalog code on write.
const LEGACY_CATEGORY_CODES: Record<string, string> = {
  'Graduation (Under-Graduate)': 'UG',
  'Post-Graduation (PG) - Degree': 'PG_DEGREE',
  'Post-Graduation (PG) - Diploma': 'PG_DIPLOMA',
  'Super-Specialty (PG - Degree)': 'SUPER_SPECIALITY',
  'Fellowship/Certificate Programs': 'FELLOWSHIP',
  'Under Post-Graduation - Status: Pursuing': 'PG_PURSUING',
};

// Earlier spellings of catalog degrees; names in neither list stay custom.
const LEGACY_DEGREE_NAMES: Record<string, string> = {
  'md dermatology': 'MD Dermatology, Venereology & Leprosy',
  'md immunohematology & blood transfusion':
    'MD Immuno-Haematology & Blood Transfusion',
  'md master of public health (epidemiology)':
    'Master of Public Health (Epidemiology)',
  'md radiodiagnosis': 'MD Radio-Diagnosis',
  'md ayurveda': 'MD (Ayurveda)',
  'md homoeopathy': 'MD (Homoeopathy)',
  'md unani': 'MD (Unani)',
  'md siddha': 'MD (Siddha)',
  'ms ent': 'MS Otorhinolaryngology (ENT)',
  'ms traumatology and surgery': 'MS Traumatology & Surgery',
  'ms ayurveda': 'MS (Ayurveda)',
  'ms unani': 'MS (Unani)',
  'mds oral pathology':
    'MDS Oral & Maxillofacial Pathology & Oral Microbiology',
  'mds orthodontics': 'MDS Orthodontics & Dentofacial Orthopaedics',
  'mds paediatric dentistry': 'MDS Paediatric & Preventive Dentistry',
  'mds prosthodontics': 'MDS Prosthodontics & Crown & Bridge',
  'mds oral surgery': 'MDS Oral & Maxillofacial Surgery',
  'diploma anaesthesiology': 'Diploma in Anaesthesiology (DA)',
  'diploma child health': 'Diploma in Paediatrics / Child Health (DCH)',
  'diploma clinical pathology': 'Diploma in Clinical Pathology (DCP)',
  'diploma dermatology': 'Diploma in Dermatology, Venereology & Leprosy (DDVL)',
  'diploma ent': 'Diploma in Otorhinolaryngology (DLO)',
  'diploma family medicine': 'Diploma in Family Medicine',
  'diploma gynaecology & obstetrics':
    'Diploma in Obstetrics & Gynaecology (DGO)',
  'diploma medical radiotherapy': 'Diploma in Medical Radio-Therapy (DMRT)',
  'diploma occupational health':
    'Diploma in Industrial / Occupational Health (DIH)',
  'diploma ophthalmology': 'Diploma in Ophthalmology (DO)',
  'diploma orthopaedics': 'Diploma in Orthopaedics (D.Ortho)',
  'diploma psychiatry': 'Diploma in Psychological Medicine (DPM)',
  'diploma public health': 'Diploma in Public Health (DPH)',
  'diploma radio-diagnosis': 'Diploma in Radio-Diagnosis (DMRD)',
  'diploma tb & chest diseases':
    'Diploma in Tuberculosis & Chest Diseases (DTCD)',
  'dnb dermatology': 'DNB Dermatology, Venereology & Leprosy',
  'dnb ent': 'DNB Otorhinolaryngology (ENT)',
  'dnb pulmonary medicine': 'DNB Respiratory Medicine',
  'dnb radiodiagnosis': 'DNB Radio-Diagnosis',
  'dm clinical immunology': 'DM Clinical Immunology & Rheumatology',
  'dm rheumatology': 'DM Clinical Immunology & Rheumatology',
  'dm neuroradiology': 'DM Neuro-Radiology',
  'dm gastroenterology': 'DM Medical Gastroenterology',
  'dm gastroenterology (pursuing)': 'DM Medical Gastroenterology (Pursuing)',
  'dm pulmonary & critical care medicine':
    'DM Pulmonary, Critical Care & Sleep Medicine',
  'mch paediatric cardio thoracic vascular surgery':
    'MCh Paediatric Cardio-Thoracic Vascular Surgery',
  'mch cardiovascular & thoracic surgery':
    'MCh Cardio-Vascular & Thoracic Surgery',
  'mch plastic surgery': 'MCh Plastic & Reconstructive Surgery',
  'mch reconstructive surgery': 'MCh Plastic & Reconstructive Surgery',
  'drnb cardiothoracic surgery': 'DrNB Cardio-Thoracic & Vascular Surgery',
  'drnb plastic surgery': 'DrNB Plastic & Reconstructive Surgery',
  'fellowship of the national board': 'FNB (Fellowship of National Board)',
  'fellowship in minimal access surgery':
    'FMAS (Fellowship in Minimal Access Surgery)',
  'fellowship of indian association of gastrointestinal endo surgeons':
    'FIAGES (Fellowship of IAGES)',
  'fellowship of the international college of surgeons':
    'FICS (Fellowship of International College of Surgeons)',
  'fellowship of indian academy of pediatrics':
    'FIAP (Fellowship of Indian Academy of Pediatrics)',
  'fellowship in critical care medicine':
    'IFCCM (Indian Fellowship in Critical Care Medicine)',
  'md dermatology (pursuing)':
    'MD Dermatology, Venereology & Leprosy (Pursuing)',
  'md radiodiagnosis (pursuing)': 'MD Radio-Diagnosis (Pursuing)',
  'ms ent (pursuing)': 'MS Otorhinolaryngology (ENT) (Pursuing)',
  'dm pulmonary & critical care medicine (pursuing)':
    'DM Pulmonary, Critical Care & Sleep Medicine (Pursuing)',
  'dnb dermatology (pursuing)':
    'DNB Dermatology, Venereology & Leprosy (Pursuing)',
  'dnb radiodiagnosis (pursuing)': 'DNB Radio-Diagnosis (Pursuing)',
  'diploma anaesthesiology (pursuing)':
    'Diploma in Anaesthesiology (DA) (Pursuing)',
  'diploma child health (pursuing)':
    'Diploma in Paediatrics / Child Health (DCH) (Pursuing)',
  'diploma ent (pursuing)': 'Diploma in Otorhinolaryngology (DLO) (Pursuing)',
  'diploma ophthalmology (pursuing)':
    'Diploma in Ophthalmology (DO) (Pursuing)',
  'mb bch (ireland)': 'MB BCh BAO (Ireland)',
};

const tidy = (value: string) => value.trim().replace(/\s+/g, ' ');
const key = (value: string) => tidy(value).toLowerCase();

const CATEGORY_BY_KEY = new Map<string, QualificationCategory>();
const DEGREE_BY_KEY = new Map<string, string>();
for (const category of QUALIFICATION_CATALOG) {
  CATEGORY_BY_KEY.set(key(category.label), category);
  CATEGORY_BY_KEY.set(key(category.code), category);
  for (const degree of category.degrees) DEGREE_BY_KEY.set(key(degree), degree);
}
for (const [legacy, code] of Object.entries(LEGACY_CATEGORY_CODES)) {
  CATEGORY_BY_KEY.set(key(legacy), CATEGORY_BY_KEY.get(key(code))!);
}

/** The API response: each category plus the old labels saved rows may still hold. */
export const QUALIFICATION_CATALOG_RESPONSE = QUALIFICATION_CATALOG.map(
  (category) => ({
    ...category,
    legacyLabels: Object.keys(LEGACY_CATEGORY_CODES).filter(
      (label) => LEGACY_CATEGORY_CODES[label] === category.code
    ),
  })
);

export function findQualificationCategory(value?: string | null) {
  return value ? CATEGORY_BY_KEY.get(key(value)) : undefined;
}

/** Catalog spelling of a degree, legacy names included; unknown names stay custom. */
export function canonicalDegree(value: string) {
  const legacy = LEGACY_DEGREE_NAMES[key(value)];
  return DEGREE_BY_KEY.get(key(legacy ?? value)) ?? tidy(value);
}

/** Saves the category label in catalog spelling; a legacy label maps to its new one. */
export const qualificationCategorySchema = z
  .string()
  .transform((value, ctx) => {
    const category = findQualificationCategory(value);
    if (category) return category.label;
    ctx.addIssue({
      code: 'custom',
      message: 'Select a qualification type from the list',
    });
    return z.NEVER;
  });

export const qualificationDegreeSchema = z
  .string()
  .trim()
  .min(1, 'Qualification is required')
  .max(
    MAX_QUALIFICATION_DEGREE_LENGTH,
    `Qualification can be at most ${MAX_QUALIFICATION_DEGREE_LENGTH} characters`
  )
  .transform(canonicalDegree);

const CATEGORY_BY_DEGREE = new Map<string, QualificationCategory>();
for (const category of QUALIFICATION_CATALOG)
  for (const degree of category.degrees)
    CATEGORY_BY_DEGREE.set(key(degree), category);

export interface DegreeRow {
  qualificationTitle?: string | null;
  qualificationType?: string | null;
  yearOfCompletion?: number | null;
}

/** The doctor's degrees as one line, lowest level first ("BUMS, MD Anaesthesiology"); pursuing degrees are left out.
 *  `max` keeps the highest ones (still lowest first); no rows falls back to the legacy single `qualification` text. */
export function doctorDegreeLine(
  rows: DegreeRow[],
  fallback?: string | null,
  max?: number
): string {
  const seen = new Set<string>();
  const ranked = rows
    .map((row) => {
      // Saved rows often have title/type swapped; the category is whichever one the catalogue knows.
      const titleCategory = findQualificationCategory(row.qualificationTitle);
      const typeCategory = findQualificationCategory(row.qualificationType);
      const degree = tidy(
        (titleCategory
          ? row.qualificationType
          : typeCategory
            ? row.qualificationTitle
            : row.qualificationTitle || row.qualificationType) ?? ''
      );
      const category =
        titleCategory ?? typeCategory ?? CATEGORY_BY_DEGREE.get(key(degree));
      return {
        degree,
        rank: category?.rank ?? 1,
        year: row.yearOfCompletion ?? 0,
      };
    })
    .filter(
      (d) => d.degree && d.rank > 0 && !findQualificationCategory(d.degree)
    )
    .filter((d) => !seen.has(key(d.degree)) && seen.add(key(d.degree)))
    .sort((a, b) => a.rank - b.rank || a.year - b.year)
    .map((d) => d.degree);

  const degrees = rows.length
    ? ranked
    : [...new Set((fallback ?? '').split(',').map(tidy).filter(Boolean))];
  return (max && degrees.length > max ? degrees.slice(-max) : degrees).join(
    ', '
  );
}
