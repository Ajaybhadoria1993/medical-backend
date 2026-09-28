import { z } from 'zod';

const templateIds = [
  'compact-medicine-slip',
  'standard-medicine-sheet',
  'minimal-prescription',
  'pharmacy-copy',
  'detailed-prescription',
  'clinic-branded',
] as const;

const sectionNames = [
  'clinicHeader',
  'patientInfo',
  'diagnosis',
  'medicineTable',
  'advice',
  'followUp',
  'doctorSignature',
  'footer',
] as const;

/** Draggable block ids from the Quick Print page layout designer. */
const blockIds = [
  'clinicHeader',
  'patientInfo',
  'visitDate',
  'chiefComplaints',
  'vitals',
  'allergies',
  'diagnosis',
  'rxSymbol',
  'medicineTable',
  'tests',
  'clinicalNotes',
  'preDiagnosis',
  'advice',
  'followUp',
  'doctorSignature',
  'habits',
] as const;

const paperSizes = ['a4', 'a5', 'thermal80mm', 'letter', 'custom'] as const;

const tableStyles = ['classic', 'bordered', 'striped', 'minimal'] as const;

/** A block's absolute position on the page, in millimetres. */
const blockLayoutItemSchema = z.object({
  id: z.enum(blockIds),
  visible: z.boolean(),
  position: z.object({
    x: z.number().min(0).max(1000),
    y: z.number().min(0).max(1000),
    width: z.number().min(0).max(1000),
    height: z.number().min(0).max(1000),
  }),
});

export const elementConfigSchema = z.object({
  showClinicHeader: z.boolean().optional(),
  showClinicLogo: z.boolean().optional(),
  showPatientName: z.boolean().optional(),
  showPatientUhid: z.boolean().optional(),
  showPatientAge: z.boolean().optional(),
  showPatientGender: z.boolean().optional(),
  showPatientMobile: z.boolean().optional(),
  showPatientAddress: z.boolean().optional(),
  showVisitDate: z.boolean().optional(),
  showDiagnosis: z.boolean().optional(),
  showMedicineTable: z.boolean().optional(),
  showMedicineComposition: z.boolean().optional(),
  showMedicineQuantity: z.boolean().optional(),
  showMedicineInstructions: z.boolean().optional(),
  showAdvice: z.boolean().optional(),
  showFollowUp: z.boolean().optional(),
  showDoctorName: z.boolean().optional(),
  showDoctorQualification: z.boolean().optional(),
  showDoctorRegistration: z.boolean().optional(),
  showDoctorSignature: z.boolean().optional(),
  showQrCode: z.boolean().optional(),
  showFooter: z.boolean().optional(),
  showChiefComplaints: z.boolean().optional(),
  showVitals: z.boolean().optional(),
  showAllergies: z.boolean().optional(),
  showTests: z.boolean().optional(),
  showClinicalNotes: z.boolean().optional(),
  sectionOrder: z.array(z.enum(sectionNames)).optional(),
  // Layout designer state. Zod strips unknown keys, so these must be declared
  // here or the saved layout silently never reaches the database.
  blockLayout: z.array(blockLayoutItemSchema).max(50).optional(),
  pageSize: z.enum(paperSizes).optional(),
  tableStyle: z.enum(tableStyles).optional(),
  layoutMode: z.enum(['flow', 'exact']).optional(),
  design: z.enum(['original', 'modern']).optional(),
});

export const saveQuickPrintTemplateSchema = z.object({
  selectedTemplate: z.enum(templateIds),
  fontFamily: z.string().max(100).optional(),
  accentColor: z.string().max(20).optional(),
  elementConfig: elementConfigSchema.optional(),
});

export type SaveQuickPrintTemplateDto = z.infer<
  typeof saveQuickPrintTemplateSchema
>;
