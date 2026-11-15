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
  addLabHomeCollectionPricingController,
  getLabHomeCollectionPricingController,
  updateLabHomeCollectionPricingController,
} from '../../controllers/labHomeCollection.controller';
import {
  createLabHomeCollectionSchema,
  getLabHomeCollectionsQuerySchema,
  labHomeCollectionIdParamSchema,
  updateLabHomeCollectionSchema,
} from '../../schemas/labHomeCollection.schemas';

const labHomeCollectionRouter = Router();

labHomeCollectionRouter.use(
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant', 'Receptionist']),
  requireLab,
  requireLabClinicContext,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION)
);

labHomeCollectionRouter.post(
  '/',
  validate(createLabHomeCollectionSchema, 'body'),
  addLabHomeCollectionPricingController
);

labHomeCollectionRouter.get(
  '/',
  validate(getLabHomeCollectionsQuerySchema, 'query'),
  getLabHomeCollectionPricingController
);

labHomeCollectionRouter.put(
  '/:homeCollectionId',
  validate(labHomeCollectionIdParamSchema, 'params'),
  validate(updateLabHomeCollectionSchema, 'body'),
  updateLabHomeCollectionPricingController
);

export default labHomeCollectionRouter;
