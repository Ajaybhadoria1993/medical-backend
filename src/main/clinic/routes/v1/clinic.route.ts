// src/main/clinic/routes/v1/clinic.route.ts
import express from 'express';

import {
  requireAdmin,
  requireAuth,
  requireClinic,
  requireUser,
  requireSuperAdmin,
  enforceClinicAutoLogout,
} from '../../../../middlewear/auth.middleware';
import {
  otpRateLimit,
  strictRateLimit,
} from '../../../../middlewear/rateLimit.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import {
  assignClincToUserCrontroller,
  createCliniController,
  getClinicCliniController,
  getCliniController,
  updateCliniController,
  getAvailableClinicsController,
  getClinicDetailController,
  updateClinicStatusController,
  resetClinicOnboardingController,
  deleteClinicController,
  restoreClinicController,
  updateClinicByIdController,
  upsertClinicSettingsController,
  getClinicSettingsController,
  deleteClinicReminderController,
  getClinicsWithDoctorsController,
  onboardClinicRouteController,
  activateClinicRouteController,
  setDoctorOnlineBookingController,
  setDoctorConsultationDurationController,
  getDoctorConsultationDurationController,
  getDoctorOnlineBookingController,
  getClinicBankDetailsController,
  onboardDocumentsController,
  updateClinicBankDetailsController,
  getClinicOnboardingStatusController,
  requestClinicPhoneUpdateController,
  verifyClinicPhoneController,
  resendClinicPhoneOtpController,
} from '../../controllers/clinic.controller';
import {
  assignClincToUserSchemas,
  fullDoctorClinicSchema,
  getClinicSchema,
  updateClinicSchema,
  availableClinicsQuerySchema,
  clinicDetailParamsSchema,
  resetClinicOnboardingSchema,
  deleteClinicSchema,
  updateClinicStatusSchema,
  upsertClinicSettingsSchema,
  reminderParamsSchema,
  getClinicsWithDoctorsQuerySchema,
  doctorOnlineBookingParamsSchema,
  doctorOnlineBookingBodySchema,
  doctorConsultationDurationBodySchema,
  onboardRouteSchema,
  updateBankDetailsSchema,
  updatePhoneRequestSchema,
  verifyPhoneSchema,
} from '../../schemas/clinic.schemas';

import { uploadClinicForm } from '../../../../middlewear/upload.middleware';
import { parseMultipartDoctorData } from '../../../doctor/routes/v1/doctor.route';
import multer from 'multer';

const uploadDoc = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

const ClinicRouter = express.Router();

/**
 * Middleware to parse multipart form data for clinic
 */
const parseMultipartClinicData = (req: any, res: any, next: any) => {
  if (req.body && typeof req.body === 'object') {
    const newBody: any = {};

    for (const key in req.body) {
      let value = req.body[key];

      // 🔹 Try JSON parse for array/object strings (QUALIFICATIONS FIX)
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (
          (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))
        ) {
          try {
            value = JSON.parse(trimmed);
          } catch {
            // ignore → Zod will handle invalid JSON
          }
        }
      }

      if (key.includes('[') && key.includes(']')) {
        // Handle nested fields like clinicDetails[clinicName]
        const [parent, child] = key.split(/\[|\]/).filter(Boolean);

        if (!newBody[parent]) newBody[parent] = {};

        // Convert ZipCode to number
        if (child === 'ZipCode' && value) {
          const num = parseInt(value, 10);
          if (!isNaN(num)) value = num;
        }

        // Convert boolean fields
        if (child === 'isAdminDoctorAccess') {
          value = value === 'true' || value === true;
        }

        newBody[parent][child] = value;
      } else {
        newBody[key] = value;
      }
    }

    // 🔹 Handle uploaded files
    if (req.files) {
      const files = req.files as {
        [fieldname: string]: Express.Multer.File[];
      };

      // Clinic Logo
      if (files.clinicLogo?.[0]) {
        if (!newBody.clinicDetails) newBody.clinicDetails = {};
        newBody.clinicDetails.clinicLogo = (
          files.clinicLogo[0] as any
        ).location;
      }

      // Admin Profile Image
      if (files.profileImage?.[0]) {
        if (!newBody.adminProfile) newBody.adminProfile = {};
        newBody.adminProfile.profileImage = (
          files.profileImage[0] as any
        ).location;
      }
    }

    req.body = newBody;
  }

  next();
};

