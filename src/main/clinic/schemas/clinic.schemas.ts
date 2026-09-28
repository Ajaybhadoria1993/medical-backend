import { z } from 'zod';

const optionalYearsOfExperienceSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.coerce.number().int().nonnegative().nullable().optional()
);

export const indianMobileSchema = z
  .string()
  .transform((val) => val.replace(/[\s\-()+]/g, '')) // Strip whitespace, dashes, brackets, plus sign
  .refine(
    (val) => {
      let cleaned = val;
      if (cleaned.startsWith('91') && cleaned.length === 12) {
        cleaned = cleaned.substring(2);
      } else if (cleaned.startsWith('0')) {
        cleaned = cleaned.substring(1);
      }
      return /^[6-9]\d{9}$/.test(cleaned);
    },
    {
      message:
        'Invalid Indian mobile number. Must be a 10-digit number starting with 6-9 (optional +91/91/0 prefix).',
    }
  )
  .transform((val) => {
    let cleaned = val;
    if (cleaned.startsWith('91') && cleaned.length === 12) {
      cleaned = cleaned.substring(2);
    } else if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }
    return cleaned;
  });

export const updatePhoneRequestSchema = z.object({
  phone: indianMobileSchema,
});

export const verifyPhoneSchema = z.object({
  phone: indianMobileSchema,
  otp: z.string().regex(/^\d{6}$/, 'OTP must be exactly 6 digits'),
});

// Enum for currency (expand as needed)
// const currencyEnum = z.enum(['INR', 'USD', 'EUR']);

// 📍 1. Clinic Details
const clinicDetailsSchema = z.object({
  clinicName: z.string().min(2),
  clinicPhone: z.string().min(10).max(15),
  Tagline: z.string().optional(),
  clinicAddress: z.string().optional(),
  clinicLocation: z.string().optional(),
  State: z.string(),
  City: z.string(),
  ZipCode: z.coerce
    .number()
    .int()
    .refine(
      (n) => n >= 100000 && n <= 999999,
      'ZipCode must be exactly 6 digits'
    ),
  clinicLogo: z.string().optional(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
});

// // 📍 2. Doctor Profile
const adminProfileSchema = z.object({
  name: z.string().min(2),
  // email: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'invalid email'),
  mobile: z.string().trim().optional().or(z.literal('')),

  alternateMobile: z.string().trim().optional().or(z.literal('')),
  profileImage: z.string().optional(),
  isAdminDoctorAccess: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (val === true || val === 'true') return true;
      if (val === false || val === 'false') return false;
      return false;
    }),
  speciality: z.string().optional(),
  specialization: z.array(z.string()).optional(),
  registrationNumber: z.string().optional(),
  yearsOfExperience: optionalYearsOfExperienceSchema,
});

// 📍 5. Final Schema Wrapper
export const fullDoctorClinicSchema = z.object({
  clinicDetails: clinicDetailsSchema,
  adminProfile: adminProfileSchema.partial().optional(),
});

export type FullDoctorClinicDto = z.infer<typeof fullDoctorClinicSchema>;

export const getClinicSchema = z.object({
  clinicId: z.string(),
});

// 📍 1. Clinic Details
const updateClinicDetailsSchema = z.object({
  clinicName: z.string().min(2).optional(),
  clinicPhone: z.string().min(10).max(15).optional().or(z.literal('')),
  Tagline: z.string().optional().optional(),
  clinicAddress: z.string().optional().optional(),
  clinicLocation: z.string().optional().optional(),
  State: z.string().optional(),
  City: z.string().optional(),
  ZipCode: z.coerce.number().int().min(100000).optional(), // assuming Indian PIN codes
  clinicLogo: z.string().optional().optional(),
  // status changes go through the Super Admin-only PATCH /clinic/:clinicId/status
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
});

export const doctorQualificationSchema = z.object({
  id: z.string().optional(),
  qualificationType: z.string(),
  qualificationTitle: z.string(),
  // specialization: z.string().optional(),
  boardOrUniversity: z.string().optional(),
  yearOfCompletion: z.coerce.number().int().optional(),
});

