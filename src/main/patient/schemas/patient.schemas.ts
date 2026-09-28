// src/main/patient/schemas/patient.schemas.ts
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { normalizePaymentMode } from '../../appointments/utils/paymentMode.constants';
extendZodWithOpenApi(z);

/**
 * Normalise mobile: strips non-digits, accepts 10-digit Indian numbers
 * or E.164 format (+91XXXXXXXXXX / +XXXXXXXXXXX).
 */
const mobileSchema = z
  .string()
  .trim()
  .min(1, 'Mobile number is required')
  .refine(
    (val) => {
      const digits = val.replace(/\D/g, '');
      // Accept 10-digit local or 12-digit with country code (91XXXXXXXXXX)
      return /^[6-9]\d{9}$/.test(digits) || /^91[6-9]\d{9}$/.test(digits);
    },
    { message: 'Enter a valid 10-digit Indian mobile number' }
  );

/**
 * POST /api/v1/patient/send-otp
 * Body: { mobile }
 */
export const sendMobileOtpSchema = z.object({
  mobile: mobileSchema,
});

/**
 * POST /api/v1/patient/verify-otp
 * Body: { mobile, otp }
 */
export const verifyMobileOtpSchema = z.object({
  mobile: mobileSchema,
  otp: z
    .string()
    .length(6, 'OTP must be exactly 6 digits')
    .regex(/^\d{6}$/, 'OTP must contain digits only'),
  // Which client is logging in — lets web and the mobile app hold
  // independent sessions for the same patient instead of one evicting
  // the other. Defaults to 'web' (the patient web portal) if omitted.
  platform: z.enum(['web', 'ios', 'android']).optional().default('web'),
});

/**
 * POST /api/v1/patient/resend-otp
 * Body: { mobile }
 */
export const resendMobileOtpSchema = z.object({
  mobile: mobileSchema,
});

// ─── Inferred DTO types ───────────────────────────────────────────────────────
export type SendMobileOtpDto = z.infer<typeof sendMobileOtpSchema>;
export type VerifyMobileOtpDto = z.infer<typeof verifyMobileOtpSchema>;
export type ResendMobileOtpDto = z.infer<typeof resendMobileOtpSchema>;

// ─── Patient Profile Completion ───────────────────────────────────────────────

/**
 * PATCH /api/v1/patient/complete-profile
 * Called after OTP login when isNewUser=true (or whenever the patient updates
 * their profile). All fields are optional — patient fills what they have.
 */
/**
 * PATCH /api/v1/patient/complete-profile
 *
 * Collects identity, contact, and medical details for the primary patient.
 */
export const completePatientProfileSchema = z.object({
  // ── users table ────────────────────────────────────────────────────────────
  name: z.string().trim().min(1, 'Name cannot be empty').optional(),
  email: z
    .string()
    .trim()
    .min(5)
    .max(254)
    .regex(
      /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}$/,
      'Invalid email format'
    )
    .refine((val) => !val.endsWith('.'), {
      message: 'Email cannot end with a dot',
    })
    .optional(),

  // ── user_profiles table — identity & contact ───────────────────────────────
  gender: z.enum(['Male', 'Female', 'Other']).optional(),
  alternateMobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit alternate mobile number')
    .optional(),
  address: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
  zipCode: z.string().max(10).nullable().optional(),

  // ── user_profiles table — medical ─────────────────────────────────────────
  dob: z.string().trim().min(1).optional(),
  age: z.number().int().min(0).max(150).optional(),
  bloodGroup: z
    .enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
    .optional(),
  height: z.string().trim().max(10).optional(),
  weight: z.string().trim().max(10).optional(),
  allergies: z.array(z.string()).optional(),
  chronicConditions: z.array(z.string()).optional(),
});

export type CompletePatientProfileDto = z.infer<
  typeof completePatientProfileSchema
>;

// ─── Family Member Schemas ────────────────────────────────────────────────────

const relationshipEnum = z.enum([
  'spouse',
  'child',
  'parent',
  'sibling',
  'friend',
  'other',
]);

/**
 * POST /api/v1/patient/family
 * Add a family member. Members are created as dependents with mobile=NULL
 * and can only be accessed through the primary patient account.
 */
