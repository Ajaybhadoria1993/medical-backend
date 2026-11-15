import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  activateLibraryTemplateController,
  archiveLibraryTemplateController,
  checkLibraryTemplateController,
  createLibraryTemplateController,
  createSpecialtyConfigController,
  deactivateLibraryTemplateController,
  getLibraryTemplateController,
  listLibraryTemplatesController,
  listSpecialtyConfigsController,
  updateLibraryTemplateController,
  updateSpecialtyConfigController,
} from '../../controllers/superadmin.controller';
import { previewTemplateController } from '../../controllers/template.controller';
import {
  specialtyConfigListResponse,
  specialtyConfigResponse,
  templateDetailResponse,
  templateListResponse,
  templatePreviewResponse,
} from '../../schemas/response.schema';
import {
  pageQuerySchema,
  specialtyConfigCreateSchema,
  specialtyConfigIdParamSchema,
  specialtyConfigUpdateSchema,
} from '../../schemas/specialtyConfig.schema';
import {
  libraryTemplateSchema,
  templateIdParamSchema,
  templateListQuerySchema,
  templatePreviewSchema,
} from '../../schemas/template.schema';

// Mounted at /api/v1/treatment-plan/superadmin; platform-wide, so Super Admin only.
const superadminTreatmentPlanRouter = express.Router();

/** @route GET /api/v1/treatment-plan/superadmin/templates — the ready-made library, every status
 *  @access Super_Admin */
superadminTreatmentPlanRouter.get(
  '/templates',
  requireAuth,
  requireSuperAdmin,
  validate(templateListQuerySchema, 'query'),
  listLibraryTemplatesController
);

/** @route POST /api/v1/treatment-plan/superadmin/templates — add a ready-made template as a draft
 *  @access Super_Admin */
superadminTreatmentPlanRouter.post(
  '/templates',
  requireAuth,
  requireSuperAdmin,
  validate(libraryTemplateSchema),
  createLibraryTemplateController
);

/** @route POST /api/v1/treatment-plan/superadmin/templates/preview — sample dates, total and length
 *  @access Super_Admin (computes only, saves nothing) */
superadminTreatmentPlanRouter.post(
  '/templates/preview',
  requireAuth,
  requireSuperAdmin,
  validate(templatePreviewSchema),
  previewTemplateController
);

/** @route GET /api/v1/treatment-plan/superadmin/templates/:id — one ready-made template with steps
 *  @access Super_Admin */
superadminTreatmentPlanRouter.get(
  '/templates/:id',
  requireAuth,
  requireSuperAdmin,
  validate(templateIdParamSchema, 'params'),
  getLibraryTemplateController
);

/** @route PUT /api/v1/treatment-plan/superadmin/templates/:id — edit; clinic copies are not changed
 *  @access Super_Admin */
superadminTreatmentPlanRouter.put(
  '/templates/:id',
  requireAuth,
  requireSuperAdmin,
  validate(templateIdParamSchema, 'params'),
  validate(libraryTemplateSchema),
  updateLibraryTemplateController
);

/** @route POST /api/v1/treatment-plan/superadmin/templates/:id/check — mark the defaults reviewed
 *  @access Super_Admin */
superadminTreatmentPlanRouter.post(
  '/templates/:id/check',
  requireAuth,
  requireSuperAdmin,
  validate(templateIdParamSchema, 'params'),
  checkLibraryTemplateController
);

/** @route POST /api/v1/treatment-plan/superadmin/templates/:id/activate — publish for clinics to copy
 *  @access Super_Admin (needs "checked" and every price set) */
superadminTreatmentPlanRouter.post(
  '/templates/:id/activate',
  requireAuth,
  requireSuperAdmin,
  validate(templateIdParamSchema, 'params'),
  activateLibraryTemplateController
);

/** @route POST /api/v1/treatment-plan/superadmin/templates/:id/deactivate — unpublish
 *  @access Super_Admin */
