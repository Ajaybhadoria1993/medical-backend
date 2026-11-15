import { RequestHandler, Router } from 'express';
import {
  requireAdmin,
  requireAuth,
  requireClinic,
  requireLab,
  requireLabAssistant,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import {
  requireFeature,
  FEATURE_KEYS,
} from '../../../../middlewear/limitation.middleware';
import { requirePermission } from '../../../../middlewear/permission.middleware';
import { PERMISSION_KEYS } from '../../../permissions/utils/permission.constants';

import { validate } from '../../../../middlewear/validation.middleware';
import {
  addLabCustomFieldController,
  addMyLabTestController,
  createDepartmentController,
  createLabController,
  deactivateLabCatalogTestController,
  deleteLabCustomFieldController,
  getDepartmentsController,
  getDetailsBylabAssistent,
  getActiveReportTemplatesController,
  getLabCatalogForAdminController,
  getManageableTemplateParametersController,
  hideLabDefaultFieldController,
  getLabByIdController,
  getLabsByClinicIdController,
  getLabResultReportController,
  getResultTemplateController,
  getSavedLabResultController,
  getTestsByLabAssistantIdController,
  getUsersByLabIdController,
  overrideLabDefaultFieldController,
  resetLabDefaultFieldOverrideController,
  saveLabResultController,
  unhideLabDefaultFieldController,
  updateLabController,
  updateLabCatalogTestController,
  updateLabCustomFieldController,
  updateLabResultController,
  uploadLabResultReportController,
  verifyLabResultController,
  getLabCatalogTestCustomFieldsController,
  getMyLabCatalogController,
  getLabDepartmentsByLabIdController,
  updateDepartmentController,
  updateLabDepartmentsController,
  syncLabCatalogController,
} from '../../controllers/lab.controller';
import {
  createLabTestPackageController,
  getLabTestPackageByIdController,
  getLabTestPackagesController,
  updateLabTestPackageController,
} from '../../controllers/labTestPackage.controller';
import {
  addLabCustomFieldSchema,
  createLabDepartmentSchema,
  createLabSchema,
  createMyLabTestSchema,
  createLabTestPackageSchema,
  getLabDepartmentsQuerySchema,
  getLabTestPackagesQuerySchema,
  hideLabDefaultFieldSchema,
  labDepartmentIdParamSchema,
  labCustomFieldIdParamSchema,
  labIdParamSchema,
  labIdRouteParamSchema,
  labOrderIdParamSchema,
  labResultIdParamSchema,
  labTestIdParamSchema,
  labTemplateIdParamSchema,
  labTemplateParameterIdParamSchema,
  overrideLabDefaultFieldSchema,
  resetLabDefaultFieldOverrideSchema,
  saveLabResultSchema,
  unhideLabDefaultFieldSchema,
  updateLabDepartmentSchema,
  updateLabCatalogTestSchema,
  updateLabCustomFieldSchema,
  updateLabResultSchema,
  updateLabSchema,
  updateLabDepartmentsSchema,
  updateLabTestPackageSchema,
  getMyLabCatalogQuerySchema,
  labTestPackageIdParamSchema,
  labReportTemplateSchema,
} from '../../schemas/lab.schemas';
import {
  upsertLabReportTemplateController,
  getLabReportTemplateController,
  listLabReportTemplatesController,
} from '../../controllers/labReportTemplate.controller';
import {
  approveAppointmentTestController,
  createIndependentLabTestController,
  getAppointmentTestBarcodeController,
  getBarcodeLookupController,
  getBarcodePrintDataController,
  getLabInvoiceByAppointmentTestController,
  getLabInvoiceByIdController,
  getLabAppointmentTestsController,
  getSampleTrackingDetailByBarcodeController,
  getSampleTrackingDetailController,
  markAppointmentTestOnHoldController,
  markAppointmentTestPaymentPaidController,
  rejectAppointmentTestController,
  setExpectedReportReadyAtController,
  updateSampleStatusByBarcodeController,
  updateAppointmentTestSampleStatusController,
} from '../../../test/controllers/appointmentTest.controller';

import {
  addIndependentTestsSchema,
  appointmentTestIdParamSchema,
  barcodeSampleActionSchema,
  labAppointmentTestsQuerySchema,
  labInvoiceIdParamSchema,
  labSampleBarcodeValueParamSchema,
  markPaymentPaidSchema,
  onHoldAppointmentTestSchema,
  rejectAppointmentTestSchema,
  setExpectedReportReadyAtSchema,
  updateSampleStatusSchema,
} from '../../../test/schemas/appointmentTest.schema';
import { uploadPatientTest } from '../../../../middlewear/upload.middleware';
import labDashboardRouter from './labDashboard.route';
const labRouter = Router();

const requireLabForLabAssistant: RequestHandler = (req, res, next) => {
  if (
    req.user?.userType === 'Lab_Assistant' ||
    req.user?.userType === 'Receptionist'
  ) {
    return requireLab(req, res, next);
  }

  return next();
};

const skipNonUuidLabIdRoute: RequestHandler = (req, res, next) => {
  if (!labIdRouteParamSchema.safeParse(req.params).success) {
    return next('route');
  }

  return next();
};

const skipNonUuidLabIdParamRoute: RequestHandler = (req, res, next) => {
  if (!labIdParamSchema.safeParse(req.params).success) {
    return next('route');
  }

  return next();
};

/**
 * @route POST /api/v1/lab/
 * @desc Create a new lab for the clinic
 * @access Private (Admin, Clinic, Lab Subscription)
 */
labRouter.post(
  '/',
  requireAuth,
  requireClinic,
  requireAdmin,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  validate(createLabSchema, 'body'),
  createLabController
);

labRouter.get(
  '/departments',
  requireAuth,
  requireClinic,
  requireRole(['Admin', 'Lab_Assistant', 'Super_Admin']),
  requireLab,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  validate(getLabDepartmentsQuerySchema, 'query'),
  getDepartmentsController
);

labRouter.post(
  '/departments',
  validate(createLabDepartmentSchema, 'body'),
  requireAuth,
  requireClinic,
  requireLabAssistant,
  requireLab,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  createDepartmentController
);

labRouter.patch(
  '/departments/:departmentId',
  validate(labDepartmentIdParamSchema, 'params'),
  validate(updateLabDepartmentSchema, 'body'),
  requireAuth,
  requireClinic,
  requireLabAssistant,
  requireLab,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  updateDepartmentController
);

labRouter.get(
  '/my-tests',
  requireAuth,
  requireClinic,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant', 'Receptionist']),
  requireLab,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  validate(getMyLabCatalogQuerySchema, 'query'),
  getMyLabCatalogController
);

labRouter.post(
  '/my-tests',
  validate(createMyLabTestSchema, 'body'),
  requireAuth,
  requireClinic,
  requireLabAssistant,
  requireLab,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  addMyLabTestController
);

labRouter.patch(
  '/tests/:testId',
  validate(labTestIdParamSchema, 'params'),
  validate(updateLabCatalogTestSchema, 'body'),
  requireAuth,
  requireClinic,
  requireRole(['Admin', 'Lab_Assistant']),
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  updateLabCatalogTestController
);

labRouter.get(
  '/tests/:testId/custom-fields',
  validate(labTestIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireRole(['Admin', 'Lab_Assistant']),
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  getLabCatalogTestCustomFieldsController
);

labRouter.delete(
  '/tests/:testId',
  validate(labTestIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireRole(['Admin', 'Lab_Assistant']),
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  deactivateLabCatalogTestController
);

labRouter.post(
  '/packages',
  validate(createLabTestPackageSchema, 'body'),
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant']),
  requireLab,
  createLabTestPackageController
);

labRouter.get(
  '/packages',
  validate(getLabTestPackagesQuerySchema, 'query'),
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant']),
  requireLab,
  getLabTestPackagesController
);

labRouter.get(
  '/packages/:packageId',
  validate(labTestPackageIdParamSchema, 'params'),
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant']),
  requireLab,
  getLabTestPackageByIdController
);

labRouter.put(
  '/packages/:packageId',
  validate(labTestPackageIdParamSchema, 'params'),
  validate(updateLabTestPackageSchema, 'body'),
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant']),
  requireLab,
  updateLabTestPackageController
);

labRouter.get(
  '/:labId/tests',
  skipNonUuidLabIdParamRoute,
  validate(labIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireRole(['Admin', 'Super_Admin']),
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  getLabCatalogForAdminController
);

labRouter.get(
  '/:labId/departments',
  skipNonUuidLabIdParamRoute,
  validate(labIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant']),
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  getLabDepartmentsByLabIdController
);

labRouter.patch(
  '/:labId/departments',
  skipNonUuidLabIdParamRoute,
  validate(labIdParamSchema, 'params'),
  validate(updateLabDepartmentsSchema, 'body'),
  requireAuth,
  requireClinic,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant']),
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  updateLabDepartmentsController
);

labRouter.post(
  '/:labId/catalog/sync',
  skipNonUuidLabIdParamRoute,
  validate(labIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireRole(['Admin', 'Super_Admin']),
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  syncLabCatalogController
);

labRouter.get(
  '/appointment-tests',
  validate(labAppointmentTestsQuerySchema, 'query'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireRole(['Admin', 'Lab_Assistant', 'Receptionist']),
  requirePermission(PERMISSION_KEYS.LAB_TEST_VIEW, ['Receptionist']),
  requireLab,
  getLabAppointmentTestsController
);

labRouter.post(
  '/appointment-tests/independent',
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant', 'Receptionist']),
  requirePermission(PERMISSION_KEYS.LAB_TEST_CREATE, ['Receptionist']),
  requireLab,
  validate(addIndependentTestsSchema, 'body'),
  createIndependentLabTestController
);

labRouter.patch(
  '/appointment-tests/:appointmentTestId/on-hold',
  validate(appointmentTestIdParamSchema, 'params'),
  validate(onHoldAppointmentTestSchema, 'body'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireLabAssistant,
  requireLab,
  markAppointmentTestOnHoldController
);

labRouter.patch(
  '/appointment-tests/:appointmentTestId/approve-test',
  validate(appointmentTestIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireLabAssistant,
  requireLab,
  approveAppointmentTestController
);

labRouter.patch(
  '/appointment-tests/:appointmentTestId/reject',
  validate(appointmentTestIdParamSchema, 'params'),
  validate(rejectAppointmentTestSchema, 'body'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireLabAssistant,
  requireLab,
  rejectAppointmentTestController
);

labRouter.get(
  '/barcodes/:barcodeValue/lookup',
  validate(labSampleBarcodeValueParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireLabAssistant,
  requireLab,
  getBarcodeLookupController
);

labRouter.get(
  '/barcodes/:barcodeValue/print-data',
  validate(labSampleBarcodeValueParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireLabAssistant,
  requireLab,
  getBarcodePrintDataController
);

labRouter.patch(
  '/barcodes/:barcodeValue/actions',
  validate(labSampleBarcodeValueParamSchema, 'params'),
  validate(barcodeSampleActionSchema, 'body'),
  requireAuth,
  requireClinic,
  requireLabAssistant,
  requireLab,
  updateSampleStatusByBarcodeController
);

labRouter.get(
  '/appointment-tests/barcode/:barcodeValue',
  validate(labSampleBarcodeValueParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireLabAssistant,
  requireLab,
  getSampleTrackingDetailByBarcodeController
);

labRouter.get(
  '/appointment-tests/:appointmentTestId/barcode',
  validate(appointmentTestIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireLabAssistant,
  requireLab,
  getAppointmentTestBarcodeController
);

labRouter.get(
  '/appointment-tests/:appointmentTestId/tracking',
  validate(appointmentTestIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireRole(['Admin', 'Lab_Assistant', 'Receptionist']),
  requirePermission(PERMISSION_KEYS.LAB_TEST_VIEW, ['Receptionist']),
  requireLab,
  getSampleTrackingDetailController
);

labRouter.get(
  '/appointment-tests/:appointmentTestId/invoice',
  validate(appointmentTestIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireRole(['Admin', 'Lab_Assistant', 'Receptionist']),
  requirePermission(PERMISSION_KEYS.LAB_TEST_VIEW, ['Receptionist']),
  requireLab,
  getLabInvoiceByAppointmentTestController
);

labRouter.get(
  '/invoices/:invoiceId',
  validate(labInvoiceIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireLabAssistant,
  requireLab,
  getLabInvoiceByIdController
);

labRouter.patch(
  '/appointment-tests/:appointmentTestId/payment/mark-paid',
  validate(appointmentTestIdParamSchema, 'params'),
  validate(markPaymentPaidSchema, 'body'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireRole(['Admin', 'Lab_Assistant', 'Receptionist']),
  requirePermission(PERMISSION_KEYS.LAB_TEST_MARK_PAID, ['Receptionist']),
  requireLab,
  markAppointmentTestPaymentPaidController
);

labRouter.patch(
  '/appointment-tests/:appointmentTestId/expected-report-ready-at',
  validate(appointmentTestIdParamSchema, 'params'),
  validate(setExpectedReportReadyAtSchema, 'body'),
  requireAuth,
  requireClinic,
  requireLabAssistant,
  requireLab,
  setExpectedReportReadyAtController
);

labRouter.patch(
  '/appointment-tests/:appointmentTestId/sample-status',
  validate(appointmentTestIdParamSchema, 'params'),
  validate(updateSampleStatusSchema, 'body'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireLabAssistant,
  requireLab,
  updateAppointmentTestSampleStatusController
);

labRouter.get(
  '/report-templates',
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireLabAssistant,
  requireLab,
  getActiveReportTemplatesController
);

labRouter.get(
  '/report-templates/:templateId/parameters',
  validate(labTemplateIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireRole(['Admin', 'Lab_Assistant']),
  requireLab,
  getManageableTemplateParametersController
);

labRouter.get(
  '/orders/:labOrderId/result-template',
  validate(labOrderIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireRole([
    'Admin',
    'Doctor',
    'Super_Admin',
    'Lab_Assistant',
    'Receptionist',
  ]),
  requirePermission(PERMISSION_KEYS.LAB_TEST_VIEW, ['Receptionist']),
  requireLabForLabAssistant,
  getResultTemplateController
);

labRouter.post(
  '/orders/:labOrderId/results',
  validate(labOrderIdParamSchema, 'params'),
  validate(saveLabResultSchema, 'body'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireLabAssistant,
  requireLab,
  saveLabResultController
);

labRouter.post(
  '/report-templates/:templateId/custom-fields',
  validate(labTemplateIdParamSchema, 'params'),
  validate(addLabCustomFieldSchema, 'body'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireRole(['Admin', 'Lab_Assistant']),
  requireLab,
  addLabCustomFieldController
);

labRouter.put(
  '/custom-fields/:fieldId',
  validate(labCustomFieldIdParamSchema, 'params'),
  validate(updateLabCustomFieldSchema, 'body'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireRole(['Admin', 'Lab_Assistant']),
  requireLab,
  updateLabCustomFieldController
);

labRouter.delete(
  '/custom-fields/:fieldId',
  validate(labCustomFieldIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireRole(['Admin', 'Lab_Assistant']),
  requireLab,
  deleteLabCustomFieldController
);

labRouter.put(
  '/report-template-parameters/:parameterId/override',
  validate(labTemplateParameterIdParamSchema, 'params'),
  validate(overrideLabDefaultFieldSchema, 'body'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireRole(['Admin', 'Lab_Assistant']),
  requireLab,
  overrideLabDefaultFieldController
);

labRouter.patch(
  '/report-template-parameters/:parameterId/hide',
  validate(labTemplateParameterIdParamSchema, 'params'),
  validate(hideLabDefaultFieldSchema, 'body'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireRole(['Admin', 'Lab_Assistant']),
  requireLab,
  hideLabDefaultFieldController
);

labRouter.patch(
  '/report-template-parameters/:parameterId/unhide',
  validate(labTemplateParameterIdParamSchema, 'params'),
  validate(unhideLabDefaultFieldSchema, 'body'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireRole(['Admin', 'Lab_Assistant']),
  requireLab,
  unhideLabDefaultFieldController
);

labRouter.delete(
  '/report-template-parameters/:parameterId/override',
  validate(labTemplateParameterIdParamSchema, 'params'),
  validate(resetLabDefaultFieldOverrideSchema, 'body'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireRole(['Admin', 'Lab_Assistant']),
  requireLab,
  resetLabDefaultFieldOverrideController
);

labRouter.get(
  '/results/:resultId/report',
  validate(labResultIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireRole(['Admin', 'Doctor', 'Lab_Assistant', 'Receptionist']),
  requireLabForLabAssistant,
  getLabResultReportController
);

labRouter.post(
  '/results/:resultId/report-upload',
  validate(labResultIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireLabAssistant,
  requireLab,
  uploadPatientTest.single('reportPdf'),
  uploadLabResultReportController
);

labRouter.get(
  '/results/:resultId',
  validate(labResultIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireRole(['Admin', 'Doctor', 'Lab_Assistant', 'Receptionist']),
  requireLabForLabAssistant,
  getSavedLabResultController
);

labRouter.put(
  '/results/:resultId',
  validate(labResultIdParamSchema, 'params'),
  validate(updateLabResultSchema, 'body'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireLabAssistant,
  requireLab,
  updateLabResultController
);

labRouter.patch(
  '/results/:resultId/verify',
  validate(labResultIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireRole(['Admin', 'Doctor', 'Lab_Assistant', 'Receptionist']),
  requireLabForLabAssistant,
  verifyLabResultController
);

labRouter.post(
  '/lab-report-template',
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireLab,
  validate(labReportTemplateSchema, 'body'),
  upsertLabReportTemplateController
);

labRouter.get(
  '/lab-report-template',
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireLab,
  getLabReportTemplateController
);

labRouter.get(
  '/lab-report-templates/list',
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  requireLab,
  listLabReportTemplatesController
);

/**
 * @route PUT /api/v1/lab/:id
 * @desc Update lab information
 * @access Private (Clinic, Lab Subscription)
 */
labRouter.put(
  '/:id',
  validate(labIdRouteParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  validate(updateLabSchema, 'body'),
  updateLabController
);

/**
 * @route GET /api/v1/lab/:id
 * @desc Get detailed information about a specific lab by ID
 * @access Private (Admin, Clinic, Lab Subscription)
 */
labRouter.get(
  '/:id',
  skipNonUuidLabIdRoute,
  requireAuth,
  requireClinic,
  requireAdmin,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  getLabByIdController
);

/**
 * @route GET /api/v1/lab/clinic/:clinicId
 * @desc Get all labs associated with a specific clinic ID
 * @access Private (Admin, Clinic, Lab Subscription)
 */
labRouter.get(
  '/clinic/:clinicId',
  requireAuth,
  requireClinic,
  requireAdmin,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  getLabsByClinicIdController
);

/**
 * @route GET /api/v1/lab/assistant/:labId
 * @desc Get tests associated with a lab assistant for a specific lab
 * @access Private (Admin, Lab Assistant, Lab Subscription)
 */
labRouter.get(
  '/assistant/:labId',
  requireAuth,
  requireClinic,
  requireRole(['Admin', 'Lab_Assistant']),
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  getTestsByLabAssistantIdController
);

/**
 * @route GET /api/v1/lab/:labId/users
 * @desc Get all users (staff) associated with a specific lab
 * @access Private (Admin, Lab Assistant, Lab Subscription)
 */
labRouter.get(
  '/:labId/users',
  skipNonUuidLabIdParamRoute,
  requireAuth,
  requireClinic,
  requireRole(['Admin', 'Lab_Assistant']),
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  getUsersByLabIdController
);

/**
 * @route GET /api/v1/lab/dashboard
 * @desc Get dashboard cards for the current lab
 * @access Private (Admin, Super Admin, Lab Assistant, Receptionist)
 */
labRouter.use('/dashboard', labDashboardRouter);

/**
 * @route GET /api/v1/lab/dashboard/:labAssistent
 * @desc Get dashboard data for a specific lab assistant
 * @access Private (Clinic, Lab Subscription)
 */
labRouter.get(
  '/dashboard/:labAssistent',
  requireAuth,
  requireClinic,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  getDetailsBylabAssistent
);

// //get all test assigned by the help of lb assistent id
// labRouter.get('/test/:labAssistent', requireAuth, requireRole(['Admin', 'Lab_Assistant', 'Doctor']), getTestsByLabAssistantController);
export default labRouter;
