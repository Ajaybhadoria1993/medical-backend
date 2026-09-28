import { sql } from 'drizzle-orm';
import { database } from '../../configurations/dbConnection';
import {
  LabReportTemplateParametersModel,
  LabReportTemplatesModel,
} from '../../main/lab/models/labResult.model';
import logger from '../../utils/logger';

type TemplateParameterSeed = {
  sectionName: string;
  parameterName: string;
  unit: string;
  referenceRange: string;
  inputType: string;
  sortOrder: number;
  isRequired?: boolean;
};

type TemplateSeed = {
  name: string;
  code: string;
  sampleType: string;
  description: string;
  parameters: TemplateParameterSeed[];
};

const buildParameters = (
  sectionName: string,
  rows: Array<
    [
      parameterName: string,
      unit: string,
      referenceRange: string,
      inputType?: string,
    ]
  >
) =>
  rows.map(
    ([parameterName, unit, referenceRange, inputType = 'number'], index) =>
      ({
        sectionName,
        parameterName,
        unit,
        referenceRange,
        inputType,
        sortOrder: index + 1,
        isRequired: true,
      }) satisfies TemplateParameterSeed
  );

const templates: TemplateSeed[] = [
  {
    name: 'Complete Blood Count',
    code: 'CBC',
    sampleType: 'Blood',
    description: 'Default Complete Blood Count result entry template',
    parameters: [
      ['Haemoglobin', 'g/dL', '13.0 - 17.0', 'number'],
      ['RBC Count', 'mill/cu.mm', '4.5 - 5.5', 'number'],
      ['Haematocrit', '%', '40.0 - 50.0', 'number'],
      ['MCV', 'fL', '80.0 - 100.0', 'number'],
      ['MCH', 'pg', '27.0 - 32.0', 'number'],
      ['MCHC', 'g/dL', '31.5 - 34.5', 'number'],
      ['RDW-CV', '%', '11.6 - 14.0', 'number'],
      ['Total Leucocytes Count / TLC', '/cu.mm', '4000 - 10000', 'number'],
      ['Neutrophils', '%', '50.0 - 70.0', 'number'],
      ['Lymphocytes', '%', '20.0 - 40.0', 'number'],
      ['Eosinophils', '%', '2.0 - 6.0', 'number'],
      ['Basophils', '%', '0.0 - 2.0', 'number'],
      ['Absolute Neutrophil Count', 'x1000/cu.mm', '2.0 - 7.0', 'number'],
      ['Absolute Lymphocyte Count', 'x1000/cu.mm', '1.0 - 3.0', 'number'],
      ['Absolute Monocyte Count', 'x1000/cu.mm', '0.2 - 1.0', 'number'],
      ['Absolute Eosinophil Count', 'x1000/cu.mm', '0.02 - 0.50', 'number'],
      ['Absolute Basophil Count', 'x1000/cu.mm', '0.00 - 0.10', 'number'],
      ['Platelet Count', 'Thousand/uL', '150 - 400', 'number'],
      ['Mean Platelet Volume / MPV', 'fL', '6.0 - 11.0', 'number'],
    ].map(
      ([parameterName, unit, referenceRange, inputType], index) =>
        ({
          sectionName: 'Complete Blood Count',
          parameterName,
          unit,
          referenceRange,
          inputType,
          sortOrder: index + 1,
          isRequired: true,
        }) satisfies TemplateParameterSeed
    ),
  },
  {
    name: 'Hemoglobin',
    code: 'HEMOGLOBIN',
    sampleType: 'Blood',
    description: 'Default Hemoglobin result entry template',
    parameters: buildParameters('Hemoglobin', [
      ['Hemoglobin', 'g/dL', '13.0 - 17.0'],
    ]),
  },
  {
    name: 'Total Leukocyte Count',
    code: 'TLC',
    sampleType: 'Blood',
    description: 'Default TLC result entry template',
    parameters: buildParameters('TLC', [
      ['Total Leukocyte Count / TLC', '/cu.mm', '4000 - 10000'],
    ]),
  },
  {
    name: 'Differential Leukocyte Count',
    code: 'DLC',
    sampleType: 'Blood',
    description: 'Default DLC result entry template',
    parameters: buildParameters('DLC', [
      ['Neutrophils', '%', '50.0 - 70.0'],
      ['Lymphocytes', '%', '20.0 - 40.0'],
      ['Monocytes', '%', '2.0 - 10.0'],
      ['Eosinophils', '%', '2.0 - 6.0'],
      ['Basophils', '%', '0.0 - 2.0'],
    ]),
  },
  {
    name: 'Platelet Count',
    code: 'PLATELET_COUNT',
    sampleType: 'Blood',
    description: 'Default Platelet Count result entry template',
    parameters: buildParameters('Platelet Count', [
      ['Platelet Count', 'Thousand/uL', '150 - 400'],
    ]),
  },
  {
    name: 'ESR',
    code: 'ESR',
    sampleType: 'Blood',
    description: 'Default ESR result entry template',
    parameters: buildParameters('ESR', [['ESR', 'mm/hr', '0 - 20']]),
  },
  {
    name: 'Malaria Test',
    code: 'MALARIA',
    sampleType: 'Blood',
    description: 'Default Malaria result entry template',
    parameters: [
      {
        sectionName: 'Malaria Test',
        parameterName: 'Malaria Parasite',
        unit: '-',
        referenceRange: 'Negative',
        inputType: 'text',
        sortOrder: 1,
        isRequired: true,
      },
      {
        sectionName: 'Malaria Test',
        parameterName: 'Plasmodium Vivax',
        unit: '-',
        referenceRange: 'Negative',
        inputType: 'text',
        sortOrder: 2,
        isRequired: true,
      },
      {
        sectionName: 'Malaria Test',
        parameterName: 'Plasmodium Falciparum',
        unit: '-',
        referenceRange: 'Negative',
        inputType: 'text',
        sortOrder: 3,
        isRequired: true,
      },
      {
        sectionName: 'Malaria Test',
        parameterName: 'Parasite Density',
        unit: '/uL',
        referenceRange: '-',
        inputType: 'number',
        sortOrder: 4,
        isRequired: false,
      },
      {
        sectionName: 'Malaria Test',
        parameterName: 'Result',
        unit: '-',
        referenceRange: 'Negative',
        inputType: 'text',
        sortOrder: 5,
        isRequired: true,
      },
    ] satisfies TemplateParameterSeed[],
  },
  {
    name: 'Blood Sugar',
    code: 'BLOOD_SUGAR',
    sampleType: 'Blood',
    description: 'Default Blood Sugar result entry template',
    parameters: buildParameters('Blood Sugar', [
      ['Fasting Blood Sugar', 'mg/dL', '70 - 99'],
      ['Post Prandial Blood Sugar', 'mg/dL', '< 140', 'text'],
      ['Random Blood Sugar', 'mg/dL', '< 200', 'text'],
      ['HbA1c', '%', '< 5.7', 'text'],
    ]),
  },
  {
    name: 'Liver Function Test',
    code: 'LFT',
    sampleType: 'Blood',
    description: 'Default Liver Function Test result entry template',
    parameters: buildParameters('Liver Function Test', [
      ['Total Bilirubin', 'mg/dL', '0.2 - 1.2'],
      ['Direct Bilirubin', 'mg/dL', '0.0 - 0.3'],
      ['Indirect Bilirubin', 'mg/dL', '0.2 - 0.9'],
      ['SGOT / AST', 'U/L', '5 - 40'],
      ['SGPT / ALT', 'U/L', '7 - 56'],
      ['Alkaline Phosphatase', 'U/L', '40 - 129'],
      ['Gamma GT / GGT', 'U/L', '8 - 61'],
      ['Total Protein', 'g/dL', '6.0 - 8.3'],
      ['Albumin', 'g/dL', '3.5 - 5.0'],
      ['Globulin', 'g/dL', '2.0 - 3.5'],
      ['A/G Ratio', '-', '1.0 - 2.2'],
    ]),
  },
  {
    name: 'Kidney Function Test',
    code: 'KFT',
    sampleType: 'Blood',
    description: 'Default Kidney Function Test result entry template',
    parameters: buildParameters('Kidney Function Test', [
      ['Urea', 'mg/dL', '15 - 45'],
      ['Blood Urea Nitrogen / BUN', 'mg/dL', '7 - 20'],
      ['Creatinine', 'mg/dL', '0.6 - 1.3'],
      ['Uric Acid', 'mg/dL', '3.5 - 7.2'],
      ['Sodium', 'mmol/L', '135 - 145'],
      ['Potassium', 'mmol/L', '3.5 - 5.1'],
      ['Chloride', 'mmol/L', '98 - 107'],
      ['Calcium', 'mg/dL', '8.5 - 10.5'],
    ]),
  },
  {
    name: 'Lipid Profile',
    code: 'LIPID_PROFILE',
    sampleType: 'Blood',
    description: 'Default Lipid Profile result entry template',
    parameters: buildParameters('Lipid Profile', [
      ['Total Cholesterol', 'mg/dL', '< 200', 'text'],
      ['Triglycerides', 'mg/dL', '< 150', 'text'],
      ['HDL Cholesterol', 'mg/dL', '> 40', 'text'],
      ['LDL Cholesterol', 'mg/dL', '< 100', 'text'],
      ['VLDL Cholesterol', 'mg/dL', '5 - 40'],
      ['Total Cholesterol / HDL Ratio', '-', '< 5.0', 'text'],
      ['LDL / HDL Ratio', '-', '< 3.5', 'text'],
    ]),
  },
  {
    name: 'Uric Acid',
    code: 'URIC_ACID',
    sampleType: 'Blood',
    description: 'Default Uric Acid result entry template',
    parameters: buildParameters('Uric Acid', [
      ['Uric Acid', 'mg/dL', '3.5 - 7.2'],
    ]),
  },
  {
    name: 'Creatinine',
    code: 'CREATININE',
    sampleType: 'Blood',
    description: 'Default Creatinine result entry template',
    parameters: buildParameters('Creatinine', [
      ['Serum Creatinine', 'mg/dL', '0.6 - 1.3'],
      ['eGFR', 'mL/min/1.73m2', '> 60', 'text'],
    ]),
  },
  {
    name: 'Urine Routine',
    code: 'URINE_ROUTINE',
    sampleType: 'Urine',
    description: 'Default Urine Routine result entry template',
    parameters: buildParameters('Urine Routine', [
      ['Colour', '-', 'Pale Yellow', 'text'],
      ['Appearance', '-', 'Clear', 'text'],
      ['Specific Gravity', '-', '1.005 - 1.030'],
      ['pH', '-', '4.6 - 8.0'],
      ['Protein', '-', 'Negative', 'text'],
      ['Glucose', '-', 'Negative', 'text'],
      ['Ketones', '-', 'Negative', 'text'],
      ['Bilirubin', '-', 'Negative', 'text'],
      ['Urobilinogen', '-', 'Normal', 'text'],
      ['Blood', '-', 'Negative', 'text'],
      ['Nitrite', '-', 'Negative', 'text'],
      ['Leukocyte Esterase', '-', 'Negative', 'text'],
      ['Pus Cells / WBC', '/hpf', '0 - 5'],
      ['RBC', '/hpf', '0 - 2'],
      ['Epithelial Cells', '/hpf', '0 - 5'],
      ['Casts', '-', 'Absent', 'text'],
      ['Crystals', '-', 'Absent', 'text'],
      ['Bacteria', '-', 'Absent', 'text'],
    ]),
  },
  {
    name: 'Stool Routine',
    code: 'STOOL_ROUTINE',
    sampleType: 'Stool',
    description: 'Default Stool Routine result entry template',
    parameters: buildParameters('Stool Routine', [
      ['Colour', '-', 'Brown', 'text'],
      ['Consistency', '-', 'Formed', 'text'],
      ['Mucus', '-', 'Absent', 'text'],
      ['Blood', '-', 'Absent', 'text'],
      ['Occult Blood', '-', 'Negative', 'text'],
      ['Pus Cells', '/hpf', '0 - 5'],
      ['RBC', '/hpf', '0 - 2'],
      ['Ova', '-', 'Absent', 'text'],
      ['Cyst', '-', 'Absent', 'text'],
      ['Parasite', '-', 'Absent', 'text'],
    ]),
  },
  {
    name: 'Pregnancy Test',
    code: 'PREGNANCY_TEST',
    sampleType: 'Urine',
    description: 'Default Urine Pregnancy Test result entry template',
    parameters: buildParameters('Pregnancy Test', [
      ['Urine hCG', '-', 'Negative', 'text'],
      ['Result', '-', 'Negative', 'text'],
    ]),
  },
  {
    name: 'Blood Culture',
    code: 'BLOOD_CULTURE',
    sampleType: 'Blood',
    description: 'Default Blood Culture result entry template',
    parameters: buildParameters('Blood Culture', [
      ['Gram Stain', '-', 'No organism seen', 'text'],
      ['Culture Growth', '-', 'No growth', 'text'],
      ['Organism Isolated', '-', 'None', 'text'],
      ['Colony Count', '-', '-', 'text'],
      ['Antibiotic Sensitivity', '-', '-', 'textarea'],
      ['Comments', '-', '-', 'textarea'],
    ]),
  },
  {
    name: 'Urine Culture',
    code: 'URINE_CULTURE',
    sampleType: 'Urine',
    description: 'Default Urine Culture result entry template',
    parameters: buildParameters('Urine Culture', [
      ['Culture Growth', '-', 'No growth', 'text'],
      ['Colony Count', 'CFU/mL', '< 100000', 'text'],
      ['Organism Isolated', '-', 'None', 'text'],
      ['Antibiotic Sensitivity', '-', '-', 'textarea'],
      ['Comments', '-', '-', 'textarea'],
    ]),
  },
  {
    name: 'Sputum Culture',
    code: 'SPUTUM_CULTURE',
    sampleType: 'Sputum',
    description: 'Default Sputum Culture result entry template',
    parameters: buildParameters('Sputum Culture', [
      ['Gram Stain', '-', 'No organism seen', 'text'],
      ['Culture Growth', '-', 'No growth', 'text'],
      ['Organism Isolated', '-', 'None', 'text'],
      ['AFB Smear', '-', 'Negative', 'text'],
      ['Antibiotic Sensitivity', '-', '-', 'textarea'],
      ['Comments', '-', '-', 'textarea'],
    ]),
  },
  {
    name: 'HIV Screening',
    code: 'HIV',
    sampleType: 'Blood',
    description: 'Default HIV screening result entry template',
    parameters: buildParameters('HIV Screening', [
      ['HIV 1 Antibody', '-', 'Non Reactive', 'text'],
      ['HIV 2 Antibody', '-', 'Non Reactive', 'text'],
      ['HIV p24 Antigen', '-', 'Non Reactive', 'text'],
      ['Final Result', '-', 'Non Reactive', 'text'],
      ['Method', '-', '-', 'text'],
    ]),
  },
  {
    name: 'HBsAg',
    code: 'HBSAG',
    sampleType: 'Blood',
    description: 'Default HBsAg result entry template',
    parameters: buildParameters('HBsAg', [
      ['HBsAg', '-', 'Non Reactive', 'text'],
      ['Method', '-', '-', 'text'],
      ['Comments', '-', '-', 'textarea'],
    ]),
  },
  {
    name: 'Dengue Profile',
    code: 'DENGUE',
    sampleType: 'Blood',
    description: 'Default Dengue result entry template',
    parameters: buildParameters('Dengue Profile', [
      ['Dengue NS1 Antigen', '-', 'Negative', 'text'],
      ['Dengue IgM Antibody', '-', 'Negative', 'text'],
      ['Dengue IgG Antibody', '-', 'Negative', 'text'],
      ['Final Result', '-', 'Negative', 'text'],
    ]),
  },
  {
    name: 'Typhoid / Widal Test',
    code: 'TYPHOID',
    sampleType: 'Blood',
    description: 'Default Typhoid/Widal result entry template',
    parameters: buildParameters('Typhoid / Widal Test', [
      ['Salmonella Typhi O', '-', '< 1:80', 'text'],
      ['Salmonella Typhi H', '-', '< 1:80', 'text'],
      ['Salmonella Paratyphi AH', '-', '< 1:80', 'text'],
      ['Salmonella Paratyphi BH', '-', '< 1:80', 'text'],
      ['Interpretation', '-', 'Negative', 'text'],
    ]),
  },
  {
    name: 'CRP',
    code: 'CRP',
    sampleType: 'Blood',
    description: 'Default C-Reactive Protein result entry template',
    parameters: buildParameters('CRP', [
      ['C-Reactive Protein', 'mg/L', '0 - 5'],
    ]),
  },
  {
    name: 'RA Factor',
    code: 'RA_FACTOR',
    sampleType: 'Blood',
    description: 'Default Rheumatoid Factor result entry template',
    parameters: buildParameters('RA Factor', [
      ['Rheumatoid Factor', 'IU/mL', '< 14', 'text'],
    ]),
  },
  {
    name: 'PT INR',
    code: 'PT_INR',
    sampleType: 'Blood',
    description: 'Default PT/INR result entry template',
    parameters: buildParameters('PT INR', [
      ['Prothrombin Time / Patient', 'sec', '11 - 14'],
      ['Prothrombin Time / Control', 'sec', '11 - 14'],
      ['INR', '-', '0.8 - 1.2'],
      ['ISI', '-', '-', 'text'],
    ]),
  },
  {
    name: 'APTT',
    code: 'APTT',
    sampleType: 'Blood',
    description: 'Default APTT result entry template',
    parameters: buildParameters('APTT', [
      ['APTT / Patient', 'sec', '25 - 35'],
      ['APTT / Control', 'sec', '25 - 35'],
      ['Interpretation', '-', 'Normal', 'text'],
    ]),
  },
  {
    name: 'Bleeding Time',
    code: 'BLEEDING_TIME',
    sampleType: 'Blood',
    description: 'Default Bleeding Time result entry template',
    parameters: buildParameters('Bleeding Time', [
      ['Bleeding Time', 'min', '2 - 7'],
      ['Method', '-', '-', 'text'],
    ]),
  },
  {
    name: 'Clotting Time',
    code: 'CLOTTING_TIME',
    sampleType: 'Blood',
    description: 'Default Clotting Time result entry template',
    parameters: buildParameters('Clotting Time', [
      ['Clotting Time', 'min', '5 - 11'],
      ['Method', '-', '-', 'text'],
    ]),
  },
  {
    name: 'Stool Parasite',
    code: 'STOOL_PARASITE',
    sampleType: 'Stool',
    description: 'Default Stool Parasite result entry template',
    parameters: buildParameters('Stool Parasite', [
      ['Ova', '-', 'Absent', 'text'],
      ['Cyst', '-', 'Absent', 'text'],
      ['Trophozoite', '-', 'Absent', 'text'],
      ['Larvae', '-', 'Absent', 'text'],
      ['Parasite Identified', '-', 'None', 'text'],
      ['Comments', '-', '-', 'textarea'],
    ]),
  },
  {
    name: 'Biopsy',
    code: 'BIOPSY',
    sampleType: 'Tissue',
    description: 'Default Histopathology Biopsy result entry template',
    parameters: buildParameters('Biopsy', [
      ['Specimen', '-', '-', 'text'],
      ['Clinical History', '-', '-', 'textarea'],
      ['Gross Examination', '-', '-', 'textarea'],
      ['Microscopic Examination', '-', '-', 'textarea'],
      ['Diagnosis', '-', '-', 'textarea'],
      ['Impression', '-', '-', 'textarea'],
    ]),
  },
  {
    name: 'FNAC',
    code: 'FNAC',
    sampleType: 'Aspirate',
    description: 'Default FNAC result entry template',
    parameters: buildParameters('FNAC', [
      ['Site', '-', '-', 'text'],
      ['Clinical Details', '-', '-', 'textarea'],
      ['Cellularity', '-', '-', 'text'],
      ['Microscopic Examination', '-', '-', 'textarea'],
      ['Impression', '-', '-', 'textarea'],
    ]),
  },
  {
    name: 'PAP Smear',
    code: 'PAP_SMEAR',
    sampleType: 'Cervical Smear',
    description: 'Default PAP Smear cytology result entry template',
    parameters: buildParameters('PAP Smear', [
      ['Specimen Adequacy', '-', 'Satisfactory', 'text'],
      ['Epithelial Cell Abnormality', '-', 'Negative', 'text'],
      ['Organisms', '-', 'Not Seen', 'text'],
      ['Inflammation', '-', '-', 'text'],
      [
        'Interpretation',
        '-',
        'Negative for intraepithelial lesion or malignancy',
        'textarea',
      ],
      ['Recommendation', '-', '-', 'textarea'],
    ]),
  },
  {
    name: 'Fluid Cytology',
    code: 'FLUID_CYTOLOGY',
    sampleType: 'Fluid',
    description: 'Default Fluid Cytology result entry template',
    parameters: buildParameters('Fluid Cytology', [
      ['Fluid Type', '-', '-', 'text'],
      ['Volume', 'mL', '-', 'number'],
      ['Appearance', '-', '-', 'text'],
      ['Cellularity', '-', '-', 'text'],
      ['Microscopic Examination', '-', '-', 'textarea'],
      ['Malignant Cells', '-', 'Not Seen', 'text'],
      ['Impression', '-', '-', 'textarea'],
    ]),
  },
  {
    name: 'RT PCR',
    code: 'RT_PCR',
    sampleType: 'Swab',
    description: 'Default RT PCR molecular diagnostics result entry template',
    parameters: buildParameters('RT PCR', [
      ['Target Pathogen / Gene', '-', '-', 'text'],
      ['Result', '-', 'Not Detected', 'text'],
      ['Ct Value', '-', '-', 'number'],
      ['Internal Control', '-', 'Valid', 'text'],
      ['Interpretation', '-', 'Not Detected', 'textarea'],
    ]),
  },
  {
    name: 'HPV DNA Test',
    code: 'HPV_DNA',
    sampleType: 'Swab',
    description: 'Default HPV DNA result entry template',
    parameters: buildParameters('HPV DNA Test', [
      ['High Risk HPV DNA', '-', 'Not Detected', 'text'],
      ['HPV 16', '-', 'Not Detected', 'text'],
      ['HPV 18', '-', 'Not Detected', 'text'],
      ['Other High Risk Genotypes', '-', 'Not Detected', 'text'],
      ['Interpretation', '-', 'Not Detected', 'textarea'],
    ]),
  },
  {
    name: 'Blood Grouping',
    code: 'BLOOD_GROUPING',
    sampleType: 'Blood',
    description: 'Default Blood Grouping result entry template',
    parameters: buildParameters('Blood Grouping', [
      ['ABO Group', '-', '-', 'text'],
      ['Rh Factor', '-', '-', 'text'],
    ]),
  },
  {
    name: 'Cross Match',
    code: 'CROSS_MATCH',
    sampleType: 'Blood',
    description: 'Default Cross Match result entry template',
    parameters: buildParameters('Cross Match', [
      ['Recipient Blood Group', '-', '-', 'text'],
      ['Donor Blood Group', '-', '-', 'text'],
      ['Compatibility', '-', 'Compatible', 'text'],
      ['Remarks', '-', '-', 'textarea'],
    ]),
  },
];

