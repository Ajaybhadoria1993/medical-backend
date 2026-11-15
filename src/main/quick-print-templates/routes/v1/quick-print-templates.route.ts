import express from 'express';
import {
  CLINIC_STAFF_ROLES,
  requireAuth,
  requireClinic,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { requireFeature } from '../../../../middlewear/limitation.middleware';
import { FEATURE_KEYS } from '../../../subscription';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  getQuickPrintTemplateController,
  saveQuickPrintTemplateController,
  setTemplateUsageController,
  setFooterNotesController,
  previewQuickPrintTemplateController,
} from '../../controllers/quickPrintTemplate.controller';
import {
  saveQuickPrintTemplateSchema,
  templateUsageSchema,
  footerNotesBodySchema,
} from '../../schemas/quickPrintTemplate.schemas';

const quickPrintTemplatesRouter = express.Router();

/**
 * @route GET /api/v1/quick-print-templates/
 * @desc Get doctor's quick print template configuration
 * @access Private (authenticated user)
 */
quickPrintTemplatesRouter.get(
  '/',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
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
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(saveQuickPrintTemplateSchema, 'body'),
  saveQuickPrintTemplateController
);

/** PATCH /api/v1/quick-print-templates/usage — which design share and print use. */
quickPrintTemplatesRouter.patch(
  '/usage',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(templateUsageSchema, 'body'),
  setTemplateUsageController
);

/** PATCH /api/v1/quick-print-templates/footer-notes — lines printed above every prescription's footer. */
quickPrintTemplatesRouter.patch(
  '/footer-notes',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(footerNotesBodySchema, 'body'),
  setFooterNotesController
);

/**
 * @route POST /api/v1/quick-print-templates/preview
 * @desc Render live preview of quick print template with sample data
 * @access Private (authenticated user)
 */
quickPrintTemplatesRouter.post(
  '/preview',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  requireFeature(FEATURE_KEYS.CUSTOM_BRANDED_RX),
  previewQuickPrintTemplateController
);

export default quickPrintTemplatesRouter;