export const doctorQualificationsSchema = z.array(doctorQualificationSchema);

// // 📍 2. Doctor Profile
const updateAdminProfileSchema = z.object({
  name: z.string().min(2).optional(),
  mobile: z.string().optional().or(z.literal('')),
  alternateMobile: z.string().optional().or(z.literal('')),
  profileImage: z.string().optional(),
  isAdminDoctorAccess: z.boolean().optional(),
  speciality: z.string().optional(),
  specialization: z.array(z.string()).optional(),
  registrationNumber: z.string().optional(),
  yearsOfExperience: optionalYearsOfExperienceSchema,
  upiIds: z.array(z.string()).optional(),
  qualifications: doctorQualificationsSchema.optional(),
});

export const updateClinicSchema = z.object({
  clinicDetails: updateClinicDetailsSchema.partial().optional(),
  adminProfile: updateAdminProfileSchema.partial().optional(),
  qualifications: doctorQualificationsSchema.optional(),
});

export type FulUpdateClinicSchemaDto = z.infer<typeof updateClinicSchema>;

export const assignClincToUserSchemas = z.object({
  clinicId: z.uuid().min(1, 'clinicId is required'),
});
export type AssignClincToUserDto = z.infer<typeof assignClincToUserSchemas>;

export const availableClinicsQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('10'),
  search: z.string().optional(),
  // approved clinics only — 'Pending'/'Rejected' live on the Clinic Requests board
  status: z.enum(['Active', 'Inactive', 'Blocked', 'Deleted']).optional(),
});

export type AvailableClinicsQueryDto = z.infer<
  typeof availableClinicsQuerySchema
>;

export const clinicDetailParamsSchema = z.object({
  clinicId: z.string().uuid('Invalid clinicId'),
});

export const updateClinicStatusSchema = z.object({
  status: z.enum(['Active', 'Inactive', 'Blocked'], {
    message: 'status must be one of Active, Inactive or Blocked',
  }),
});

export type UpdateClinicStatusDto = z.infer<typeof updateClinicStatusSchema>;

export const resetClinicOnboardingSchema = z.object({
  // The super admin's own password, re-entered to confirm the action.
  password: z.string().min(1, 'Password is required'),
  reason: z.string().trim().max(500, 'Reason is too long').optional(),
});

export type ResetClinicOnboardingDto = z.infer<
  typeof resetClinicOnboardingSchema
>;

// Same confirmation as a reset: the super admin's password plus a reason.
export const deleteClinicSchema = resetClinicOnboardingSchema;
export type DeleteClinicDto = ResetClinicOnboardingDto;

export const reminderParamsSchema = z.object({
  reminderId: z.string().uuid('Invalid reminderId'),
});

const clinicSettingsSchema = z.object({
  voiceCallEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),

  loginAlertsEnabled: z.boolean().optional(),

  autoLogoutMinutes: z.number().int().min(1).nullable().optional(),

  runningLateThresholdMinutes: z
    .number()
    .int()
    .min(5)
    .max(60)
    .default(10)
    .optional(),

  onlineBookingEnabled: z.boolean().optional(),

  payOnlineEnabled: z.boolean().optional(),

  payAtClinicEnabled: z.boolean().optional(),

  showClinicNumberPublicly: z.boolean().optional(),

  /**
   * What happens to a patient who checks in after the no-show grace period.
   * Lateness itself is defined by `no_show_policies.gracePeriodMinutes`, not
   * here — one clinic must not carry two definitions of "late".
   */
  latePatientPolicy: z
    .enum(['keep_position', 'move_back', 'move_to_end'])
    .optional(),

  latePatientMovePositions: z.number().int().min(1).max(20).optional(),

  defaultConsultationMinutes: z
    .number()
    .int()
    .min(5)
    .max(90)
    .nullable()
    .optional(),
});

const reminderSchema = z.object({
  id: z.string().uuid().optional(),

  timeValue: z.number().int().min(1),

  timeUnit: z.enum(['Minutes', 'Hours', 'Days']),

  reminderType: z.string().min(1),

  isActive: z.boolean().optional(),
});