function composeDepartmentParameters(codes: string[]) {
  const seenParameterNames = new Set<string>();
  let sortOrder = 1;

  return codes.flatMap((code) => {
    const template = templates.find((item) => item.code === code);
    if (!template) return [];

    return template.parameters.flatMap((parameter) => {
      const key = parameter.parameterName.trim().toLowerCase();
      if (seenParameterNames.has(key)) return [];

      seenParameterNames.add(key);
      return [{ ...parameter, sortOrder: sortOrder++ }];
    });
  });
}

const departmentTemplates: TemplateSeed[] = [
  {
    name: 'Biochemistry',
    code: 'BIOCHEMISTRY',
    sampleType: 'Blood/Serum',
    description: 'Department-level Biochemistry result entry template',
    parameters: composeDepartmentParameters([
      'BLOOD_SUGAR',
      'LFT',
      'KFT',
      'LIPID_PROFILE',
      'URIC_ACID',
      'CREATININE',
    ]),
  },
  {
    name: 'Clinical Pathology',
    code: 'CLINICAL_PATHOLOGY',
    sampleType: 'Urine/Stool',
    description: 'Department-level Clinical Pathology result entry template',
    parameters: composeDepartmentParameters([
      'URINE_ROUTINE',
      'STOOL_ROUTINE',
      'PREGNANCY_TEST',
    ]),
  },
  {
    name: 'Microbiology',
    code: 'MICROBIOLOGY',
    sampleType: 'Blood/Urine/Sputum',
    description: 'Department-level Microbiology result entry template',
    parameters: composeDepartmentParameters([
      'BLOOD_CULTURE',
      'URINE_CULTURE',
      'SPUTUM_CULTURE',
    ]),
  },
  {
    name: 'Serology / Immunology',
    code: 'SEROLOGY_IMMUNOLOGY',
    sampleType: 'Blood/Serum',
    description: 'Department-level Serology / Immunology result entry template',
    parameters: composeDepartmentParameters([
      'HIV',
      'HBSAG',
      'DENGUE',
      'TYPHOID',
      'CRP',
      'RA_FACTOR',
    ]),
  },
  {
    name: 'Coagulation',
    code: 'COAGULATION',
    sampleType: 'Blood',
    description: 'Department-level Coagulation result entry template',
    parameters: composeDepartmentParameters([
      'PT_INR',
      'APTT',
      'BLEEDING_TIME',
      'CLOTTING_TIME',
    ]),
  },
  {
    name: 'Parasitology',
    code: 'PARASITOLOGY',
    sampleType: 'Blood/Stool',
    description: 'Department-level Parasitology result entry template',
    parameters: composeDepartmentParameters(['MALARIA', 'STOOL_PARASITE']),
  },
  {
    name: 'Histopathology',
    code: 'HISTOPATHOLOGY',
    sampleType: 'Tissue',
    description: 'Department-level Histopathology result entry template',
    parameters: composeDepartmentParameters(['BIOPSY', 'FNAC']),
  },
  {
    name: 'Cytology',
    code: 'CYTOLOGY',
    sampleType: 'Smear/Fluid',
    description: 'Department-level Cytology result entry template',
    parameters: composeDepartmentParameters(['PAP_SMEAR', 'FLUID_CYTOLOGY']),
  },
  {
    name: 'Molecular Diagnostics',
    code: 'MOLECULAR_DIAGNOSTICS',
    sampleType: 'Swab/Blood',
    description: 'Department-level Molecular Diagnostics result entry template',
    parameters: composeDepartmentParameters(['RT_PCR', 'HPV_DNA']),
  },
  {
    name: 'Blood Bank',
    code: 'BLOOD_BANK',
    sampleType: 'Blood',
    description: 'Department-level Blood Bank result entry template',
    parameters: composeDepartmentParameters(['BLOOD_GROUPING', 'CROSS_MATCH']),
  },
];

