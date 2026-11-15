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
  getLabReportConfigurationController,
  previewLabReportController,
  upsertLabReportConfigurationController,
} from '../../controllers/labReport.controller';
import {
  previewLabReportSchema,
  upsertLabUpdatedReportSchema,
} from '../../schemas/labReport.schemas';

const labReportRouter = Router();

labReportRouter.use(
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant', 'Receptionist']),
  requireLab,
  requireLabClinicContext,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION)
);

labReportRouter.get('/', getLabReportConfigurationController);

labReportRouter.post(
  '/preview',
  validate(previewLabReportSchema, 'body'),
  previewLabReportController
);

labReportRouter.post(
  '/',
  validate(upsertLabUpdatedReportSchema, 'body'),
  upsertLabReportConfigurationController
);

export default labReportRouter;