/**
 * @route GET /api/v1/clinic/available
 * @desc Get all available clinics with pagination and search
 * @access Private (Auth)
 */

ClinicRouter.get(
  '/clinics-with-doctors',
  requireAuth,
  requireSuperAdmin,
  validate(getClinicsWithDoctorsQuerySchema, 'query'),
  getClinicsWithDoctorsController
);

ClinicRouter.post(
  '/onboard-route',
  requireAuth,
  requireClinic,
  enforceClinicAutoLogout,
  validate(onboardRouteSchema, 'body'),
  onboardClinicRouteController
);

ClinicRouter.post(
  '/activate-route',
  requireAuth,
  requireClinic,
  enforceClinicAutoLogout,
  activateClinicRouteController
);

ClinicRouter.post(
  '/onboard-documents',
  requireAuth,
  requireClinic,
  enforceClinicAutoLogout,
  uploadDoc.single('file'),
  onboardDocumentsController
);

ClinicRouter.get(
  '/onboarding-status',
  requireAuth,
  requireClinic,
  enforceClinicAutoLogout,
  getClinicOnboardingStatusController
);

ClinicRouter.patch(
  '/bank-details',
  requireAuth,
  requireClinic,
  enforceClinicAutoLogout,
  validate(updateBankDetailsSchema, 'body'),
  updateClinicBankDetailsController
);

ClinicRouter.get(
  '/bank-details',
  requireAuth,
  requireClinic,
  enforceClinicAutoLogout,
  getClinicBankDetailsController
);

ClinicRouter.post(
  '/settings',
  requireAuth,
  requireClinic,
  enforceClinicAutoLogout,
  validate(upsertClinicSettingsSchema, 'body'),
  upsertClinicSettingsController
);

ClinicRouter.get(
  '/settings',
  requireAuth,
  requireClinic,
  enforceClinicAutoLogout,
  getClinicSettingsController
);

ClinicRouter.post(
  '/phone/update-request',
  requireAuth,
  requireClinic,
  enforceClinicAutoLogout,
  validate(updatePhoneRequestSchema, 'body'),
  requestClinicPhoneUpdateController
);

ClinicRouter.post(
  '/phone/verify',
  requireAuth,
  requireClinic,
  enforceClinicAutoLogout,
  validate(verifyPhoneSchema, 'body'),
  verifyClinicPhoneController
);

ClinicRouter.post(
  '/phone/resend-otp',
  requireAuth,
  requireClinic,
  enforceClinicAutoLogout,
  otpRateLimit,
  validate(updatePhoneRequestSchema, 'body'),
  resendClinicPhoneOtpController
);

ClinicRouter.get(
  '/doctors/:doctorId/online-booking',
  requireAuth,
  requireClinic,
  enforceClinicAutoLogout,
  validate(doctorOnlineBookingParamsSchema, 'params'),
  getDoctorOnlineBookingController
);

ClinicRouter.patch(
  '/doctors/:doctorId/online-booking',
  requireAuth,
  requireClinic,
  enforceClinicAutoLogout,
  validate(doctorOnlineBookingParamsSchema, 'params'),
  validate(doctorOnlineBookingBodySchema, 'body'),
  setDoctorOnlineBookingController
);

ClinicRouter.get(
  '/doctors/:doctorId/consultation-duration',
  requireAuth,
  requireClinic,
  enforceClinicAutoLogout,
  validate(doctorOnlineBookingParamsSchema, 'params'),
  getDoctorConsultationDurationController
);

/**
 * @route PATCH /api/v1/clinic/doctors/:doctorId/consultation-duration
 * @desc Set a doctor's consultation length at this clinic
 * @access Private (Admin, or the doctor themselves)
 */
ClinicRouter.patch(
  '/doctors/:doctorId/consultation-duration',
  requireAuth,
  requireClinic,
  enforceClinicAutoLogout,
  validate(doctorOnlineBookingParamsSchema, 'params'),
  validate(doctorConsultationDurationBodySchema, 'body'),
  setDoctorConsultationDurationController
);

