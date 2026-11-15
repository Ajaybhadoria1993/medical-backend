import express from 'express';

import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import {
  getDoctorPublicProfileController,
  getPublicSearchCitiesController,
  searchPublicDoctorsController,
} from '../../controllers/doctorPublic.controller';
import {
  doctorPublicProfileParamsSchema,
  doctorPublicSearchQuerySchema,
} from '../../schemas/doctorPublic.schemas';

const doctorPublicRouter = express.Router();

/** @route GET /api/v1/doctor/public/cities — cities with bookable clinics, for the city box
 *  @access Public (unauthenticated); registered before /:doctorId, which would match "cities" */
doctorPublicRouter.get('/cities', getPublicSearchCitiesController);

/** @route GET /api/v1/doctor/public/search — public Find-a-doctor list (bookable clinics only)
 *  @access Public (unauthenticated); registered before /:doctorId, which would match "search" */
doctorPublicRouter.get(
  '/search',
  validate(doctorPublicSearchQuerySchema, 'query'),
  searchPublicDoctorsController
);

/**
 * @route GET /api/v1/doctor/public/:doctorId
 * @desc Doctor's public marketing profile — credentials, clinics, timings, fees, reviews.
 *       :doctorId accepts the doctor's id or their username.
 * @access Public (unauthenticated)
 */
doctorPublicRouter.get(
  '/:doctorId',
  validate(doctorPublicProfileParamsSchema, 'params'),
  getDoctorPublicProfileController
);

export default doctorPublicRouter;

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/public/cities',
  description:
    'Cities that have at least one clinic taking online bookings (unauthenticated)',
  tags: ['doctor', 'public'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/public/search',
  description:
    'Public Find-a-doctor search (unauthenticated): name/clinic, specialty, city or location, experience',
  query: doctorPublicSearchQuerySchema,
  tags: ['doctor', 'public'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/public/:doctorId',
  description:
    "Public doctor profile (unauthenticated). doctorId may be the doctor's id or their username",
  params: doctorPublicProfileParamsSchema,
  tags: ['doctor', 'public'],
});
