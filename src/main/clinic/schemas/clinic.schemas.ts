import { z } from 'zod';
import {
  checkSpecializationLimits,
  specialitySchema,
  specializationSchema,
} from '../../../utils/specialtyCatalog';
import { doctorQualificationsSchema } from '../../doctor/schemas/doctor.schemas';

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
  speciality: specialitySchema.optional(),
  specialization: specializationSchema.optional(),
  registrationNumber: z.string().optional(),
  yearsOfExperience: optionalYearsOfExperienceSchema,
});

// 📍 5. Final Schema Wrapper
export const fullDoctorClinicSchema = z
  .object({
    clinicDetails: clinicDetailsSchema,
    adminProfile: adminProfileSchema.partial().optional(),
  })
  .superRefine(
    (data, ctx) =>
      data.adminProfile &&
      checkSpecializationLimits(data.adminProfile, ctx, ['adminProfile'])
  );

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

// // 📍 2. Doctor Profile
const updateAdminProfileSchema = z.object({
  name: z.string().min(2).optional(),
  mobile: z.string().optional().or(z.literal('')),
  alternateMobile: z.string().optional().or(z.literal('')),
  profileImage: z.string().optional(),
  isAdminDoctorAccess: z.boolean().optional(),
  speciality: specialitySchema.optional(),
  specialization: specializationSchema.optional(),
  registrationNumber: z.string().optional(),
  yearsOfExperience: optionalYearsOfExperienceSchema,
  upiIds: z.array(z.string()).optional(),
  qualifications: doctorQualificationsSchema.optional(),
});

export const updateClinicSchema = z
  .object({
    clinicDetails: updateClinicDetailsSchema.partial().optional(),
    adminProfile: updateAdminProfileSchema.partial().optional(),
    qualifications: doctorQualificationsSchema.optional(),
  })
  .superRefine(
    (data, ctx) =>
      data.adminProfile &&
      checkSpecializationLimits(data.adminProfile, ctx, ['adminProfile'])
  );

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

// Light picker lookup: a few rows of id/name/code, by search text or by known ids.
export const clinicLookupQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  ids: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.string().uuid('Invalid clinic id')).max(50).optional()),
  limit: z.coerce.number().int().min(1).max(20).optional().default(10),
});

export type ClinicLookupQueryDto = z.infer<typeof clinicLookupQuerySchema>;

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
export const INDIAN_STATES_AND_UTS = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
] as const;

const normalizedHumanText = (value: string) =>
  value.normalize('NFKC').replace(/\s+/g, ' ').trim();