ClinicRouter.put(
  '/delete-reminder/:reminderId',
  requireAuth,
  requireClinic,
  validate(reminderParamsSchema, 'params'),
  deleteClinicReminderController
);

/**
 * @route GET /api/v1/clinic
 * @desc Get clinic list
 * @access Private (SuperAdmin)
 */
ClinicRouter.get(
  '/available',
  requireAuth,
  requireSuperAdmin,
  validate(availableClinicsQuerySchema, 'query'),
  getAvailableClinicsController
);

/**
 * @route GET /api/v1/clinic/detail/:clinicId
 * @desc Get full clinic details (users, pharmacies, labs, payments)
 * @access Private (SuperAdmin)
 */
ClinicRouter.get(
  '/detail/:clinicId',
  requireAuth,
  requireSuperAdmin,
  validate(clinicDetailParamsSchema, 'params'),
  getClinicDetailController
);

/**
 * @route PATCH /api/v1/clinic/:clinicId/status
 * @desc Change a clinic's lifecycle status (Active/Inactive/Blocked)
 * @access Private (SuperAdmin)
 */
ClinicRouter.patch(
  '/:clinicId/status',
  requireAuth,
  requireSuperAdmin,
  validate(clinicDetailParamsSchema, 'params'),
  validate(updateClinicStatusSchema, 'body'),
  updateClinicStatusController
);

/**
 * @route POST /api/v1/clinic/:clinicId/reset-onboarding
 * @desc Send a clinic back through the onboarding wizard (no data is deleted).
 *       Rate limited because it takes the caller's own password.
 * @access Private (SuperAdmin)
 */
ClinicRouter.post(
  '/:clinicId/reset-onboarding',
  requireAuth,
  requireSuperAdmin,
  strictRateLimit,
  validate(clinicDetailParamsSchema, 'params'),
  validate(resetClinicOnboardingSchema, 'body'),
  resetClinicOnboardingController
);

/**
 * @route POST /api/v1/clinic/:clinicId/delete
 * @desc Soft-delete a clinic (Inactive + hidden; no rows removed).
 * @access Private (SuperAdmin)
 */
ClinicRouter.post(
  '/:clinicId/delete',
  requireAuth,
  requireSuperAdmin,
  strictRateLimit,
  validate(clinicDetailParamsSchema, 'params'),
  validate(deleteClinicSchema, 'body'),
  deleteClinicController
);

/**
 * @route POST /api/v1/clinic/:clinicId/restore
 * @desc Undo a soft delete; the clinic and owner go back to Active.
 * @access Private (SuperAdmin)
 */
ClinicRouter.post(
  '/:clinicId/restore',
  requireAuth,
  requireSuperAdmin,
  strictRateLimit,
  validate(clinicDetailParamsSchema, 'params'),
  validate(deleteClinicSchema, 'body'),
  restoreClinicController
);

/**
 * @route POST /api/v1/clinic/
 * @desc Create a new clinic and associate with current user
 * @access Private (Admin)
 */
ClinicRouter.post(
  '/',
  requireAuth,
  requireAdmin,
  uploadClinicForm.fields([
    { name: 'clinicLogo', maxCount: 1 },
    { name: 'profileImage', maxCount: 1 },
  ]),
  parseMultipartClinicData,
  validate(fullDoctorClinicSchema, 'body'),
  createCliniController
);

/**
 * @route PUT /api/v1/clinic/
 * @desc Update clinic information
 * @access Private (Admin)
 */
ClinicRouter.put(
  '/',
  requireAuth,
  requireAdmin,
  uploadClinicForm.fields([
    { name: 'clinicLogo', maxCount: 1 },
    { name: 'profileImage', maxCount: 1 },
  ]),
  parseMultipartClinicData,
  parseMultipartDoctorData,
  validate(updateClinicSchema, 'body'),
  updateCliniController
);

ClinicRouter.put(
  '/:clinicId',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(getClinicSchema, 'params'),
  uploadClinicForm.fields([
    { name: 'clinicLogo', maxCount: 1 },
    { name: 'profileImage', maxCount: 1 },
  ]),
  parseMultipartClinicData,
  validate(updateClinicSchema, 'body'),
  updateClinicByIdController
);

