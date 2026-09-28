// src/main/reports/routes/v1/reports.route.ts
import express from 'express';
import {
  requireAdmin,
  requireAuth,
  requireClinic,
  requireDoctor,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { requireFeature } from '../../../../middlewear/limitation.middleware';
import { FEATURE_KEYS } from '../../../subscription/services/limitation.service';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  createPatientReportCardController,
  createReportController,
  deleteFavouritePrescriptionController,
  getAllClinicReportController,
  getAppoinmentsPrescriptionsReportController,
  getCurrentTemplateController,
  getFavouritePrescriptionController,
  getPrescriptionPdfController,
  getPrescriptionSectionsConfigController,
  getPrescriptionTemplateController,
  getPrescriptionTemplateSectionsController,
  getPreviewPrescriptionTemplateController,
  getReportCardController,
  getReportController,
  getTranslationLanguagesController,
  getTranslationSettingsController,
  getTranslationsController,
  savePrescriptionSectionsController,
  updatePatientReportCardController,
  updateReportController,
  updateTranslationController,
  updateTranslationSettingsController,
  upsertPrescriptionTemplateController,
} from '../../controllers/report.controller';
import {
  createReportAndPrescriptionsSchemas,
  createReportSchema,
  getAllReportsParamSchema,
  getAllReportsQuerySchema,
  getPatientIdParamsSchema,
  getPatientIdQuerySchema,
  getReportIdsQuerySchema,
  getReportCardIdQuerySchema,
  getReportsParamSchema,
  updateReportAndPrescriptionsSchemas,
  updateReportSchema,
  prescriptionTemplateSchema,
  doctorIdSchema,
  favouritePrescriptionIdSchema,
  prescriptionPdfParamsSchema,
  prescriptionPdfQuerySchema,
  translationIdParamsSchema,
  translationListQuerySchema,
  prescriptionSectionsBodySchema,
  prescriptionSectionsParamsSchema,
  translationSettingsBodySchema,
  translationUpdateBodySchema,
} from '../../schemas/report.schemas';
import { docsRegistry } from '../../../../utils/docsRegistry';
import { requireClinicForLanguage } from '../../middlewares/requireClinicForLanguage.middleware';

const reportRouter = express.Router();

/**
 * @route POST /api/v1/reports/
 * @desc Create a new diagnostic report
 * @access Private (Admin, Clinic)
 */

reportRouter.post(
  '/prescription-template',
  requireAuth,
  requireClinic,
  requireDoctor,
  requireFeature(FEATURE_KEYS.CUSTOM_BRANDED_RX),
  validate(prescriptionTemplateSchema, 'body'),
  upsertPrescriptionTemplateController
);

reportRouter.get(
  '/prescription-template',
  requireAuth,
  requireDoctor,
  getPrescriptionTemplateController
);

// Static catalogue of the toggleable sections — the settings screen builds its
// UI from this rather than hardcoding a parallel list.
reportRouter.get(
  '/prescription-template/sections',
  requireAuth,
  requireDoctor,
  getPrescriptionTemplateSectionsController
);

// A doctor's own switches, or — for a clinic admin — a doctor's in their clinic (checked in the service).
reportRouter.get(
  '/prescription-template/sections/:doctorId',
  requireAuth,
  requireRole(['Doctor', 'Admin']),
  requireClinic,
  validate(prescriptionSectionsParamsSchema, 'params'),
  getPrescriptionSectionsConfigController
);

// Saves only the switches, so the workspace Preview can change what prints without the design.
reportRouter.put(
  '/prescription-template/sections/:doctorId',
  requireAuth,
  requireRole(['Doctor', 'Admin']),
  requireClinic,
  validate(prescriptionSectionsParamsSchema, 'params'),
  validate(prescriptionSectionsBodySchema, 'body'),
  savePrescriptionSectionsController
);

reportRouter.post(
  '/preview-prescription-template',
  requireAuth,
  requireClinic,
  requireDoctor,
  requireFeature(FEATURE_KEYS.CUSTOM_BRANDED_RX),
  requireClinicForLanguage,
  getPreviewPrescriptionTemplateController
);

// Registered above '/:reportId', which would otherwise swallow GET /translations.
reportRouter.get(
  '/translations',
  requireAuth,
  requireDoctor,
  requireClinic,
  validate(translationListQuerySchema, 'query'),
  getTranslationsController
);

// Any staff role that can open a prescription preview needs the list.
reportRouter.get(
  '/translations/languages',
  requireAuth,
  requireAdmin,
  getTranslationLanguagesController
);

// Per doctor, not per clinic, so a doctor in several clinics sets it once.
reportRouter.get(
  '/translations/settings',
  requireAuth,
  requireDoctor,
  getTranslationSettingsController
);

// Registered above '/translations/:id', which would otherwise take 'settings' as an id.
reportRouter.put(
  '/translations/settings',
  requireAuth,
  requireDoctor,
  validate(translationSettingsBodySchema, 'body'),
  updateTranslationSettingsController
);

reportRouter.put(
  '/translations/:id',
  requireAuth,
  requireDoctor,
  requireClinic,
  validate(translationIdParamsSchema, 'params'),
  validate(translationUpdateBodySchema, 'body'),
  updateTranslationController
);

reportRouter.post(
  '/',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(createReportSchema, 'body'),
  createReportController
);

/**
 * @route PUT /api/v1/reports/:reportId
 * @desc Update an existing diagnostic report
 * @access Private (Admin, Clinic)
 */
reportRouter.put(
  '/:reportId',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(getReportsParamSchema, 'params'),
  validate(updateReportSchema, 'body'),
  updateReportController
);

