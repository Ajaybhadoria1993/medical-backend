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
  addWalkinLabOrderController,
  bulkUploadLabOrderReportController,
  generateLabOrderReportPdfController,
  getLabOrderReportController,
  getLabOrderParametersController,
  getLabOrderCountsController,
  getLabOrderByIdController,
  getLabOrdersController,
  searchLabOrdersBySampleCodeController,
  saveLabUpdatedResultsController,
  updateLabOrdersController,
} from '../../controllers/labOrder.controller';
import {
  addWalkinLabOrderSchema,
  bulkUploadLabOrderReportSchema,
  getLabOrderParametersSchema,
  getLabOrderReportSchema,
  getLabOrdersQuerySchema,
  labOrderIdParamSchema,
  sampleCodeParamSchema,
  saveLabUpdatedResultsSchema,
  updateLabOrdersSchema,
} from '../../schemas/labOrder.schemas';
import { uploadPatientTest } from '../../../../middlewear/upload.middleware';

const labOrderRouter = Router();

labOrderRouter.use(
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant', 'Receptionist']),
  requireLab,
  requireLabClinicContext,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION)
);

labOrderRouter.get(
  '/',
  validate(getLabOrdersQuerySchema, 'query'),
  getLabOrdersController
);

labOrderRouter.get('/count', getLabOrderCountsController);

labOrderRouter.post(
  '/add-walkin-test',
  validate(addWalkinLabOrderSchema, 'body'),
  addWalkinLabOrderController
);

labOrderRouter.post(
  '/test-result-parameters',
  validate(getLabOrderParametersSchema, 'body'),
  getLabOrderParametersController
);

labOrderRouter.post(
  '/results',
  validate(saveLabUpdatedResultsSchema, 'body'),
  saveLabUpdatedResultsController
);

labOrderRouter.post(
  '/report',
  validate(getLabOrderReportSchema, 'body'),
  getLabOrderReportController
);

labOrderRouter.patch(
  '/bulk',
  validate(updateLabOrdersSchema, 'body'),
  updateLabOrdersController
);

labOrderRouter.patch(
  '/bulk/report-upload',
  uploadPatientTest.single('reportPdf'),
  validate(bulkUploadLabOrderReportSchema, 'body'),
  bulkUploadLabOrderReportController
);

labOrderRouter.post(
  '/bulk/report-generate',
  validate(bulkUploadLabOrderReportSchema, 'body'),
  generateLabOrderReportPdfController
);

labOrderRouter.get(
  '/search-sample-code/:sampleCode',
  validate(sampleCodeParamSchema, 'params'),
  validate(
    getLabOrdersQuerySchema.omit({ labOrderId: true, sampleCode: true }),
    'query'
  ),
  searchLabOrdersBySampleCodeController
);

labOrderRouter.get(
  '/:labOrderId',
  validate(labOrderIdParamSchema, 'params'),
  validate(getLabOrdersQuerySchema.omit({ labOrderId: true }), 'query'),
  getLabOrderByIdController
);

export const apiDocs = [
  {
    method: 'get',
    path: '/',
    description: 'Get lab orders as a flat list or grouped by patient',
    query: getLabOrdersQuerySchema,
    tags: ['lab-order'],
  },
  {
    method: 'get',
    path: '/count',
    description:
      'Count individual lab orders by initiated, processing, and fully completed status',
    tags: ['lab-order'],
  },
  {
    method: 'post',
    path: '/add-walkin-test',
    description: 'Create walk-in lab orders using lab-updated tests/packages',
    requestSchema: addWalkinLabOrderSchema,
    tags: ['lab-order'],
  },
  {
    method: 'post',
    path: '/test-result-parameters',
    description: 'Fetch active result parameters for lab orders',
    requestSchema: getLabOrderParametersSchema,
    tags: ['lab-order'],
  },
  {
    method: 'post',
    path: '/results',
    description: 'Save or update result values for lab orders',
    requestSchema: saveLabUpdatedResultsSchema,
    tags: ['lab-order'],
  },
  {
    method: 'post',
    path: '/report',
    description: 'Generate HTML lab reports from saved lab result values',
    requestSchema: getLabOrderReportSchema,
    tags: ['lab-order'],
  },
  {
    method: 'patch',
    path: '/bulk',
    description:
      'Update one or more lab orders with shared or per-order field updates',
    requestSchema: updateLabOrdersSchema,
    tags: ['lab-order'],
  },
  {
    method: 'patch',
    path: '/bulk/report-upload',
    description:
      'Upload one report PDF and apply it to multiple lab orders in this lab',
    requestSchema: bulkUploadLabOrderReportSchema,
    tags: ['lab-order'],
  },
  {
    method: 'post',
    path: '/bulk/report-generate',
    description:
      'Generate lab report PDFs from saved result values, upload them to S3, and update the orders',
    requestSchema: bulkUploadLabOrderReportSchema,
    tags: ['lab-order'],
  },
  {
    method: 'get',
    path: '/search-sample-code/:sampleCode',
    description:
      'Search lab orders by sample code, then patient name, then patient mobile using the lab-order response shape',
    params: sampleCodeParamSchema,
    query: getLabOrdersQuerySchema.omit({
      labOrderId: true,
      sampleCode: true,
    }),
    tags: ['lab-order'],
  },
  {
    method: 'get',
    path: '/:labOrderId',
    description: 'Get a single lab order using the lab-order response shape',
    params: labOrderIdParamSchema,
    query: getLabOrdersQuerySchema.omit({ labOrderId: true }),
    tags: ['lab-order'],
  },
];

export default labOrderRouter;
