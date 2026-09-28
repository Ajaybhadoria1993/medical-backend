import express from 'express';

import { validate } from '../../../../middlewear/validation.middleware';
import { getDoctorPublicProfileController } from '../../controllers/doctorPublic.controller';
import { doctorPublicProfileParamsSchema } from '../../schemas/doctorPublic.schemas';

const doctorPublicRouter = express.Router();

/**
 * @route GET /api/v1/doctor/public/:doctorId
 * @desc Doctor's public marketing profile — credentials, clinics, timings, fees, reviews
 * @access Public (unauthenticated)
 */
doctorPublicRouter.get(
  '/:doctorId',
  validate(doctorPublicProfileParamsSchema, 'params'),
  getDoctorPublicProfileController
);

export default doctorPublicRouter;
