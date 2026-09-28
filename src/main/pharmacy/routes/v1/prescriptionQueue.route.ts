import express from 'express';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import {
  requireAuth,
  requireClinic,
  requirePharmacist,
} from '../../../../middlewear/auth.middleware';
import {
  getPrescriptionQueueListController,
  updatePrescriptionStatusController,
  // getPrescriptionQueueDetailsController,
} from '../../controllers/prescriptionQueue.controller';
import {
  getPrescriptionQueueListSchema,
  updatePrescriptionStatusSchema,
  getPrescriptionQueueDetailsSchema,
  updatePrescriptionStatusParamsSchema,
} from '../../schemas/prescriptionQueue.schemas';

const prescriptionQueueRouter = express.Router();

/**
 * @route GET /api/v1/prescription-queue
 * @desc Get prescription queue list (Clinic Based)
 * @access Private
 */
prescriptionQueueRouter.get(
  '/getPrescriptions',
  requireAuth,
  requirePharmacist,
  requireClinic,
  validate(getPrescriptionQueueListSchema, 'query'),
  getPrescriptionQueueListController
);

/**
 * @route GET /api/v1/prescription-queue/:id
 * @desc Get prescription queue details by ID
 * @access Private
 */

/**
 * @route PUT /api/v1/prescription-queue/:id/status
 * @desc Update prescription queue status
 * @access Private
 */
prescriptionQueueRouter.put(
  '/:id/status',
  requireAuth,
  requirePharmacist,
  requireClinic,
  validate(updatePrescriptionStatusParamsSchema, 'params'), // validate params
  validate(updatePrescriptionStatusSchema, 'body'), // validate body
  updatePrescriptionStatusController
);

export default prescriptionQueueRouter;
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/prescription-queue/getPrescriptions',
  description: 'Get prescription queue list (clinic-based)',
  requestSchema: getPrescriptionQueueListSchema,
  tags: ['prescription-queue'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/prescription-queue/:id',
  description: 'Get prescription queue details by ID',
  requestSchema: getPrescriptionQueueDetailsSchema,
  tags: ['prescription-queue'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/prescription-queue/:id/status',
  description: 'Update prescription queue status',
  requestSchema: updatePrescriptionStatusSchema,
  tags: ['prescription-queue'],
});
