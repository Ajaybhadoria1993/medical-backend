import express from 'express';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  requireAuth,
  requireClinic,
  requirePharmacist,
} from '../../../../middlewear/auth.middleware';
import {
  checkMedicinesSchema,
  getPrescriptionByIdParamsSchema,
  getPrescriptionQueueQuerySchema,
  updatePrescriptionStatusParamsSchema,
  updatePrescriptionStatusSchema,
} from '../../schemas/prescription.schema';
import {
  checkMedicinesController,
  getPrescriptionByIdController,
  getPrescriptionsController,
  getPrescriptionStatsController,
  updatePrescriptionStatusController,
} from '../../controllers/prescription.controller';
import {
  FEATURE_KEYS,
  requireFeature,
} from '../../../../middlewear/limitation.middleware';

const prescriptionRouter = express.Router();

prescriptionRouter.get(
  '/get-prescriptions',
  requireAuth,
  requirePharmacist,
  requireClinic,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(getPrescriptionQueueQuerySchema, 'query'),
  getPrescriptionsController
);

prescriptionRouter.get(
  '/get-prescription/:id',
  requireAuth,
  requirePharmacist,
  requireClinic,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(getPrescriptionByIdParamsSchema, 'params'),
  getPrescriptionByIdController
);

prescriptionRouter.put(
  '/update-prescription-status/:id',
  requireAuth,
  requirePharmacist,
  requireClinic,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(updatePrescriptionStatusParamsSchema, 'params'),
  validate(updatePrescriptionStatusSchema, 'body'),
  updatePrescriptionStatusController
);

prescriptionRouter.post(
  '/check-medicines',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  requirePharmacist,
  validate(checkMedicinesSchema, 'body'),
  checkMedicinesController
);

prescriptionRouter.get(
  '/stats',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  getPrescriptionStatsController
);

export default prescriptionRouter;
