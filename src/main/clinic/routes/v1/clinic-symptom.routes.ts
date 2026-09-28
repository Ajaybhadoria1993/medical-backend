// src/main/clinic/routes/v1/clinic-symptom.routes.ts
import { Router } from 'express';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  createClinicSymptomController,
  deleteClinicSymptomController,
  getClinicSymptomsController,
  updateClinicSymptomController,
} from '../../controllers/clinic-symptom.controller';
import {
  createClinicSymptomSchema,
  updateClinicSymptomSchema,
} from '../../schemas/clinic-symptom.schema';

import {
  requireAuth,
  requireClinic,
} from '../../../../middlewear/auth.middleware';

const router = Router();

/**
 * @route POST /api/v1/clinic/symptoms/
 * @desc Create a new symptom for the clinic
 * @access Private (Clinic)
 */
router.post(
  '/',
  requireAuth,
  requireClinic,
  validate(createClinicSymptomSchema, 'body'),
  createClinicSymptomController
);

/**
 * @route PUT /api/v1/clinic/symptoms/:id
 * @desc Update an existing symptom
 * @access Private (Clinic)
 */
router.put(
  '/:id',
  requireAuth,
  requireClinic,
  validate(updateClinicSymptomSchema, 'body'),
  updateClinicSymptomController
);

/**
 * @route DELETE /api/v1/clinic/symptoms/:id
 * @desc Delete a symptom from the clinic
 * @access Private (Clinic)
 */
router.delete(
  '/:id',
  requireAuth,
  requireClinic,
  deleteClinicSymptomController
);

/**
 * @route GET /api/v1/clinic/symptoms/
 * @desc Get all symptoms registered for the clinic
 * @access Private (Clinic)
 */
router.get('/', requireAuth, requireClinic, getClinicSymptomsController);

export default router;
