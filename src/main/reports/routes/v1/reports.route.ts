import express from 'express';
import {
  CLINIC_STAFF_ROLES,
  requireAuth,
  requireClinic,
  requireDoctor,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import {
  createPatientReportCardController,
  createReportController,
  deleteFavouritePrescriptionController,
  getAllClinicReportController,
  getAppoinmentsPrescriptionsReportController,
  getCurrentTemplateController,
  getFavouritePrescriptionController,
  getLastVisitNotesController,
  getPrescriptionPdfController,
  getPrescriptionSectionsConfigController,
  getPrescriptionTemplateController,
  getPrescriptionTemplateSectionsController,
  getPreviewPrescriptionTemplateController,
  getReportCardController,
  getReportController,
  getTranslationLanguagesController,
  getTranslationSettingsController,
  savePrescriptionSectionsController,
  updatePatientReportCardController,
  updateReportController,
  updateTranslationSettingsController,
  upsertPrescriptionTemplateController,
} from '../../controllers/report.controller';
import { requireClinicForLanguage } from '../../middlewares/requireClinicForLanguage.middleware';
import {
  createReportAndPrescriptionsSchemas,
  createReportSchema,
  doctorIdSchema,
  favouritePrescriptionIdSchema,
  getAllReportsParamSchema,
  lastVisitNotesParamsSchema,
  getAllReportsQuerySchema,
  getPatientIdParamsSchema,
  getPatientIdQuerySchema,
  getReportCardIdQuerySchema,
  getReportIdsQuerySchema,
  getReportsParamSchema,
  prescriptionPdfParamsSchema,
  prescriptionPdfQuerySchema,
  prescriptionSectionsBodySchema,
  prescriptionSectionsParamsSchema,
  prescriptionTemplateSchema,
  translationSettingsBodySchema,
  updateReportAndPrescriptionsSchemas,
  updateReportSchema,
} from '../../schemas/report.schemas';

const reportRouter = express.Router();

/** @route POST /api/v1/reports/prescription-template — save the doctor's prescription template
 *  @access Doctor */
reportRouter.post(
  '/prescription-template',
  requireAuth,
  requireClinic,
  requireDoctor,
  validate(prescriptionTemplateSchema, 'body'),
  upsertPrescriptionTemplateController
);

/** @route GET /api/v1/reports/prescription-template — the doctor's prescription template
 *  @access Doctor */
reportRouter.get(
  '/prescription-template',
  requireAuth,
  requireDoctor,
  getPrescriptionTemplateController
);

/** @route GET /api/v1/reports/prescription-template/sections — catalogue of toggleable sections
 *  @access Doctor */
reportRouter.get(
  '/prescription-template/sections',
  requireAuth,
  requireDoctor,
  getPrescriptionTemplateSectionsController
);

/** @route GET /api/v1/reports/prescription-template/sections/:doctorId — a doctor's section switches
 *  @access Doctor (self); Admin (doctors in their clinic, checked in the service) */
reportRouter.get(
  '/prescription-template/sections/:doctorId',
  requireAuth,
  requireRole(['Doctor', 'Admin']),
  requireClinic,
  validate(prescriptionSectionsParamsSchema, 'params'),
  getPrescriptionSectionsConfigController
);

/** @route PUT /api/v1/reports/prescription-template/sections/:doctorId — save only the section switches
 *  @access Doctor (self); Admin (doctors in their clinic, checked in the service) */
reportRouter.put(
  '/prescription-template/sections/:doctorId',
  requireAuth,
  requireRole(['Doctor', 'Admin']),
  requireClinic,
  validate(prescriptionSectionsParamsSchema, 'params'),
  validate(prescriptionSectionsBodySchema, 'body'),
  savePrescriptionSectionsController
);

/** @route POST /api/v1/reports/preview-prescription-template — render a template preview
 *  @access Doctor */
reportRouter.post(
  '/preview-prescription-template',
  requireAuth,
  requireClinic,
  requireDoctor,
  requireClinicForLanguage,
  getPreviewPrescriptionTemplateController
);

/** @route GET /api/v1/reports/translations/languages — languages a prescription can print in
 *  @access Any signed-in user */
reportRouter.get(
  '/translations/languages',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  getTranslationLanguagesController
);

/** @route GET /api/v1/reports/translations/settings — the doctor's print language (per doctor, not clinic)
 *  @access Doctor */
reportRouter.get(
  '/translations/settings',
  requireAuth,
  requireDoctor,
  getTranslationSettingsController
);

/** @route PUT /api/v1/reports/translations/settings — save the doctor's print language
 *  @access Doctor */
reportRouter.put(
  '/translations/settings',
  requireAuth,
  requireDoctor,
  validate(translationSettingsBodySchema, 'body'),
  updateTranslationSettingsController
);

/** @route POST /api/v1/reports — create a diagnostic report
 *  @access Any signed-in user with a clinic */
reportRouter.post(
  '/',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(createReportSchema, 'body'),
  createReportController
);

/** @route PUT /api/v1/reports/:reportId — update a diagnostic report
 *  @access Any signed-in user with a clinic */
reportRouter.put(
  '/:reportId',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(getReportsParamSchema, 'params'),
  validate(updateReportSchema, 'body'),
  updateReportController
);

/** @route GET /api/v1/reports/all/:petientId — a patient's diagnostic reports in this clinic
 *  @access Any signed-in user with a clinic */
reportRouter.get(
  '/all/:petientId',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(getAllReportsParamSchema, 'params'),
  validate(getAllReportsQuerySchema, 'query'),
  getAllClinicReportController
);

/** @route GET /api/v1/reports/:reportId — one diagnostic report in this clinic
 *  @access Any signed-in user with a clinic */
reportRouter.get(
  '/:reportId',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(getReportsParamSchema, 'params'),
  getReportController
);

/** @route POST /api/v1/reports/card — write the appointment's prescription
 *  @access Doctor, Admin (service: the appointment's own doctor, same day only) */
reportRouter.post(
  '/card',
  requireAuth,
  requireRole(['Doctor', 'Admin']),
  requireClinic,
  validate(createReportAndPrescriptionsSchemas, 'body'),
  createPatientReportCardController
);

/** @route GET /api/v1/reports/template-info/current — the signed-in doctor's active template
 *  @access Clinic members */
reportRouter.get(
  '/template-info/current',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  getCurrentTemplateController
);

/** @route GET /api/v1/reports/favourite-prescription/:doctorId — a doctor's saved favourites
 *  @access Clinic members */
reportRouter.get(
  '/favourite-prescription/:doctorId',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(doctorIdSchema, 'params'),
  getFavouritePrescriptionController
);

/** @route DELETE /api/v1/reports/delete-favourite-prescription/:id — delete one of your favourites
 *  @access Clinic members (service: own favourites only) */
reportRouter.delete(
  '/delete-favourite-prescription/:id',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(favouritePrescriptionIdSchema, 'params'),
  deleteFavouritePrescriptionController
);

/** @route PUT /api/v1/reports/card/update — edit the appointment's prescription
 *  @access Doctor, Admin (service: the appointment's own doctor, same day only) */
reportRouter.put(
  '/card/update',
  requireAuth,
  requireRole(['Doctor', 'Admin']),
  requireClinic,
  validate(updateReportAndPrescriptionsSchemas, 'body'),
  validate(getReportCardIdQuerySchema, 'query'),
  updatePatientReportCardController
);

/** @route GET /api/v1/reports/card/all/:patientId — a patient's visits, prescriptions or history here
 *  @access Admin, Doctor, Receptionist, Nurse (prescriptions/history: Admin, own-visit Doctor) */
reportRouter.get(
  '/card/all/:patientId',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist', 'Nurse']),
  requireClinic,
  validate(getPatientIdParamsSchema, 'params'),
  validate(getPatientIdQuerySchema, 'query'),
  getAppoinmentsPrescriptionsReportController
);

/** @route GET /api/v1/reports/card/appointments-reports — prescriptions for given appointments
 *  @access Any signed-in user with a clinic */
reportRouter.get(
  '/card/appointments-reports',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(getReportIdsQuerySchema, 'query'),
  getReportCardController
);

/** @route GET /api/v1/reports/card/last-visit/:appointmentId — the same doctor's previous exam values + history
 *  @access Admin, own-visit Doctor */
reportRouter.get(
  '/card/last-visit/:appointmentId',
  requireAuth,
  requireRole(['Admin', 'Doctor']),
  requireClinic,
  validate(lastVisitNotesParamsSchema, 'params'),
  getLastVisitNotesController
);

/** @route GET /api/v1/reports/card/:reportId/pdf?lang=hi — a saved prescription as PDF, rendered on demand
 *  @access Any signed-in user with a clinic (own clinic only) */
reportRouter.get(
  '/card/:reportId/pdf',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(prescriptionPdfParamsSchema, 'params'),
  validate(prescriptionPdfQuerySchema, 'query'),
  getPrescriptionPdfController
);

export default reportRouter;

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/reports',
  description: 'Create a reports for a patient',
  requestSchema: createReportSchema,
  tags: ['reports', 'Petient'],
});
docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/reports',
  description: 'update a Reports for a patient',
  requestSchema: updateReportSchema,
  params: getReportsParamSchema,
  tags: ['reports', 'Petient'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports/:petientId',
  description: 'get all the a Reports for a patient',
  query: getAllReportsQuerySchema,
  params: getAllReportsParamSchema,
  tags: ['reports', 'Petient'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports/:reportId',
  description: 'get a Reports for a patient',
  params: getReportsParamSchema,
  tags: ['reports', 'Petient'],
});
docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/reports/card',
  description: 'create a report card for a patient',
  requestSchema: createReportAndPrescriptionsSchemas,
  tags: ['reports', 'Petient'],
});
docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/reports/card/update',
  description: 'update a report card for a patient',
  requestSchema: updateReportAndPrescriptionsSchemas,
  query: getReportCardIdQuerySchema,
  tags: ['reports', 'Petient'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports/card/all/:patientId',
  description: 'get a report card for a patient',
  params: getPatientIdParamsSchema,
  query: getPatientIdQuerySchema,
  tags: ['reports', 'Patient'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports/card/appointments-reports',
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
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports/card/last-visit/:appointmentId',
  description:
    "The same doctor's previous prescription for this patient: typed exam values and history",
  params: lastVisitNotesParamsSchema,
  tags: ['reports', 'Patient'],
});
