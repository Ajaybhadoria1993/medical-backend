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
import { requireUserSubscription } from '../../../../middlewear/subscriptionAccess.middleware';

const prescriptionRouter = express.Router();

prescriptionRouter.get(
  '/get-prescriptions',
  requireAuth,
  requireUserSubscription,
  requirePharmacist,
  requireClinic,
  validate(getPrescriptionQueueQuerySchema, 'query'),
  getPrescriptionsController
);

prescriptionRouter.get(
  '/get-prescription/:id',
  requireAuth,
  requireUserSubscription,
  requirePharmacist,
  requireClinic,
  validate(getPrescriptionByIdParamsSchema, 'params'),
  getPrescriptionByIdController
);

prescriptionRouter.put(
  '/update-prescription-status/:id',
  requireAuth,
  requireUserSubscription,
  requirePharmacist,
  requireClinic,
  validate(updatePrescriptionStatusParamsSchema, 'params'),
  validate(updatePrescriptionStatusSchema, 'body'),
  updatePrescriptionStatusController
);

prescriptionRouter.post(
  '/check-medicines',
  requireAuth,
  requireUserSubscription,
  requirePharmacist,
  validate(checkMedicinesSchema, 'body'),
  checkMedicinesController
);

prescriptionRouter.get(
  '/stats',
  requireAuth,
  requireUserSubscription,
  getPrescriptionStatsController
);

export default prescriptionRouter;
