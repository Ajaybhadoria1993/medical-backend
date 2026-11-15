import express from 'express';
import { validate } from '../../../../middlewear/validation.middleware';
import { requireAuth } from '../../../../middlewear/auth.middleware';
import {
  addSupplierController,
  downloadSupplierSampleTemplateController,
  exportAllSuppliersController,
  getSupplierByIdController,
  getSuppliersController,
  getSupplierStatsController,
  importSuppliersController,
  updateSupplierController,
} from '../../controllers/supplier.controller';
import {
  createSupplierSchema,
  getSupplierByIdParamsSchema,
  getSuppliersQuerySchema,
  updateSupplierParamsSchema,
  updateSupplierSchema,
} from '../../schemas/supplier.schema';
import { uploadSupplierImport } from '../../../../configurations/s3/pharmacy.storage';
import {
  FEATURE_KEYS,
  requireFeature,
} from '../../../../middlewear/limitation.middleware';

const supplierRouter = express.Router();

supplierRouter.post(
  '/add-supplier',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(createSupplierSchema, 'body'),
  addSupplierController
);

supplierRouter.get(
  '/get-all-supplier',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(getSuppliersQuerySchema, 'query'),
  getSuppliersController
);

supplierRouter.get(
  '/get-supplier/:id',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(getSupplierByIdParamsSchema, 'params'),
  getSupplierByIdController
);

supplierRouter.put(
  '/update-supplier/:id',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(updateSupplierParamsSchema, 'params'),
  validate(updateSupplierSchema, 'body'),
  updateSupplierController
);

supplierRouter.get(
  '/download-supplier-sample-template',
  requireAuth,
  downloadSupplierSampleTemplateController
);

supplierRouter.post(
  '/import-supplier',
  requireAuth,
  uploadSupplierImport.single('file'),
  importSuppliersController
);

supplierRouter.get(
  '/export-all-supplier',
  requireAuth,
  uploadSupplierImport.single('file'),
  exportAllSuppliersController
);

supplierRouter.get(
  '/stats',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  getSupplierStatsController
);

export default supplierRouter;
