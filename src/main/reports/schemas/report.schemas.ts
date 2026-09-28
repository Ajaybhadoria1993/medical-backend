// src/schemas/access.schemas.ts
import { z } from 'zod';
import {
  PRESCRIPTION_SECTION_DEFAULTS,
  PrescriptionSectionKey,
} from '../services/prescriptionSection.service';
import {
  PRESCRIPTION_LANGUAGE_CODES,
  PRESCRIPTION_PRINT_STYLES,
} from '../utils/prescriptionLanguages.utils';

/**
 * Built from the section catalogue rather than a hand-written key list, so a
 * section added to `PRESCRIPTION_SECTION_DEFAULTS` is accepted by the API
 * immediately. Zod strips unknown keys, so a stale hand-written list would
 * silently drop new toggles on the way to the database.
 */
export const prescriptionSectionConfigSchema = z.object(
  Object.fromEntries(
    (
      Object.keys(PRESCRIPTION_SECTION_DEFAULTS) as PrescriptionSectionKey[]
    ).map((key) => [key, z.boolean().optional()])
  ) as Record<PrescriptionSectionKey, z.ZodOptional<z.ZodBoolean>>
);
export const reportStatusSchema = z.enum(['Pendig', 'Approved', 'Rejected']);

/** English or one of the 22 scheduled languages a prescription can print in. */
export const prescriptionLanguageSchema = z.enum(PRESCRIPTION_LANGUAGE_CODES);
export const prescriptionPrintStyleSchema = z.enum(PRESCRIPTION_PRINT_STYLES);

export const createReportSchema = z.object({
  petientId: z.string().min(1, 'petientId is required'),
  reportType: z.string().min(1, 'reportType is required'),
  description: z.string().min(1, 'description is required').optional(),
  reportDocs: z.string().min(1, 'reportDocs is required'),
  reportStatus: reportStatusSchema.optional(),
});

export const updateReportSchema = z.object({
  reportType: z.string().min(1, 'reportType is required').optional(),
  description: z.string().min(1, 'description is required').optional(),
  reportDocs: z.string().min(1, 'reportDocs is required').optional(),
  reportStatus: reportStatusSchema.optional(),
});

export const prescriptionTemplateSchema = z.object({
  templateName: z.enum([
    'template1',
    'template2',
    'template3',
    'template4',
    'template5',
    'template6',
  ]),
  fontFamily: z.string().min(1),
  color1: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  color2: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  color3: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  color4: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  color5: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  color6: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  color7: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  color8: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  color9: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  color10: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  // Optional so clients that only send colours keep working — an absent key
  // leaves the doctor's stored section choices untouched.
  sectionConfig: prescriptionSectionConfigSchema.optional(),
});

export type PrescriptionTemplateDto = z.infer<
  typeof prescriptionTemplateSchema
>;

/** The workspace Preview saves the switches alone, never the design. */
export const prescriptionSectionsBodySchema = z.object({
  sectionConfig: prescriptionSectionConfigSchema,
});
export type PrescriptionSectionsBodyDto = z.infer<
  typeof prescriptionSectionsBodySchema
>;

/** Whose switches: your own, or a doctor's in your clinic when you're its admin. */
export const prescriptionSectionsParamsSchema = z.object({
  doctorId: z.string().uuid('doctorId must be a valid id'),
});
export type PrescriptionSectionsParamsDto = z.infer<
  typeof prescriptionSectionsParamsSchema
>;

export const prescriptionPdfParamsSchema = z.object({
  reportId: z.string().uuid('reportId must be a valid id'),
});
export type PrescriptionPdfParamsDto = z.infer<
  typeof prescriptionPdfParamsSchema
>;

export const prescriptionPdfQuerySchema = z.object({
  lang: prescriptionLanguageSchema.default('en'),
});
export type PrescriptionPdfQueryDto = z.infer<
  typeof prescriptionPdfQuerySchema
>;