export const addFamilyMemberSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  relationship: relationshipEnum,
  // profile fields
  gender: z.enum(['Male', 'Female', 'Other']).optional(),
  age: z.number().int().min(0).max(150).optional(),
  dob: z.string().min(1).optional(),
  alternateMobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit alternate mobile number')
    .optional(),
  address: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  zipCode: z.string().max(10).nullable().optional(),
  bloodGroup: z
    .enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
    .optional(),
  height: z.string().max(10).optional(),
  weight: z.string().max(10).optional(),
  allergies: z.array(z.string()).optional(),
  chronicConditions: z.array(z.string()).optional(),
});

/**
 * PATCH /api/v1/patient/family/:familyMemberId
 * Update a family member's profile. Only allowed when their userStatus = 'New'.
 */
export const updateFamilyMemberSchema = z.object({
  name: z.string().min(1, 'Name cannot be empty').optional(),
  relationship: relationshipEnum.optional(),
  gender: z.enum(['Male', 'Female', 'Other']).optional(),
  age: z.number().int().min(0).max(150).optional(),
  dob: z.string().min(1).optional(),
  alternateMobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit alternate mobile number')
    .optional(),
  address: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  zipCode: z.string().max(10).nullable().optional(),
  bloodGroup: z
    .enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
    .optional(),
  height: z.string().max(10).optional(),
  weight: z.string().max(10).optional(),
  allergies: z.array(z.string()).optional(),
  chronicConditions: z.array(z.string()).optional(),
});

/**
 * GET /api/v1/patient/family
 * Query params for paginating the family members list.
 */
export const listFamilyMembersQuerySchema = z.object({
  pageNumber: z.string().min(1).optional(),
  pageSize: z.string().min(1).optional(),
});

/**
 * Route params: /family/:familyMemberId
 */
export const familyMemberParamsSchema = z.object({
  familyMemberId: z.string().uuid('Invalid family member ID'),
});

export type AddFamilyMemberDto = z.infer<typeof addFamilyMemberSchema>;
export type UpdateFamilyMemberDto = z.infer<typeof updateFamilyMemberSchema>;
export type FamilyMemberParamsDto = z.infer<typeof familyMemberParamsSchema>;
export type ListFamilyMembersQueryDto = z.infer<
  typeof listFamilyMembersQuerySchema
>;

export const updateProfileImageSchema = z.object({
  profileImage: z.any().openapi({
    type: 'string',
    format: 'binary',
    description: 'The profile image file (JPG, PNG, WebP, SVG) to upload',
  }),
});

// ─── Patient Search & Booking schemas ─────────────────────────────────────────

export const patientDirectorySearchSchema = z.object({
  search: z.string().trim().optional(),
  speciality: z.string().trim().optional(),
  city: z.string().trim().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().min(0).optional().default(10), // in kilometers
  pageNumber: z.string().trim().optional().default('1'),
  pageSize: z.string().trim().optional().default('10'),
  available: z
    .preprocess((val) => {
      if (val === 'true') return true;
      if (val === 'false') return false;
      return val;
    }, z.boolean())
    .optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .optional(),
});

export const patientDoctorProfileSchema = z.object({
  doctorId: z.string().uuid('Invalid doctor ID'),
});

export const patientDoctorSlotsQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  clinicId: z.string().uuid('Invalid clinic ID'),
});

export const patientBookingSchema = z.object({
  doctorId: z.string().uuid('Invalid doctor ID'),
  clinicId: z.string().uuid('Invalid clinic ID'),
  clinicServiceId: z.string().uuid('Invalid service ID'),
  appointmentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  appointmentTime: z.string().trim().optional().nullable(),
  patientId: z.string().uuid('Invalid patient ID'),
  notes: z.string().trim().optional(),
  sessionIndex: z.coerce.number().int().positive().max(10).optional(),
  // Combined payment fields matching receptionist booking
  paymentMode: z
    .preprocess(
      (val) => (typeof val === 'string' ? normalizePaymentMode(val) : val),
      z.string().trim()
    )
    .optional(),
  paymentGateway: z.string().trim().optional(),
  paymentStatus: z.string().trim().optional(),
  price: z.string().trim().optional(),
  paymentNotes: z.string().trim().optional(),
});

