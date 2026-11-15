import express from 'express';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  requireAuth,
  requireClinic,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import {
  adminPharmacyIdParamsSchema,
  adminMedicineParamsSchema,
  createMedicineSchema,
  getMedicinesQuerySchema,
  updateMedicineSchema,
} from '../../schemas/medicine.schema';
import {
  adminAddMedicineController,
  adminGetMedicinesController,
  adminUpdateMedicineController,
} from '../../controllers/medicine.controller';
import {
  FEATURE_KEYS,
  requireFeature,
} from '../../../../middlewear/limitation.middleware';

// Admin view of a specific pharmacy's medicine inventory (pharmacyId as a
// route param, unlike the self-service `medicine.route.ts` which resolves
// the caller's own pharmacy from req.user).
const adminMedicineRouter = express.Router();

adminMedicineRouter.get(
  '/:pharmacyId/get-all-medicines',
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  requireRole(['Admin', 'Super_Admin']),
  validate(adminPharmacyIdParamsSchema, 'params'),
  validate(getMedicinesQuerySchema, 'query'),
  adminGetMedicinesController
);

adminMedicineRouter.post(
  '/:pharmacyId/add-medicine',
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  requireRole(['Admin', 'Super_Admin']),
  validate(adminPharmacyIdParamsSchema, 'params'),
  validate(createMedicineSchema, 'body'),
  adminAddMedicineController
);

adminMedicineRouter.put(
  '/:pharmacyId/update-medicine/:id',
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  requireRole(['Admin', 'Super_Admin']),
  validate(adminMedicineParamsSchema, 'params'),
  validate(updateMedicineSchema, 'body'),
  adminUpdateMedicineController
);

export default adminMedicineRouter;
