import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
extendZodWithOpenApi(z);
import { MAX_TOKENS_PER_SHIFT } from '../../appointments/schemas/appointment.schemas';
import {
  checkSpecializationLimits,
  specialitySchema,
  specializationSchema,
} from '../../../utils/specialtyCatalog';
import { SUGGESTION_SECTIONS } from '../../../utils/suggestionCatalog';
import {
  qualificationCategorySchema,
  qualificationDegreeSchema,
} from '../../../utils/qualificationCatalog';
import { canonicalCollege } from '../../../utils/collegeCatalog';
import { languagesSpokenSchema } from '../../../utils/indianLanguages';
const currencyEnum = z.enum(['INR', 'USD', 'EUR']);

const optionalYearsOfExperienceSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.coerce.number().int().nonnegative().nullable().optional()
);

// Fits user_professional.about (varchar 1000); a longer value would fail in the DB
// with a raw error instead of a clear validation message.
const aboutSchema = z
  .string()
  .max(1000, 'About can be at most 1000 characters')
  .optional();

// Fits doctor_qualifications.notes (varchar 300); '' clears a saved note.
export const qualificationNotesSchema = z
  .string()
  .trim()
  .max(300, 'Notes can be at most 300 characters')
  .optional();

export const doctorQualificationSchema = z.object({
  id: z.string().optional(),
  qualificationType: qualificationDegreeSchema,
  qualificationTitle: qualificationCategorySchema,
  // specialization: z.string().optional(),
  // Fits doctor_qualifications.board_or_university (varchar 150); listed colleges save in official spelling.
  boardOrUniversity: z
    .string()
    .max(150)
    .optional()
    .transform((v) => (v === undefined ? v : canonicalCollege(v))),
  yearOfCompletion: z.coerce.number().int().optional(),
  notes: qualificationNotesSchema,
});

export const doctorQualificationsSchema = z.array(doctorQualificationSchema);

const monthSchema = z.coerce.number().int().min(1).max(12);
const experienceYearSchema = z.coerce
  .number()
  .int()
  .min(1950)
  .max(new Date().getFullYear());

// One row of doctor_experiences; a current role has no end date.
export const doctorExperienceSchema = z
  .object({
    organisation: z
      .string()
      .trim()
      .min(1, 'Hospital / Clinic is required')
      .max(150),
    role: z.string().trim().min(1, 'Role is required').max(100),
    city: z.string().trim().max(100).optional(),
    startMonth: monthSchema,
    startYear: experienceYearSchema,
    endMonth: monthSchema.optional(),
    endYear: experienceYearSchema.optional(),
    isCurrent: z.boolean().default(false),
  })
  .superRefine((row, ctx) => {
    if (row.isCurrent) return;
    if (row.endMonth === undefined || row.endYear === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['endYear'],
        message: 'Add an end date or mark it as current',
      });
      return;
    }
    if (row.endYear * 12 + row.endMonth < row.startYear * 12 + row.startMonth)
      ctx.addIssue({
        code: 'custom',
        path: ['endYear'],
        message: 'End date must be after the start date',
      });
  });

export const MAX_DOCTOR_EXPERIENCES = 15;
export const doctorExperiencesSchema = z
  .array(doctorExperienceSchema)
  .max(MAX_DOCTOR_EXPERIENCES);

// 📍 2. Doctor Profile
const updateDoctorProfileSchema = z
  .object({
    name: z.string().min(2).optional(),

    // make mobiles optional for update endpoint
    mobile: z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')
      .optional(),

    alternateMobile: z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit alternate mobile number')
      .optional(),

    profileImage: z.string().url().optional(),
    qualification: z.string().optional(),
    yearsOfExperience: optionalYearsOfExperienceSchema,
    licenseNumber: z.string().optional(),
    speciality: specialitySchema.optional(),
    specialization: specializationSchema.optional(),
    about: aboutSchema,
    registrationNumber: z.string().optional(),
    languagesSpoken: languagesSpokenSchema.optional(),
    qualifications: doctorQualificationsSchema.optional(),
  })
  .superRefine((data, ctx) => {
    checkSpecializationLimits(data, ctx);
    // Only validate equality when both values are present
    if (data.mobile && data.alternateMobile) {
      if (data.mobile === data.alternateMobile) {
        // attach error specifically to alternateMobile field
        ctx.addIssue({
          code: 'custom',
          message:
            'Alternate mobile number cannot be the same as the primary mobile',
          path: ['alternateMobile'],
        });
      }
    }
  });

