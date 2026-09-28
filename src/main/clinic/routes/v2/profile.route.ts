// Auto-mounts at /api/v2/clinic/profile.
//
// PUT /api/v2/clinic/profile
// Single consolidated update for the redesigned Clinic Information "Edit"
// page. Independent v2 implementation (does not call into v1's
// `updateClinic`/`updateClinicById`), but accepts the SAME multipart shape
// v1's `PUT /clinic/:clinicId` already accepts (`clinicDetails[...]` fields
// + `clinicLogo` file) and writes to the same `ClinicModel` row — no schema
// changes. v1's `PUT /clinic/:clinicId` is left completely untouched.
import express from 'express';
import {
  enforceClinicAutoLogout,
  requireAuth,
  requireClinic,
  requireUser,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { uploadClinicFormV2 } from '../../../../middlewear/upload.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import { updateClinicSchema } from '../../schemas/clinic.schemas';
import { updateClinicProfileController } from '../../controllers/v2/clinic.controller';
import { parseMultipartClinicProfileData } from '../../middlewares/parseMultipartClinicProfileData';

const ProfileRouterV2 = express.Router();

ProfileRouterV2.put(
  '/',
  requireAuth,
  requireUser,
  requireClinic,
  enforceClinicAutoLogout,
  uploadClinicFormV2.fields([{ name: 'clinicLogo', maxCount: 1 }]),
  parseMultipartClinicProfileData,
  validate(updateClinicSchema, 'body'),
  updateClinicProfileController
);

export default ProfileRouterV2;

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v2/clinic/profile',
  description:
    'Single consolidated update for the Clinic Information edit page (same multipart shape as v1 PUT /clinic/:clinicId)',
  requestSchema: updateClinicSchema,
  contentType: 'multipart/form-data',
  tags: ['clinic'],
});
