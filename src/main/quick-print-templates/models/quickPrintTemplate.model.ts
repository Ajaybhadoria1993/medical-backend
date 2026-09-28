import { pgTable, uuid, timestamp, varchar, jsonb } from 'drizzle-orm/pg-core';
import { UserModel } from '../../users/models/user.model';

/**
 * Stores the doctor's Quick Print Template configuration.
 * - selectedTemplate: which of the 6 predefined templates to use
 * - elementConfig: JSON object controlling visibility, order, and position
 *   of individual elements within the template (e.g., hide diagnosis, move
 *   follow-up to top, etc.)
 * - fontFamily: preferred font for the quick print
 * - colors: primary accent color for the template
 */
export const QuickPrintTemplateModel = pgTable('quick_print_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  doctorId: uuid('doctor_id')
    .references(() => UserModel.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  selectedTemplate: varchar('selected_template', { length: 50 })
    .notNull()
    .default('compact-medicine-slip'),
  fontFamily: varchar('font_family', { length: 100 }).default(
    'Inter, sans-serif'
  ),
  accentColor: varchar('accent_color', { length: 20 }).default('#0A6C74'),
  elementConfig: jsonb('element_config')
    .$type<ElementConfig>()
    .default({
      showClinicHeader: true,
      showClinicLogo: true,
      showPatientName: true,
      showPatientUhid: true,
      showPatientAge: true,
      showPatientGender: true,
      showPatientMobile: true,
      showPatientAddress: false,
      showVisitDate: true,
      showDiagnosis: true,
      showMedicineTable: true,
      showMedicineComposition: true,
      showMedicineQuantity: false,
      showMedicineInstructions: true,
      showAdvice: true,
      showFollowUp: true,
      showDoctorName: true,
      showDoctorQualification: true,
      showDoctorRegistration: false,
      showDoctorSignature: true,
      showQrCode: false,
      showFooter: true,
      // Element ordering (top to bottom)
      sectionOrder: [
        'clinicHeader',
        'patientInfo',
        'diagnosis',
        'medicineTable',
        'advice',
        'followUp',
        'doctorSignature',
        'footer',
      ],
    }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** One draggable block of the Quick Print page layout designer (mm units). */
export type ElementBlockLayout = {
  id: string;
  visible: boolean;
  position: { x: number; y: number; width: number; height: number };
};

/**
 * Shape of the `element_config` jsonb column. Every field is optional: rows
 * written before a given field shipped simply won't have it, and the render
 * path falls back to `QuickPrintTemplateService.DEFAULT_ELEMENTS`.
 */
export type ElementConfig = {
  showClinicHeader?: boolean;
  showClinicLogo?: boolean;
  showPatientName?: boolean;
  showPatientUhid?: boolean;
  showPatientAge?: boolean;
  showPatientGender?: boolean;
  showPatientMobile?: boolean;
  showPatientAddress?: boolean;
  showVisitDate?: boolean;
  showChiefComplaints?: boolean;
  showVitals?: boolean;
  showAllergies?: boolean;
  showDiagnosis?: boolean;
  showMedicineTable?: boolean;
  showMedicineComposition?: boolean;
  showMedicineQuantity?: boolean;
  showMedicineInstructions?: boolean;
  showTests?: boolean;
  showClinicalNotes?: boolean;
  showAdvice?: boolean;
  showFollowUp?: boolean;
  showDoctorName?: boolean;
  showDoctorQualification?: boolean;
  showDoctorRegistration?: boolean;
  showDoctorSignature?: boolean;
  showQrCode?: boolean;
  showFooter?: boolean;
  sectionOrder?: string[];
  blockLayout?: ElementBlockLayout[];
  pageSize?: string;
  tableStyle?: string;
};