// 📍 3. Clinic Service
const updateClinicServiceSchema = z.object({
  id: z.string().uuid().optional(),
  serviceName: z.string().min(2),
  price: z.number().int().nonnegative(),
  currency: currencyEnum.default('INR'),
  additionalServices: z.string().optional(),
  canBeBookedByPatient: z.boolean().optional(),
  durationDays: z.number().int().nonnegative(),
});

// 📍 3.1 Update Service by ID
export const updateServiceByIdSchema = z.object({
  serviceName: z.string().min(2).optional(),
  price: z.number().int().nonnegative().optional(),
  currency: currencyEnum.optional(),
  additionalServices: z.string().optional(),
  canBeBookedByPatient: z.boolean().optional(),
  durationDays: z.number().int().nonnegative().optional(),
});

export const serviceIdParamSchema = z.object({
  serviceId: z.string().uuid('Invalid serviceId'),
});

// 📍 3.2 Toggle Service Status (disable/enable)
export const toggleServiceStatusSchema = z.object({
  action: z.enum(['disable', 'enable']),
});

export type UpdateServiceByIdDto = z.infer<typeof updateServiceByIdSchema>;
export type ServiceIdParamDto = z.infer<typeof serviceIdParamSchema>;
export type ToggleServiceStatusDto = z.infer<typeof toggleServiceStatusSchema>;

const updateAivblityBreaksSchema = z.object({
  breakType: z.string().min(3),
  startTime: z.string(),
  status: z.boolean().optional(),
  endTime: z.string(),
  notes: z.string().optional(),
});

// 📍 4. Availability Schema
const updateAvailabilitySchema = z.object({
  dayOfWeek: z.string().min(3),
  startTime: z.string().min(3),
  endTime: z.string().min(3),
  breaksStart: z.string().optional(),
  breaksEnd: z.string().optional(),
  isAvailable: z.boolean(),
  notes: z.string(),
  slotMinutes: z.number(),
  stepMinutes: z.number(),
  // If set, availability becomes token-based (max patients for that day)
  noOfPatients: z
    .number()
    .int()
    .positive()
    .max(
      MAX_TOKENS_PER_SHIFT,
      `noOfPatients cannot exceed ${MAX_TOKENS_PER_SHIFT}`
    )
    .optional(),
  shiftCapacities: z
    .array(
      z.object({
        sessionIndex: z.number().int().positive().max(10),
        noOfPatients: z
          .number()
          .int()
          .positive()
          .max(
            MAX_TOKENS_PER_SHIFT,
            `noOfPatients cannot exceed ${MAX_TOKENS_PER_SHIFT}`
          ),
      })
    )
    .optional(),
  aivblityBreak: z.array(updateAivblityBreaksSchema),
});
export const DateAvailabilityTimeSlotsSchema = z.object({
  id: z.string().optional(),
  startTime: z.string().min(1, 'Start time is required'),
  endTime: z.string().min(1, 'End time is required'),
  isAvailable: z.boolean().default(true),
  notes: z.string().optional(),
  noOfPatients: z
    .number()
    .int()
    .positive()
    .max(
      MAX_TOKENS_PER_SHIFT,
      `noOfPatients cannot exceed ${MAX_TOKENS_PER_SHIFT}`
    )
    .optional(),
});

export const DateAvailabilitySchema = z.object({
  date: z.string().min(1, 'Date is required'),
  isAvailable: z.boolean().default(true),
  notes: z.string().optional(),
  slotMinutes: z.number().int().optional(),
  stepMinutes: z.number().int().optional(),
  timeSlots: z.array(DateAvailabilityTimeSlotsSchema).optional(),
});
export const updateDoctorScheamas = z.object({
  doctorProfile: updateDoctorProfileSchema.optional(),
  clinicService: z.array(updateClinicServiceSchema).optional(),
  aivblity: z.array(updateAvailabilitySchema).optional(),
  dateAvailability: z.array(DateAvailabilitySchema).optional(),
  qualifications: doctorQualificationsSchema.optional(),
  // The whole list: rows left out are removed.
  experiences: doctorExperiencesSchema.optional(),
  about: aboutSchema,
});

