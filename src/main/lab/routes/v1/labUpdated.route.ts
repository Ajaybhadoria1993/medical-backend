import { Router } from 'express';
import {
  requireAuth,
  requireLab,
  requireLabClinicContext,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import {
  FEATURE_KEYS,
  requireFeature,
} from '../../../../middlewear/limitation.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  applyLabUpdatedSuggestionsController,
  getLabBillingHistoryController,
  getReferringDoctorsController,
  getLabUpdatedActiveDepartmentController,
  getLabUpdatedDetailsController,
  getLabUpdatedSuggestionsController,
  getLabUpdatedTestResultParametersController,
  getLabOrderActivitiesController,
  getLabSampleCodeSettingsController,
  updateLabSampleCodeSettingsController,
} from '../../controllers/labUpdated.controller';
import { getLabOrdersQuerySchema } from '../../schemas/labOrder.schemas';
import {
  applyLabUpdatedSuggestionsSchema,
  getReferringDoctorsQuerySchema,
  getLabTestResultParametersByTestIdsSchema,
  getLabOrderActivitiesSchema,
  updateLabSampleCodeSettingsSchema,
} from '../../schemas/labUpdated.schemas';

const labUpdatedRouter = Router();

labUpdatedRouter.use(
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant', 'Receptionist']),
  requireLab,
  requireLabClinicContext,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION)
);

labUpdatedRouter.get('/details', getLabUpdatedDetailsController);

labUpdatedRouter.get(
  '/active-department',
  getLabUpdatedActiveDepartmentController
);

labUpdatedRouter.get(
  '/settings/auto-generate-sample-code',
  getLabSampleCodeSettingsController
);

labUpdatedRouter.patch(
  '/settings/auto-generate-sample-code',
  validate(updateLabSampleCodeSettingsSchema, 'body'),
  updateLabSampleCodeSettingsController
);

labUpdatedRouter.get(
  '/billing-history',
  validate(getLabOrdersQuerySchema, 'query'),
  getLabBillingHistoryController
);

labUpdatedRouter.get(
  '/referring-doctors',
  validate(getReferringDoctorsQuerySchema, 'query'),
  getReferringDoctorsController
);

labUpdatedRouter.get('/suggestions', getLabUpdatedSuggestionsController);

labUpdatedRouter.get(
  '/test-result-parameters',
  validate(getLabTestResultParametersByTestIdsSchema, 'query'),
  getLabUpdatedTestResultParametersController
);

labUpdatedRouter.post(
  '/activities',
  validate(getLabOrderActivitiesSchema, 'body'),
  getLabOrderActivitiesController
);

labUpdatedRouter.post(
  '/suggestions',
  validate(applyLabUpdatedSuggestionsSchema, 'body'),
  applyLabUpdatedSuggestionsController
);

export default labUpdatedRouter;