superadminTreatmentPlanRouter.post(
  '/templates/:id/deactivate',
  requireAuth,
  requireSuperAdmin,
  validate(templateIdParamSchema, 'params'),
  deactivateLibraryTemplateController
);

/** @route POST /api/v1/treatment-plan/superadmin/templates/:id/archive — retire for good
 *  @access Super_Admin */
superadminTreatmentPlanRouter.post(
  '/templates/:id/archive',
  requireAuth,
  requireSuperAdmin,
  validate(templateIdParamSchema, 'params'),
  archiveLibraryTemplateController
);

/** @route GET /api/v1/treatment-plan/superadmin/specialty-configs — extra fields per specialty
 *  @access Super_Admin */
superadminTreatmentPlanRouter.get(
  '/specialty-configs',
  requireAuth,
  requireSuperAdmin,
  validate(pageQuerySchema, 'query'),
  listSpecialtyConfigsController
);

/** @route POST /api/v1/treatment-plan/superadmin/specialty-configs — add a specialty's fields
 *  @access Super_Admin (one set per specialty) */
superadminTreatmentPlanRouter.post(
  '/specialty-configs',
  requireAuth,
  requireSuperAdmin,
  validate(specialtyConfigCreateSchema),
  createSpecialtyConfigController
);

/** @route PUT /api/v1/treatment-plan/superadmin/specialty-configs/:id — change fields, widget or active
 *  @access Super_Admin */
superadminTreatmentPlanRouter.put(
  '/specialty-configs/:id',
  requireAuth,
  requireSuperAdmin,
  validate(specialtyConfigIdParamSchema, 'params'),
  validate(specialtyConfigUpdateSchema),
  updateSpecialtyConfigController
);

// Paths are relative: loadRoutes prefixes the mount path.
export const apiDocs = [
  {
    method: 'get' as const,
    path: '/templates',
    description: 'Ready-made library, every status',
    query: templateListQuerySchema,
    responseSchema: templateListResponse,
  },
  {
    method: 'post' as const,
    path: '/templates',
    description: 'Add a ready-made template',
    requestSchema: libraryTemplateSchema,
    responseSchema: templateDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/templates/preview',
    description: 'Sample dates, total and length',
    requestSchema: templatePreviewSchema,
    responseSchema: templatePreviewResponse,
  },
  {
    method: 'get' as const,
    path: '/templates/:id',
    description: 'One ready-made template',
    params: templateIdParamSchema,
    responseSchema: templateDetailResponse,
  },
  {
    method: 'put' as const,
    path: '/templates/:id',
    description: 'Edit a ready-made template',
    params: templateIdParamSchema,
    requestSchema: libraryTemplateSchema,
    responseSchema: templateDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/templates/:id/check',
    description: 'Mark reviewed',
    params: templateIdParamSchema,
    responseSchema: templateDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/templates/:id/activate',
    description: 'Publish',
    params: templateIdParamSchema,
    responseSchema: templateDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/templates/:id/deactivate',
    description: 'Unpublish',
    params: templateIdParamSchema,
    responseSchema: templateDetailResponse,
  },
  {
    method: 'post' as const,
    path: '/templates/:id/archive',
    description: 'Archive',
    params: templateIdParamSchema,
    responseSchema: templateDetailResponse,
  },
  {
    method: 'get' as const,
    path: '/specialty-configs',
    description: 'Specialty field sets',
    query: pageQuerySchema,
    responseSchema: specialtyConfigListResponse,
  },
  {
    method: 'post' as const,
    path: '/specialty-configs',
    description: 'Add a specialty field set',
    requestSchema: specialtyConfigCreateSchema,
    responseSchema: specialtyConfigResponse,
  },
  {
    method: 'put' as const,
    path: '/specialty-configs/:id',
    description: 'Edit a specialty field set',
    params: specialtyConfigIdParamSchema,
    requestSchema: specialtyConfigUpdateSchema,
    responseSchema: specialtyConfigResponse,
  },
];

export default superadminTreatmentPlanRouter;