const allTemplates = [...templates, ...departmentTemplates];

export async function seedLabReportTemplates() {
  try {
    logger.info('Seeding lab report templates...');

    for (const templateSeed of allTemplates) {
      const [template] = await database
        .insert(LabReportTemplatesModel)
        .values({
          labId: null,
          name: templateSeed.name,
          code: templateSeed.code,
          sampleType: templateSeed.sampleType,
          description: templateSeed.description,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: LabReportTemplatesModel.code,
          targetWhere: sql`${LabReportTemplatesModel.labId} IS NULL`,
          set: {
            labId: null,
            name: templateSeed.name,
            sampleType: templateSeed.sampleType,
            description: templateSeed.description,
            isActive: true,
            updatedAt: new Date(),
          },
        })
        .returning();

      for (const parameter of templateSeed.parameters) {
        await database
          .insert(LabReportTemplateParametersModel)
          .values({
            templateId: template.id,
            labId: null,
            sectionName: parameter.sectionName,
            parameterName: parameter.parameterName,
            unit: parameter.unit,
            referenceRange: parameter.referenceRange,
            inputType: parameter.inputType,
            sortOrder: parameter.sortOrder,
            isRequired: parameter.isRequired ?? true,
            isActive: true,
            sourceType: 'DEFAULT',
            isCustom: false,
          })
          .onConflictDoUpdate({
            target: [
              LabReportTemplateParametersModel.templateId,
              LabReportTemplateParametersModel.parameterName,
            ],
            targetWhere: sql`${LabReportTemplateParametersModel.labId} IS NULL AND ${LabReportTemplateParametersModel.sourceType} = 'DEFAULT'`,
            set: {
              sectionName: parameter.sectionName,
              unit: parameter.unit,
              referenceRange: parameter.referenceRange,
              inputType: parameter.inputType,
              sortOrder: parameter.sortOrder,
              isRequired: parameter.isRequired ?? true,
              isActive: true,
              sourceType: 'DEFAULT',
              isCustom: false,
              labId: null,
              updatedAt: new Date(),
            },
          });
      }
    }

    logger.info('Lab report templates seeded successfully');
  } catch (error) {
    logger.error('Error seeding lab report templates', error);
    throw error;
  }
}