export const updateDoctorProfileScheamas = z.object({
  doctorProfile: updateDoctorProfileSchema.optional(),
  qualifications: doctorQualificationsSchema.optional(),
  reason: z.string().optional(),
});

export const searchCollegesQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  stream: z.string().max(40).optional(),
});

export const searchSuggestionsQuerySchema = z.object({
  section: z.enum(SUGGESTION_SECTIONS),
  q: z.string().trim().max(100).default(''),
  specialty: z.string().trim().max(80).optional(),
});

export const listUpdateRequestsSchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(10),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  doctorId: z.string().uuid().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid startDate format (YYYY-MM-DD)')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid endDate format (YYYY-MM-DD)')
    .optional(),
  search: z.string().optional(),
});

export const approveDoctorUpdateSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  rejectionReason: z.string().optional(),
});

export const getDoctorDoctorIdScheamas = z.object({
  doctorId: z.string().min(1, 'doctorId is required'),
});

export const upsertDoctorManualTemplateSchema = z.object({
  templateHtml: z.string().optional().nullable(),
  printType: z.string().optional(),
});

export const getDoctorLeaveScheamas = z.object({
  leaveId: z.string().min(1, 'leaveId is required'),
});

export const getDoctorAvailabilityOnDateSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
});

export const getDoctorAvailabilityRangeSchema = z.object({
  doctorId: z.string().uuid('Invalid doctorId'),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid startDate format (YYYY-MM-DD)'),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid endDate format (YYYY-MM-DD)'),
});

// Up to 100 chars per entry; the list cap is loose because the Preference page sends defaults too.
// The service enforces the real cap (MAX_OWN_SUGGESTIONS) on the doctor's own entries only.
const suggestionList = z.array(z.string().trim().min(1).max(100)).max(200);

export const upsertDoctorPreferencesSchema = z.object({
  headerOrder: z.array(z.string()).optional(),
  habitList: suggestionList.optional(),
  allergyList: suggestionList.optional(),
  diagnosisList: suggestionList.optional(),
  preDiagnosisList: suggestionList.optional(),
  surgerySuggestedList: suggestionList.optional(),
  adviceSuggestionsList: suggestionList.optional(),
  dietarySuggestionsList: suggestionList.optional(),
  // Per medicine form, the doctor's own instruction phrases; an empty list clears that form.
  instructionSuggestions: z
    .record(
      z.string().trim().min(1).max(40),
      z.array(z.string().trim().min(1).max(200)).max(30)
    )
    .optional(),
  /** Built-in options removed per list; the service keeps only real built-ins. */
  hiddenOptions: z
    .partialRecord(
      z.enum([
        'habitList',
        'allergyList',
        'diagnosisList',
        'preDiagnosisList',
        'surgerySuggestedList',
        'adviceSuggestionsList',
        'dietarySuggestionsList',
      ]),
      suggestionList
    )
    .optional(),
  /** Clinical details tabs in order; null goes back to the specialty's own. */
  specialtyTools: z
    .array(z.string().trim().min(1).max(80))
    .max(40)
    .nullable()
    .optional(),
});

export type UpsertDoctorPreferencesInput = z.infer<
  typeof upsertDoctorPreferencesSchema
>;

export const upsertDoctorPrescriptionTemplate = z.object({
  templateHtml: z.string(),
});

export type getDoctorAvailabilityOnDateDto = z.infer<
  typeof getDoctorAvailabilityOnDateSchema
>;

export type getDoctorAvailabilityRangeDto = z.infer<
  typeof getDoctorAvailabilityRangeSchema
>;

export const appointmentPlainStatusEnumZ = z.enum([
  'active',
  'inactive',
  'paused',
  'trial',
  'cancelled',
  'expired',
]);