export const upsertClinicSettingsSchema = z.object({
  settings: clinicSettingsSchema.optional(),

  reminders: z.array(reminderSchema).optional(),
});

export const doctorOnlineBookingParamsSchema = z.object({
  doctorId: z.string().uuid(),
});

export const doctorOnlineBookingBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    maxAdvanceBookingDays: z.number().int().min(1).max(90).optional(),
  })
  .refine(
    (v) => v.enabled !== undefined || v.maxAdvanceBookingDays !== undefined,
    { message: 'At least one field must be provided.' }
  );

/** Null clears it, handing the doctor back to the learned or clinic figure. */
export const doctorConsultationDurationBodySchema = z.object({
  defaultConsultationMinutes: z.number().int().min(5).max(90).nullable(),
});

export const getClinicsWithDoctorsQuerySchema = z
  .object({
    startDate: z
      .string()
      .datetime({ message: 'Invalid start date format' })
      .optional(),
    endDate: z
      .string()
      .datetime({ message: 'Invalid end date format' })
      .optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return new Date(data.startDate) <= new Date(data.endDate);
      }
      return true;
    },
    {
      message: 'startDate must be less than or equal to endDate',
      path: ['endDate'],
    }
  );

export type ClinicSettingsDto = z.infer<typeof clinicSettingsSchema>;
export type ClinicReminderDto = z.infer<typeof reminderSchema>;
export type UpsertClinicSettingsDto = z.infer<
  typeof upsertClinicSettingsSchema
>;
export type GetClinicsWithDoctorsQuery = z.infer<
  typeof getClinicsWithDoctorsQuerySchema
>;

// 📍 6. Razorpay Custom Onboarding Schema
export const onboardRouteSchema = z.object({
  legalBusinessName: z
    .string()
    .min(2, 'Legal business name must be at least 2 characters'),
  businessType: z.enum([
    'individual',
    'partnership',
    'proprietorship',
    'public_limited',
    'private_limited',
  ]),
  address: z.object({
    street: z.string().min(5, 'Street address must be at least 5 characters'),
    city: z.string().min(2, 'City must be at least 2 characters'),
    state: z.string().min(2, 'State must be at least 2 characters'),
    postalCode: z.coerce
      .number()
      .int()
      .min(100000)
      .max(999999, 'Pincode must be exactly 6 digits'),
  }),
  stakeholder: z.object({
    name: z.string().min(2, 'Stakeholder name must be at least 2 characters'),
    email: z.string().email('Invalid stakeholder email address'),
    phone: z
      .string()
      .regex(
        /^[6-9]\d{9}$/,
        'Phone number must be a valid 10-digit mobile number starting with 6-9'
      ),
    pan: z
      .string()
      .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN card format'),
    dob: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}$/,
        'Date of Birth must be in YYYY-MM-DD format'
      ),
  }),
  bankDetails: z.object({
    beneficiaryName: z
      .string()
      .min(2, 'Beneficiary name must be at least 2 characters'),
    accountNumber: z
      .string()
      .min(5)
      .max(35, 'Account number must be between 5 and 35 digits'),
    ifscCode: z
      .string()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code format'),
    accountType: z.enum(['savings', 'current']),
  }),
  tncAccepted: z.literal(true, {
    message: 'You must accept the terms and conditions',
  }),
});

export type OnboardRouteDto = z.infer<typeof onboardRouteSchema>;

// 📍 7. Razorpay Bank Details Update Schema
export const updateBankDetailsSchema = z.object({
  beneficiaryName: z
    .string()
    .min(2, 'Beneficiary name must be at least 2 characters'),
  accountNumber: z
    .string()
    .min(5)
    .max(35, 'Account number must be between 5 and 35 digits'),
  ifscCode: z
    .string()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code format'),
  accountType: z.enum(['savings', 'current']),
});

export type UpdateBankDetailsDto = z.infer<typeof updateBankDetailsSchema>;
