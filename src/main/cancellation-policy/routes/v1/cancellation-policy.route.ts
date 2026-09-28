import express from 'express';
import {
  requireAuth,
  requireClinic,
  requireReceptionist,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  updateClinicCancellationPolicySchema,
  requestCancellationSchema,
} from '../../schemas/cancellationPolicy.schemas';
import {
  getReasonsController,
  getClinicPolicyController,
  updateClinicPolicyController,
  cancelAppointmentController,
  getDefaultPolicyController,
} from '../../controllers/cancellationPolicy.controller';
import { docsRegistry } from '../../../../utils/docsRegistry';

const cancellationPolicyRouter = express.Router();

/**
 * @route GET /api/v1/cancellation-policy/reasons
 * @desc Retrieve list of cancellation reasons
 * @access Private (Auth)
 */
cancellationPolicyRouter.get('/reasons', requireAuth, getReasonsController);

/**
 * @route GET /api/v1/cancellation-policy/default
 * @desc Retrieve platform default clinic cancellation policy settings
 * @access Private (Auth)
 */
cancellationPolicyRouter.get(
  '/default',
  requireAuth,
  getDefaultPolicyController
);

/**
 * @route GET /api/v1/cancellation-policy/clinic
 * @desc Get active policy settings for a clinic
 * @access Private (Clinic)
 */
cancellationPolicyRouter.get(
  '/clinic',
  requireAuth,
  requireClinic,
  getClinicPolicyController
);

/**
 * @route PUT /api/v1/cancellation-policy/clinic
 * @desc Create/Update clinic cancellation policy version
 * @access Private (Clinic Admin)
 */
cancellationPolicyRouter.put(
  '/clinic',
  requireAuth,
  requireClinic,
  requireReceptionist, // Clinic Admin, Receptionist, Doctor roles are authorized
  validate(updateClinicCancellationPolicySchema, 'body'),
  updateClinicPolicyController
);

/**
 * @route POST /api/v1/cancellation-policy/appointment/:appointmentId/cancel
 * @desc Cancel appointment (Staff-initiated)
 * @access Private (Clinic)
 */
cancellationPolicyRouter.post(
  '/appointment/:appointmentId/cancel',
  requireAuth,
  requireClinic,
  requireReceptionist,
  validate(requestCancellationSchema, 'body'),
  cancelAppointmentController
);

export default cancellationPolicyRouter;

// Register API Documentation
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/cancellation-policy/reasons',
  description: 'Retrieve cancellation reasons master list',
  tags: ['cancellation-policy'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/cancellation-policy/default',
  description: 'Get platform default clinic cancellation policy configurations',
  tags: ['cancellation-policy'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/cancellation-policy/clinic',
  description: 'Get clinic cancellation policy configurations',
  tags: ['cancellation-policy'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/cancellation-policy/clinic',
  description: 'Update clinic cancellation policy settings',
  requestSchema: updateClinicCancellationPolicySchema,
  tags: ['cancellation-policy'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/cancellation-policy/appointment/:appointmentId/cancel',
  description: 'Cancel an appointment (Clinic Staff)',
  params: requestCancellationSchema,
  tags: ['cancellation-policy'],
});
