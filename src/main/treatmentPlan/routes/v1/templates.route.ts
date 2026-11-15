import express from 'express';
import {
  requireAuth,
  requireClinic,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  activateTemplateController,
  archiveTemplateController,
  availableTemplatesController,
  checkTemplateController,
  copyTemplateController,
  createTemplateController,
  deactivateTemplateController,
  getLibraryTemplateController,
  getTemplateController,
  listLibraryController,
  listTemplatesController,
  previewTemplateController,
  updateTemplateController,
} from '../../controllers/template.controller';
import {
  activeTemplatesResponse,
  templateDetailResponse,
  templateListResponse,
  templatePreviewResponse,
} from '../../schemas/response.schema';
import {
  templateBodySchema,
  templateCopySchema,
  templateCreateSchema,
  templateIdParamSchema,
  templateListQuerySchema,
  templatePreviewSchema,
} from '../../schemas/template.schema';

// Mounted at /api/v1/treatment-plan/templates; the clinic always comes from the token.
const templatesRouter = express.Router();
const STAFF = ['Admin', 'Doctor', 'Receptionist'];
const EDITORS = ['Admin', 'Doctor'];

/** @route GET /api/v1/treatment-plan/templates — the clinic's templates and the caller's own versions
 *  @access Admin, Doctor, Receptionist (own clinic; archived only when asked for) */
templatesRouter.get(
  '/',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(templateListQuerySchema, 'query'),
  listTemplatesController
);

/** @route GET /api/v1/treatment-plan/templates/available — active templates this doctor may use
 *  @access Doctor (their specialties; own versions replace the clinic copy) */
templatesRouter.get(
  '/available',
  requireAuth,
  requireRole(['Doctor']),
  requireClinic,
  availableTemplatesController
);

/** @route GET /api/v1/treatment-plan/templates/library — active ready-made templates to copy
 *  @access Admin, Doctor */
templatesRouter.get(
  '/library',
  requireAuth,
  requireRole(EDITORS),
  requireClinic,
  validate(templateListQuerySchema, 'query'),
  listLibraryController
);

/** @route GET /api/v1/treatment-plan/templates/library/:id — one active ready-made template
 *  @access Admin, Doctor */
templatesRouter.get(
  '/library/:id',
  requireAuth,
  requireRole(EDITORS),
  requireClinic,
  validate(templateIdParamSchema, 'params'),
  getLibraryTemplateController
);

/** @route POST /api/v1/treatment-plan/templates/preview — sample dates, total and length of a draft
 *  @access Admin, Doctor (computes only, saves nothing) */
templatesRouter.post(
  '/preview',
  requireAuth,
  requireRole(EDITORS),
  requireClinic,
  validate(templatePreviewSchema),
  previewTemplateController
);

/** @route POST /api/v1/treatment-plan/templates — create a draft (clinic template or own version)
 *  @access Admin, Doctor (ownVersion: Doctor only) */
templatesRouter.post(
  '/',
  requireAuth,
  requireRole(EDITORS),
  requireClinic,
  validate(templateCreateSchema),
  createTemplateController
);

/** @route GET /api/v1/treatment-plan/templates/:id — one template with its steps
 *  @access Admin, Doctor, Receptionist (own clinic; own versions: their doctor only) */
templatesRouter.get(
  '/:id',
  requireAuth,
  requireRole(STAFF),
  requireClinic,
  validate(templateIdParamSchema, 'params'),
  getTemplateController
);

/** @route PUT /api/v1/treatment-plan/templates/:id — edit in place; existing plans keep their copy
 *  @access Admin, Doctor (own versions: their doctor only; archived refused) */
templatesRouter.put(
  '/:id',
  requireAuth,
  requireRole(EDITORS),
  requireClinic,
  validate(templateIdParamSchema, 'params'),
  validate(templateBodySchema),
  updateTemplateController
);

/** @route POST /api/v1/treatment-plan/templates/:id/copy — library → clinic, or → the doctor's own version
 *  @access Admin, Doctor (target own: Doctor only; library source must be active) */