/** Translations tab: one language at a time; English has nothing to translate. */
export const translationListQuerySchema = z.object({
  lang: prescriptionLanguageSchema.exclude(['en']),
  status: z.enum(['pending', 'machine', 'manual']).optional(),
  pageNumber: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type TranslationListQueryDto = z.infer<
  typeof translationListQuerySchema
>;

export const translationIdParamsSchema = z.object({
  id: z.string().uuid('id must be a valid id'),
});
export type TranslationIdParamsDto = z.infer<typeof translationIdParamsSchema>;

export const translationUpdateBodySchema = z.object({
  translatedText: z
    .string()
    .trim()
    .min(1, 'Translation is required')
    .max(1000, 'Translation is too long'),
});
export type TranslationUpdateBodyDto = z.infer<
  typeof translationUpdateBodySchema
>;

/** Translations tab: the doctor's print language and style; 'en' prints English only. */
export const translationSettingsBodySchema = z.object({
  language: prescriptionLanguageSchema,
  printStyle: prescriptionPrintStyleSchema,
});
export type TranslationSettingsBodyDto = z.infer<
  typeof translationSettingsBodySchema
>;

export type createReportDto = z.infer<typeof createReportSchema>;
export type updateReportDto = z.infer<typeof updateReportSchema>;

export const getAllReportsQuerySchema = z.object({
  pageSize: z.string().min(1, 'pageSize is required').optional(),
  pageNumber: z.string().min(1, 'pageNumber is required').optional(),
  searchBy: z.string().optional(),
});
export type getAllReportsQueryDto = z.infer<typeof getAllReportsQuerySchema>;

export const getAllReportsParamSchema = z.object({
  petientId: z.string().min(1, 'pageSize is required').optional(),
});
export type getAllReportsQueryParamDto = z.infer<
  typeof getAllReportsParamSchema
>;
export const getReportsParamSchema = z.object({
  reportId: z.string().min(1, 'pageSize is required').optional(),
});
export type getReportsQueryParamDto = z.infer<typeof getReportsParamSchema>;

/* ----------------------------- ReportCard ----------------------------- */

/**
 * POST /report-cards
 * - Create a new report card
 * - Requires the NOT NULL DB fields: petientId, appointmentId
 */
export const reportCardPostSchema = z.object({
  petientId: z.string(),
  appointmentId: z.string(),
  reportId: z.string().optional(),

  comorbidities: z.array(z.string()).optional().nullable(),
  habits: z.array(z.string()).optional().nullable(),
  vitals: z.record(z.string(), z.any()).optional().nullable(),

  generalExamination: z.array(z.string()).optional().nullable(),
  systemExamination: z.string().optional().nullable(),
  provisionalDiagnosis: z.string().optional().nullable(),
  differentialDiagnosis: z.string().optional().nullable(),
  finalDiagnosis: z.string().optional().nullable(),
  investigations: z.string().optional().nullable(),
  advice: z.string().optional().nullable(),
  preDiagnosis: z.string().optional().nullable(),
  clinicalNotes: z.string().optional().nullable(),
  allergies: z.array(z.string()).optional().nullable(),
  surgerySuggested: z.array(z.string()).optional().nullable(),
  visitingDays: z.array(z.string()).optional().nullable(),
  visitingNotes: z.string().optional().nullable(),
  prescriptionPdf: z.string().optional().nullable(),
  additionalInformation: z.record(z.string(), z.string()).optional().nullable(),
  followUpInDays: z.string().optional().nullable(),
  followUpDate: z.coerce.date().optional().nullable(),
});

/* ----------------------------- Prescription ----------------------------- */

/**
 * POST /prescriptions
 * - Create a new prescription
 * - Requires NOT NULL DB fields: reportCardId, medicineName, composition, dosage, frequency, duration, manufacturer
 */

export const prescriptionPostSchema = z.object({
  medicineId: z.string().uuid().optional(),
  medicineName: z.string().min(1),
  composition: z.string().min(1),
  strength: z.string().optional().nullable(),
  dosage: z.string().trim().min(1).max(500),
  frequency: z.string().min(1),
  duration: z.string().min(1),
  manufacturer: z.string().min(1),

  medicineCount: z.string().optional().nullable(),
  marketer: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  uses: z.record(z.string(), z.any()).optional().nullable(),
});

export const createReportAndPrescriptionsSchemas = z.object({
  reportCard: reportCardPostSchema.partial(),
  prescriptions: z.array(prescriptionPostSchema),
  favouritePrescriptionName: z.string().optional().nullable(),
  // Language picked in the workspace Preview for this prescription's PDF; absent uses the doctor's default.
  printLanguage: prescriptionLanguageSchema.optional(),
});

export type PrescriptionPostInput = z.infer<typeof prescriptionPostSchema>;

export type ReportCardPostInput = z.infer<typeof reportCardPostSchema>;
export type CreateReportAndPrescriptionsDto = z.infer<
  typeof createReportAndPrescriptionsSchemas
>;

/**
 * PUT /report-cards/:id
 * - Full update / replace: id required, must include required relation fields.
 * - Optional columns may be omitted or explicitly set to null to clear them.
 */

export const reportCardPutSchema = z.object({
  comorbidities: z.array(z.string()).optional().nullable(),
  habits: z.array(z.string()).optional().nullable(),
  vitals: z.record(z.string(), z.any()).optional().nullable(),

  generalExamination: z.array(z.string()).optional().nullable(),
  systemExamination: z.string().optional().nullable(),
  provisionalDiagnosis: z.string().optional().nullable(),
  differentialDiagnosis: z.string().optional().nullable(),
  finalDiagnosis: z.string().optional().nullable(),
  investigations: z.string().optional().nullable(),
  advice: z.string().optional().nullable(),
  preDiagnosis: z.string().optional().nullable(),
  clinicalNotes: z.string().optional().nullable(),
  allergies: z.array(z.string()).optional().nullable(),
  surgerySuggested: z.array(z.string()).optional().nullable(),
  visitingDays: z.array(z.string()).optional().nullable(),
  visitingNotes: z.string().optional().nullable(),
  additionalInformation: z.record(z.string(), z.string()).optional().nullable(),
  followUpInDays: z.string().optional().nullable(),
  followUpDate: z.coerce.date().optional().nullable(),
});

/**
 * PUT /prescriptions/:id
 * - Full update / replace: id required, requires main non-null fields as with POST
 */
export const prescriptionPutSchema = z.object({
  medicineName: z.string().min(1),
  composition: z.string().min(1),
  strength: z.string().optional().nullable(),
  dosage: z.string().trim().min(1).max(500),
  frequency: z.string().min(1),
  duration: z.string().min(1),
  manufacturer: z.string().min(1),

  medicineCount: z.string().optional().nullable(),
  marketer: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  uses: z.record(z.string(), z.any()).optional().nullable(),
});

export const updateReportAndPrescriptionsSchemas = z.object({
  reportCard: reportCardPutSchema.partial().optional(),
  prescriptions: prescriptionPutSchema.partial().optional(),
  // Language picked in the workspace Preview for this prescription's PDF; absent uses the doctor's default.
  printLanguage: prescriptionLanguageSchema.optional(),
});

export type PrescriptionPutInput = z.infer<typeof prescriptionPutSchema>;
export type ReportCardPutInput = z.infer<typeof reportCardPutSchema>;
export type UpdateReportAndPrescriptionsDto = z.infer<
  typeof updateReportAndPrescriptionsSchemas
>;

export const getPatientIdParamsSchema = z.object({
  patientId: z.string().min(1),
});
export type GetPatientIdParamsDto = z.infer<typeof getPatientIdParamsSchema>;

export const getReportCardIdParamsSchema = z.object({
  reportCardId: z.string(),
});
export const getReportCardIdQuerySchema = z.object({
  reportCardId: z.string().optional(),
  prescriptionId: z.string().min(1).optional(),
});

export type GetReportCardIdQueryDto = z.infer<
  typeof getReportCardIdQuerySchema
>;
export type GetReportCardIdParamsDto = z.infer<
  typeof getReportCardIdParamsSchema
>;

export const getPatientIdQuerySchema = z.object({
  pageSize: z.string().min(1, 'pageSize is required').optional(),
  pageNumber: z.string().min(1, 'pageNumber is required').optional(),
  searchBy: z.string().optional(),
  typeOfPaginations: z
    .enum(['Appointments', 'Prescriptions', 'Medcial history'])
    .optional(),
});
export type GetPatientIdQueryDto = z.infer<typeof getPatientIdQuerySchema>;

export const getReportIdsQuerySchema = z.object({
  reportCardId: z.string().min(1).optional(),
  appointmentId: z.string().min(1).optional(),
});

export const doctorIdSchema = z.object({
  doctorId: z.string().min(1, 'doctorId is required'),
});

export const favouritePrescriptionIdSchema = z.object({
  id: z.string().uuid('Invalid favourite prescription ID format'),
});

export type GetReportIdsQueryDto = z.infer<typeof getReportIdsQuerySchema>;