/**
 * @route GET /api/v1/clinic/user
 * @desc Get all clinics associated with the current user
 * @access Private (User, Clinic)
 */
ClinicRouter.get(
  '/user',
  requireAuth,
  requireUser,
  requireClinic,
  enforceClinicAutoLogout,
  getClinicCliniController
);

/**
 * @route GET /api/v1/clinic/:clinicId
 * @desc Get details of a specific clinic by ID
 * @access Private (Admin)
 */
ClinicRouter.get(
  '/:clinicId',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(getClinicSchema, 'params'),
  getCliniController
);

/**
 * @route GET /api/v1/clinic/assign/:clinicId
 * @desc Assign current user to a specific clinic
 * @access Private (Admin)
 */
ClinicRouter.get(
  '/assign/:clinicId',
  requireAuth,
  requireAdmin,
  validate(assignClincToUserSchemas, 'params'),
  assignClincToUserCrontroller
);

export default ClinicRouter;

// Register endpoints with schemas
docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/clinic',
  description: 'Create a clinic',
  requestSchema: fullDoctorClinicSchema,
  contentType: 'multipart/form-data',
  tags: ['clinic'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/clinic',
  description: 'Update a clinic',
  requestSchema: updateClinicSchema,
  query: getClinicSchema, // e.g., ?clinicId=uuid
  contentType: 'multipart/form-data',
  tags: ['clinic'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/clinic/:clinicId',
  description: 'Update a clinic by id (includes block/active status)',
  requestSchema: updateClinicSchema,
  params: getClinicSchema,
  contentType: 'multipart/form-data',
  tags: ['clinic'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/clinic/user',
  description: 'Get all clinics',
  tags: ['clinic'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/clinic/:clinicId',
  description: 'Get clinic by id',
  params: getClinicSchema, // e.g., /api/v1/clinic/:clinicId
  tags: ['clinic'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/clinic/assign/:clinicId',
  description: 'Get assigned clinic by id',
  params: assignClincToUserSchemas, // e.g., /api/v1/clinic/assign/:userId
  tags: ['clinic'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/clinic/available',
  description: 'Get available clinics with pagination and search',
  query: availableClinicsQuerySchema,
  tags: ['clinic'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/clinic/detail/:clinicId',
  description:
    'Get full clinic details including users, pharmacies, labs, and payments',
  params: clinicDetailParamsSchema,
  tags: ['clinic'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/clinic/:clinicId/reset-onboarding',
  description:
    'Super admin only. Sends a clinic back through the onboarding wizard, ' +
    'confirmed with the super admin’s own password. No clinic data is deleted.',
  params: clinicDetailParamsSchema,
  requestSchema: resetClinicOnboardingSchema,
  tags: ['clinic'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/clinic/:clinicId/delete',
  description:
    'Super admin only. Soft-deletes a clinic, confirmed with the super ' +
    'admin’s own password. The clinic goes Inactive and no data is removed.',
  params: clinicDetailParamsSchema,
  requestSchema: deleteClinicSchema,
  tags: ['clinic'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/clinic/:clinicId/restore',
  description:
    'Super admin only. Restores a soft-deleted clinic to Active on the free ' +
    'plan. Appointments cancelled by the delete stay cancelled.',
  params: clinicDetailParamsSchema,
  requestSchema: deleteClinicSchema,
  tags: ['clinic'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/clinic/onboard-route',
  description:
    'Onboard clinic to Razorpay Route (Create linked partner account)',
  tags: ['clinic'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/clinic/bank-details',
  description:
    'Get currently active verified Razorpay bank account details for clinic',
  tags: ['clinic'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/clinic/phone/update-request',
  description:
    'Request OTP to update clinic phone number (Indian mobile numbers only)',
  requestSchema: updatePhoneRequestSchema,
  tags: ['clinic'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/clinic/phone/verify',
  description: 'Verify OTP to update clinic phone number',
  requestSchema: verifyPhoneSchema,
  tags: ['clinic'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/clinic/phone/resend-otp',
  description:
    'Resend OTP for an in-progress clinic phone verification (1-min cooldown, max resends per session)',
  requestSchema: updatePhoneRequestSchema,
  tags: ['clinic'],
});
