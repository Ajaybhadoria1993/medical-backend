import express from 'express';
import {
  requireAuth,
  requireClinic,
} from '../../../../middlewear/auth.middleware';
import { requireFeature } from '../../../../middlewear/limitation.middleware';
import { FEATURE_KEYS } from '../../../subscription/services/limitation.service';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  getQuickPrintTemplateController,
  saveQuickPrintTemplateController,
  previewQuickPrintTemplateController,
} from '../../controllers/quickPrintTemplate.controller';
import { saveQuickPrintTemplateSchema } from '../../schemas/quickPrintTemplate.schemas';

const quickPrintTemplatesRouter = express.Router();

/**
 * @route GET /api/v1/quick-print-templates/
 * @desc Get doctor's quick print template configuration
 * @access Private (authenticated user)
 */
quickPrintTemplatesRouter.get(
  '/',
  requireAuth,
  getQuickPrintTemplateController
);

/**
 * @route POST /api/v1/quick-print-templates/
 * @desc Save doctor's quick print template configuration
 * @access Private (authenticated user)
 */
quickPrintTemplatesRouter.post(
  '/',
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.CUSTOM_BRANDED_RX),
  validate(saveQuickPrintTemplateSchema, 'body'),
  saveQuickPrintTemplateController
);

/**
 * @route POST /api/v1/quick-print-templates/preview
 * @desc Render live preview of quick print template with sample data
 * @access Private (authenticated user)
 */
quickPrintTemplatesRouter.post(
  '/preview',
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.CUSTOM_BRANDED_RX),
  previewQuickPrintTemplateController
);

export default quickPrintTemplatesRouter;