templatesRouter.post(
  '/:id/copy',
  requireAuth,
  requireRole(EDITORS),
  requireClinic,
  validate(templateIdParamSchema, 'params'),
  validate(templateCopySchema),
  copyTemplateController
);

/** @route POST /api/v1/treatment-plan/templates/:id/check — mark it checked (needed before activate)
 *  @access Admin, Doctor */
templatesRouter.post(
  '/:id/check',
  requireAuth,
  requireRole(EDITORS),
  requireClinic,
  validate(templateIdParamSchema, 'params'),
  checkTemplateController
);

/** @route POST /api/v1/treatment-plan/templates/:id/activate — offer it to doctors
 *  @access Admin, Doctor (needs "checked" and every price set) */
templatesRouter.post(
  '/:id/activate',
  requireAuth,
  requireRole(EDITORS),
  requireClinic,
  validate(templateIdParamSchema, 'params'),
  activateTemplateController
);

/** @route POST /api/v1/treatment-plan/templates/:id/deactivate — stop offering it
 *  @access Admin, Doctor */
templatesRouter.post(
  '/:id/deactivate',
  requireAuth,
  requireRole(EDITORS),
  requireClinic,
  validate(templateIdParamSchema, 'params'),
  deactivateTemplateController
);

/** @route POST /api/v1/treatment-plan/templates/:id/archive — retire it for good; plans keep their copy
 *  @access Admin, Doctor */
templatesRouter.post(
  '/:id/archive',
  requireAuth,
  requireRole(EDITORS),
  requireClinic,
  validate(templateIdParamSchema, 'params'),
  archiveTemplateController
);

// Paths are relative: loadRoutes prefixes the mount path.
export const apiDocs = [
  {
    method: 'get' as const,
    path: '',
    description: 'Clinic templates and own versions (Staff)',
    query: templateListQuerySchema,
    responseSchema: templateListResponse,
  },
  {
    method: 'get' as const,
    path: '/available',
    description: 'Active templates this doctor may use (Doctor)',
    responseSchema: activeTemplatesResponse,
  },
  {
    method: 'get' as const,
    path: '/library',
    description: 'Active ready-made templates to copy (Admin, Doctor)',
    query: templateListQuerySchema,
    responseSchema: templateListResponse,
  },
  {
    method: 'get' as const,
    path: '/library/:id',
    description: 'One ready-made template (Admin, Doctor)',
    params: templateIdParamSchema,
    responseSchema: templateDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/preview',
    description: 'Sample dates, total and length (Admin, Doctor)',
    requestSchema: templatePreviewSchema,
    responseSchema: templatePreviewResponse,
  },
  {
    method: 'post' as const,
    path: '',
    description: 'Create a draft template (Admin, Doctor)',
    requestSchema: templateCreateSchema,
    responseSchema: templateDetailResponse,
  },
  {
    method: 'get' as const,
    path: '/:id',
    description: 'One template with steps (Staff)',
    params: templateIdParamSchema,
    responseSchema: templateDetailResponse,
  },
  {
    method: 'put' as const,
    path: '/:id',
    description: 'Edit a template in place (Admin, Doctor)',
    params: templateIdParamSchema,
    requestSchema: templateBodySchema,
    responseSchema: templateDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:id/copy',
    description: 'Copy to the clinic or as own version (Admin, Doctor)',
    params: templateIdParamSchema,
    requestSchema: templateCopySchema,
    responseSchema: templateDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:id/check',
    description: 'Mark checked before activating (Admin, Doctor)',
    params: templateIdParamSchema,
    responseSchema: templateDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:id/activate',
    description: 'Activate (Admin, Doctor)',
    params: templateIdParamSchema,
    responseSchema: templateDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:id/deactivate',
    description: 'Deactivate (Admin, Doctor)',
    params: templateIdParamSchema,
    responseSchema: templateDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/:id/archive',
    description: 'Archive (Admin, Doctor)',
    params: templateIdParamSchema,
    responseSchema: templateDetailResponse,
  },
];

export default templatesRouter;