export type PatientDirectorySearchDto = z.infer<
  typeof patientDirectorySearchSchema
>;
export type PatientDoctorProfileDto = z.infer<
  typeof patientDoctorProfileSchema
>;
export type PatientDoctorSlotsQueryDto = z.infer<
  typeof patientDoctorSlotsQuerySchema
>;
export type PatientBookingDto = z.infer<typeof patientBookingSchema>;

export const patientAppointmentsParamsSchema = z.object({
  patientId: z.string().uuid('Invalid patient ID'),
});
export type PatientAppointmentsParamsDto = z.infer<
  typeof patientAppointmentsParamsSchema
>;

export const patientAppointmentDetailParamsSchema = z.object({
  appointmentId: z.string().uuid('Invalid appointment ID'),
});
export type PatientAppointmentDetailParamsDto = z.infer<
  typeof patientAppointmentDetailParamsSchema
>;

// Live Queue "Notify me when" push preferences.
export const liveQueueNotifyPrefsSchema = z.object({
  myTurn: z.boolean(),
  patientsAheadThreshold: z
    .number()
    .int('Must be a whole number')
    .min(1, 'Must be at least 1')
    .max(50, 'Must be at most 50')
    .nullable(),
  doctorArrives: z.boolean(),
});
export type LiveQueueNotifyPrefsDto = z.infer<
  typeof liveQueueNotifyPrefsSchema
>;