export const paymentModeEnumZ = z.enum(['cash', 'upi', 'card', 'insurance']);

export const createClinicAppointmentPlainSchema = z.object({
  doctorId: z.string(),
  patientId: z.string(),
  doctorSubscriptionId: z.string(),

  status: appointmentPlainStatusEnumZ.default('active'),
  notes: z.string().optional(),

  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a valid number'),

  paymentStatus: z.enum(['paid', 'pending', 'refunded']).optional(),
  paymentMode: paymentModeEnumZ.optional(),
});
export const updateClinicAppointmentPlainSchema = z.object({
  status: appointmentPlainStatusEnumZ.optional(),
  notes: z.string().optional(),

  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a valid number')
    .optional(),

  paymentStatus: z.enum(['paid', 'pending', 'refunded']).optional(),
  paymentMode: paymentModeEnumZ.optional(),
});

export const plainIdSchemas = z.object({
  plainId: z.string().min(1, 'plainId is required'),
});

export const getQueryParamsSchema = z.object({
  pageSize: z.number().min(1).default(10),
  pageNumber: z.number().min(1).default(1),
  searchBy: z.string().optional(),
});

export const deleteServiceSchemas = z.object({
  serviceId: z.string().min(1, 'serviceId is required'),
});

export const checkPlainsSchemas = z.object({
  doctorId: z.string(),
  patientId: z.string(),
});

export const toggleFavoriteSchema = z.object({
  medicineId: z.string().uuid('Invalid medicine ID'),
});

export const getSubscriptionsSchema = z.object({
  pageSize: z.coerce.number().min(1).optional().default(100),
  pageNumber: z.coerce.number().min(1).optional().default(1),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  plan: z.union([z.string(), z.array(z.string())]).optional(),
  subscriptionId: z.union([z.string(), z.array(z.string())]).optional(),
  paymentStatus: z
    .union([
      z.enum(['paid', 'pending', 'refunded']),
      z.array(z.enum(['paid', 'pending', 'refunded'])),
    ])
    .optional(),
});
export const getFrequentMedicinesSchema = z.object({
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).optional(),
  search: z.string().optional(),
  sort: z.enum(['createdAt', 'name']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const topMedicinesQuerySchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(10),
  search: z.string().optional(),
  sort: z
    .enum(['usageCount', 'lastUsed', 'name'])
    .optional()
    .default('usageCount'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
  startDate: z.string().optional(), // Optional date range
  endDate: z.string().optional(), // Optional date range
  timeRange: z.enum(['all', 'month', 'week', 'day']).optional().default('all'),
});

export type FulupdateDoctorScheamasDto = z.infer<typeof updateDoctorScheamas>;
export type getDoctorDoctorIdDto = z.infer<typeof getDoctorDoctorIdScheamas>;
export type AppointmentPlainStatus = z.infer<
  typeof appointmentPlainStatusEnumZ
>;
export type PaymentMode = z.infer<typeof paymentModeEnumZ>;

export type CreateClinicAppointmentPlainDto = z.infer<
  typeof createClinicAppointmentPlainSchema
>;
export type getFrequentMedicinesDto = z.infer<
  typeof getFrequentMedicinesSchema
>;
export type UpdateClinicAppointmentPlainDto = z.infer<
  typeof updateClinicAppointmentPlainSchema
>;
export type PlainIdDto = z.infer<typeof plainIdSchemas>;
export type GetQueryParamsDto = z.infer<typeof getQueryParamsSchema>;
export type deleteServiceDto = z.infer<typeof deleteServiceSchemas>;
export type checkPlainsDto = z.infer<typeof checkPlainsSchemas>;
export type GetSubscriptionsDto = z.infer<typeof getSubscriptionsSchema>;
export type ListUpdateRequestsDto = z.infer<typeof listUpdateRequestsSchema>;
export type ApproveDoctorUpdateDto = z.infer<typeof approveDoctorUpdateSchema>;

export const doctorProfileImageSchema = z.object({
  profileImage: z.any().openapi({
    type: 'string',
    format: 'binary',
    description: 'Doctor profile image file to upload',
  }),
});