export const onboardRouteSchema = z
  .object({
    legalBusinessName: z
      .string()
      .transform(normalizedHumanText)
      .pipe(
        z
          .string()
          .min(4, 'Legal business name must be at least 4 characters')
          .max(200, 'Legal business name cannot exceed 200 characters')
          .regex(
            /^[\p{L}\p{M}\p{N} .,&'()/-]+$/u,
            'Use letters, numbers, spaces, and standard business punctuation only'
          )
      ),
    businessType: z.enum([
      'individual',
      'partnership',
      'proprietorship',
      'llp',
      'public_limited',
      'private_limited',
    ]),
    businessPan: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid business PAN format')
      .optional(),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/,
        'Invalid GSTIN format'
      )
      .optional(),
    address: z.object({
      street1: z
        .string()
        .transform(normalizedHumanText)
        .pipe(
          z
            .string()
            .min(2, 'Address line 1 must be at least 2 characters')
            .max(100, 'Address line 1 cannot exceed 100 characters')
        ),
      street2: z
        .string()
        .transform(normalizedHumanText)
        .pipe(
          z
            .string()
            .min(2, 'Address line 2 must be at least 2 characters')
            .max(100, 'Address line 2 cannot exceed 100 characters')
        ),
      city: z
        .string()
        .transform(normalizedHumanText)
        .pipe(
          z
            .string()
            .min(2, 'City must be at least 2 characters')
            .max(100, 'City cannot exceed 100 characters')
            .regex(
              /^[\p{L}\p{M} -]+$/u,
              'City can contain letters, spaces, and hyphens only'
            )
        ),
      state: z
        .string()
        .transform((value) => {
          const normalized = normalizedHumanText(value);
          return (
            INDIAN_STATES_AND_UTS.find(
              (state) => state.toLowerCase() === normalized.toLowerCase()
            ) ?? normalized
          );
        })
        .pipe(z.enum(INDIAN_STATES_AND_UTS)),
      postalCode: z.preprocess(
        (value) => (typeof value === 'string' ? value.trim() : String(value)),
        z
          .string()
          .regex(
            /^[1-9]\d{5}$/,
            'PIN code must be exactly 6 digits and cannot start with 0'
          )
          .transform(Number)
      ),
    }),
    stakeholder: z.object({
      name: z
        .string()
        .transform(normalizedHumanText)
        .pipe(
          z
            .string()
            .min(4, 'Stakeholder name must be at least 4 characters')
            .max(255, 'Stakeholder name cannot exceed 255 characters')
            .regex(
              /^[\p{L}\p{M} .]+$/u,
              'Stakeholder name can contain letters, spaces, and dots only; enter it as shown on PAN'
            )
        ),
      email: z
        .string()
        .trim()
        .toLowerCase()
        .max(132, 'Stakeholder email cannot exceed 132 characters')
        .email('Invalid stakeholder email address'),
      phone: z
        .string()
        .trim()
        .regex(
          /^[6-9]\d{9}$/,
          'Phone number must be a valid 10-digit mobile number starting with 6-9'
        ),
      pan: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN card format'),
      relationship: z
        .object({
          director: z.boolean(),
          executive: z.boolean(),
        })
        .default({ director: false, executive: true }),
      percentageOwnership: z
        .number()
        .min(0)
        .max(100)
        .multipleOf(
          0.01,
          'Ownership percentage can have at most 2 decimal places'
        )
        .optional(),
    }),
    bankDetails: z
      .object({
        beneficiaryName: z
          .string()
          .trim()
          .min(2, 'Beneficiary name must be at least 2 characters'),
        accountNumber: z
          .string()
          .refine(
            (value) => /^\d{5,35}$/.test(value.replace(/\s+/g, '')),
            'Account number must be between 5 and 35 digits'
          )
          .transform((value) => value.replace(/\s+/g, '')),
        ifscCode: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code format'),
        accountType: z.enum(['savings', 'current']),
      })
      .optional(),
    // Payouts to a UPI ID instead of a bank account (Razorpay verifies it instantly).
    upi: z
      .object({
        vpa: z
          .string()
          .trim()
          .toLowerCase()
          .regex(
            /^[a-z0-9.-_]{2,256}@[a-z]{2,64}$/,
            'Enter a UPI ID like name@bank'
          ),
        beneficiaryName: z
          .string()
          .trim()
          .min(2, 'Name must be at least 2 characters'),
      })
      .optional(),
    tncAccepted: z.literal(true, {
      message: 'You must accept the terms and conditions',
    }),
  })
  .superRefine((data, ctx) => {
    if (!data.bankDetails === !data.upi)
      ctx.addIssue({
        code: 'custom',
        path: ['bankDetails'],
        message: 'Give either a bank account or a UPI ID',
      });
    if (
      ['partnership', 'llp', 'public_limited', 'private_limited'].includes(
        data.businessType
      ) &&
      !data.businessPan
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['businessPan'],
        message: 'Business PAN is required for this legal entity type',
      });
    }

    const isCompany = ['private_limited', 'public_limited'].includes(
      data.businessType
    );
    const isFirm = ['partnership', 'llp'].includes(data.businessType);
    const expectedBusinessPanType = isCompany ? 'C' : isFirm ? 'F' : undefined;
    if (
      expectedBusinessPanType &&
      data.businessPan &&
      data.businessPan[3] !== expectedBusinessPanType
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['businessPan'],
        message: `PAN status character does not match ${data.businessType.replace('_', ' ')} business type`,
      });
    }
    if (data.stakeholder.pan[3] !== 'P') {
      ctx.addIssue({
        code: 'custom',
        path: ['stakeholder', 'pan'],
        message: 'Stakeholder PAN must be a personal PAN (4th character P)',
      });
    }
    if (
      ['individual', 'proprietorship'].includes(data.businessType) &&
      data.businessPan &&
      data.businessPan !== data.stakeholder.pan
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['businessPan'],
        message:
          'Individual and proprietorship accounts use the proprietor’s personal PAN; it must match the stakeholder PAN',
      });
    }
    if (data.gstin) {
      const expectedPan = data.businessPan || data.stakeholder.pan;
      if (data.gstin.slice(2, 12) !== expectedPan) {
        ctx.addIssue({
          code: 'custom',
          path: ['gstin'],
          message:
            'GSTIN PAN must match the business PAN or proprietor PAN supplied here',
        });
      }
    }
    if (
      data.businessType === 'proprietorship' &&
      /\b(?:private\s+limited|pvt\.?\s*ltd\.?)\b/i.test(data.legalBusinessName)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['businessType'],
        message:
          'The legal name contains a Private Limited suffix; confirm the business type and legal PAN before continuing',
      });
    }
  });

export type OnboardRouteDto = z.infer<typeof onboardRouteSchema>;

// 📍 7. Razorpay Bank Details Update Schema
export const updateBankDetailsSchema = z.object({
  beneficiaryName: z
    .string()
    .trim()
    .min(2, 'Beneficiary name must be at least 2 characters'),
  accountNumber: z
    .string()
    .refine(
      (value) => /^\d{5,35}$/.test(value.replace(/\s+/g, '')),
      'Account number must be between 5 and 35 digits'
    )
    .transform((value) => value.replace(/\s+/g, '')),
  ifscCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code format'),
  accountType: z.enum(['savings', 'current']),
});

export type UpdateBankDetailsDto = z.infer<typeof updateBankDetailsSchema>;