export const patientAppointmentsQuerySchema = z.object({
  pageNumber: z.string().trim().optional().default('1'),
  pageSize: z.string().trim().optional().default('10'),
  appointmentStatus: z
    .preprocess(
      (val) => {
        if (typeof val === 'string') {
          return val.split(',').map((s) => s.trim());
        }
        if (Array.isArray(val)) {
          return val;
        }
        return val;
      },
      z.array(
        z.enum([
          'Upcoming',
          'Completed',
          'Cancelled',
          'Rescheduled',
          'Pending',
          'Missed',
          'Confirmed',
          'Patient Arrived',
          'NoShow',
        ])
      )
    )
    .optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid startDate format (YYYY-MM-DD)')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid endDate format (YYYY-MM-DD)')
    .optional(),
  upcomingOnly: z
    .preprocess((val) => val === 'true' || val === true, z.boolean())
    .optional(),
  pastOnly: z
    .preprocess((val) => val === 'true' || val === true, z.boolean())
    .optional(),
  sortBy: z.enum(['appointmentDate', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});
export type PatientAppointmentsQueryDto = z.infer<
  typeof patientAppointmentsQuerySchema
>;

export const patientLabReportsQuerySchema = z.object({
  patientId: z.string().uuid('Invalid patient ID').optional(),
  pageNumber: z.string().trim().optional().default('1'),
  pageSize: z.string().trim().optional().default('10'),
  status: z.enum(['Initiated', 'InProgress', 'Completed']).optional(),
});
export type PatientLabReportsQueryDto = z.infer<
  typeof patientLabReportsQuerySchema
>;

export const patientPrescriptionsQuerySchema = z.object({
  patientId: z.string().uuid('Invalid patient ID').optional(),
  search: z.string().trim().optional(),
  pageNumber: z.string().trim().optional().default('1'),
  pageSize: z.string().trim().optional().default('10'),
});
export type PatientPrescriptionsQueryDto = z.infer<
  typeof patientPrescriptionsQuerySchema
>;

export const patientAssociatedDocumentsQuerySchema = z.object({
  patientId: z.string().uuid('Invalid patient ID').optional(),
  documentType: z
    .enum([
      'gallery',
      'manual_prescription',
      'consent_file',
      'digital_prescription',
      'lab_report',
    ])
    .optional(),
  search: z.string().trim().optional(),
  pageNumber: z.string().trim().optional().default('1'),
  pageSize: z.string().trim().optional().default('10'),
});
export type PatientAssociatedDocumentsQueryDto = z.infer<
  typeof patientAssociatedDocumentsQuerySchema
>;

// ─── Patient Device & Notification Schemas ─────────────────────────────────────

export const registerDeviceSchema = z.object({
  deviceToken: z.string().min(1, 'Device token is required'),
  platform: z.enum(['ios', 'android']),
});

export const unregisterDeviceParamsSchema = z.object({
  deviceToken: z.string().min(1, 'Device token is required'),
});

export const patientNotificationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const patientNotificationParamsSchema = z.object({
  notificationId: z.string().uuid('Invalid notification ID'),
});

export type RegisterDeviceDto = z.infer<typeof registerDeviceSchema>;
export type UnregisterDeviceParamsDto = z.infer<
  typeof unregisterDeviceParamsSchema
>;
export type PatientNotificationListQueryDto = z.infer<
  typeof patientNotificationListQuerySchema
>;
export type PatientNotificationParamsDto = z.infer<
  typeof patientNotificationParamsSchema
>;

export const verifyAppointmentPaymentSchema = z.object({
  appointmentId: z.string().uuid('Invalid appointment ID'),
  orderId: z.string().trim().min(1, 'Order ID is required'),
  paymentId: z.string().trim().min(1, 'Payment ID is required'),
  signature: z.string().trim().min(1, 'Signature is required'),
});

export type VerifyAppointmentPaymentDto = z.infer<
  typeof verifyAppointmentPaymentSchema
>;

export const listFavoriteDoctorsQuerySchema = z.object({
  pageNumber: z.string().trim().optional().default('1'),
  pageSize: z.string().trim().optional().default('10'),
});

export type ListFavoriteDoctorsQueryDto = z.infer<
  typeof listFavoriteDoctorsQuerySchema
>;

export const getBookingCancellationPolicySchema = z
  .object({
    clinicId: z.string().uuid('Invalid clinic ID').optional(),
    doctorId: z.string().uuid('Invalid doctor ID').optional(),
  })
  .refine((data) => data.clinicId || data.doctorId, {
    message: 'Either clinicId or doctorId must be provided',
    path: ['clinicId'],
  });

export type GetBookingCancellationPolicyDto = z.infer<
  typeof getBookingCancellationPolicySchema
>;

export const patientAppointmentTestParamsSchema = z.object({
  appointmentTestId: z.string().uuid('Invalid appointment test ID'),
});

export type PatientAppointmentTestParamsDto = z.infer<
  typeof patientAppointmentTestParamsSchema
>;

export const patientRecentActivityQuerySchema = z.object({
  type: z
    .enum(['all', 'appointment', 'lab_test', 'prescription'])
    .optional()
    .default('all'),
  patientId: z.string().uuid('Invalid patient ID').optional(),
  pageNumber: z.string().trim().optional().default('1'),
  pageSize: z.string().trim().optional().default('5'),
});

export type PatientRecentActivityQueryDto = z.infer<
  typeof patientRecentActivityQuerySchema
>;

export const patientRescheduleSchema = z.object({
  appointmentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  appointmentTime: z.string().trim().optional().nullable(),
  comments: z.string().trim().optional(),
  /**
   * Which shift to move into: 1 = first, 2 = second. Optional — inferred on a
   * single-session day and on today; a future date with several sessions is
   * rejected rather than guessed at.
   */
  sessionIndex: z.coerce.number().int().positive().max(10).optional(),
});

export type PatientRescheduleDto = z.infer<typeof patientRescheduleSchema>;

export const patientPricingPreviewQuerySchema = z
  .object({
    clinicId: z.string().uuid('Invalid clinic ID'),
    price: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/, 'Price must be a valid positive number')
      .optional(),
    clinicServiceId: z.string().uuid('Invalid clinic service ID').optional(),
    doctorId: z.string().uuid('Invalid doctor ID').optional(),
  })
  .refine(
    (data) =>
      data.price !== undefined ||
      data.clinicServiceId !== undefined ||
      data.doctorId !== undefined,
    {
      message:
        'Either price, clinicServiceId, or doctorId must be provided to determine consultation price',
      path: ['price'],
    }
  );

export type PatientPricingPreviewQueryDto = z.infer<
  typeof patientPricingPreviewQuerySchema
>;