/**
 * @route GET /api/v1/reports/all/:petientId
 * @desc Get all reports for a specific patient in the clinic
 * @access Private (Admin, Clinic)
 */
reportRouter.get(
  '/all/:petientId',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(getAllReportsParamSchema, 'params'),
  validate(getAllReportsQuerySchema, 'query'),
  getAllClinicReportController
);

/**
 * @route GET /api/v1/reports/:reportId
 * @desc Get details of a specific report by ID
 * @access Private (Admin, Clinic)
 */
reportRouter.get(
  '/:reportId',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(getReportsParamSchema, 'params'),
  getReportController
);

/**
 * @route POST /api/v1/reports/card
 * @desc Create a patient report card (multiple reports and prescriptions)
 * @access Private (Admin, Clinic)
 */
reportRouter.post(
  '/card',
  requireAuth,
  requireClinic,
  validate(createReportAndPrescriptionsSchemas, 'body'),
  createPatientReportCardController
);

reportRouter.get(
  '/template-info/current',
  requireAuth,
  requireClinic,
  getCurrentTemplateController
);

reportRouter.get(
  '/favourite-prescription/:doctorId',
  requireAuth,
  requireClinic,
  validate(doctorIdSchema, 'params'),
  getFavouritePrescriptionController
);

reportRouter.delete(
  '/delete-favourite-prescription/:id',
  requireAuth,
  requireClinic,
  validate(favouritePrescriptionIdSchema, 'params'),
  deleteFavouritePrescriptionController
);

/**
 * @route PUT /api/v1/reports/card/update
 * @desc Update an existing patient report card
 * @access Private (Admin, Clinic)
 */
reportRouter.put(
  '/card/update',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(updateReportAndPrescriptionsSchemas, 'body'),
  validate(getReportCardIdQuerySchema, 'query'),
  updatePatientReportCardController
);

/**
 * @route GET /api/v1/reports/card/all/:patientId
 * @desc Get all report cards and prescriptions for a specific patient
 * @access Private (Admin, Clinic)
 */
reportRouter.get(
  '/card/all/:patientId',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(getPatientIdParamsSchema, 'params'),
  validate(getPatientIdQuerySchema, 'query'),
  getAppoinmentsPrescriptionsReportController
);

reportRouter.get(
  '/card/appointments-reports',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(getReportIdsQuerySchema, 'query'),
  getReportCardController
);

/**
 * @route GET /api/v1/reports/card/:reportId/pdf?lang=hi
 * @desc A saved prescription as a PDF in English or a regional language, rendered on demand
 * @access Private (same staff roles as the prescription card; own clinic only)
 */
reportRouter.get(
  '/card/:reportId/pdf',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(prescriptionPdfParamsSchema, 'params'),
  validate(prescriptionPdfQuerySchema, 'query'),
  getPrescriptionPdfController
);

export default reportRouter;

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/reports', // full path as it would appear in the app
  description: 'Create a reports for a patient',
  requestSchema: createReportSchema,
  tags: ['reports', 'Petient'],
});
docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/reports', // full path as it would appear in the app
  description: 'update a Reports for a patient',
  requestSchema: updateReportSchema,
  params: getReportsParamSchema,
  tags: ['reports', 'Petient'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports/:petientId', // full path as it would appear in the app
  description: 'get all the a Reports for a patient',
  query: getAllReportsQuerySchema,
  params: getAllReportsParamSchema,
  tags: ['reports', 'Petient'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports/:reportId', // full path as it would appear in the app
  description: 'get a Reports for a patient',
  params: getReportsParamSchema,
  tags: ['reports', 'Petient'],
});
docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/reports/card', // full path as it would appear in the app
  description: 'create a report card for a patient',
  requestSchema: createReportAndPrescriptionsSchemas,
  tags: ['reports', 'Petient'],
});
docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/reports/card/update', // full path as it would appear in the app
  description: 'update a report card for a patient',
  requestSchema: updateReportAndPrescriptionsSchemas,
  query: getReportCardIdQuerySchema,
  tags: ['reports', 'Petient'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports/card/all/:patientId', // full path as it would appear in the app
  description: 'get a report card for a patient',
  params: getPatientIdParamsSchema,
  query: getPatientIdQuerySchema,
  tags: ['reports', 'Patient'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports/card/appointments-reports', // full path as it would appear in the app
  description: 'get a report card for a patient',
  query: getReportIdsQuerySchema,
  tags: ['reports', 'Patient'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports/card/:reportId/pdf',
  description:
    'Render a saved prescription as a PDF in English or a regional language',
  params: prescriptionPdfParamsSchema,
  query: prescriptionPdfQuerySchema,
  tags: ['reports', 'Patient'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports/translations',
  description:
    "List the signed-in doctor's prescription phrases for a language, pending first",
  query: translationListQuerySchema,
  tags: ['reports', 'Translations'],
});
docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/reports/translations/:id',
  description: "Save the doctor's own translation for one of their phrases",
  params: translationIdParamsSchema,
  requestSchema: translationUpdateBodySchema,
  tags: ['reports', 'Translations'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports/translations/settings',
  description: "The signed-in doctor's prescription language and print style",
  tags: ['reports', 'Translations'],
});
docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/reports/translations/settings',
  description: "Save the doctor's prescription language and print style",
  requestSchema: translationSettingsBodySchema,
  tags: ['reports', 'Translations'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports/translations/languages',
  description:
    'Languages a prescription can print in right now (a dictionary exists, or a translation provider is on)',
  tags: ['reports', 'Translations'],
});
