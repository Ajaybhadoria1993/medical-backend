import express from 'express';
import { validate } from '../../../../middlewear/validation.middleware';
import { requireAuth } from '../../../../middlewear/auth.middleware';
// import { requirePharmacySubscription } from '../../../../middlewear/subscriptionAccess.middleware';
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
import { requireUserSubscription } from '../../../../middlewear/subscriptionAccess.middleware';

const supplierRouter = express.Router();

supplierRouter.post(
  '/add-supplier',
  requireAuth,
  requireUserSubscription,
  validate(createSupplierSchema, 'body'),
  addSupplierController
);

supplierRouter.get(
  '/get-all-supplier',
  requireAuth,
  requireUserSubscription,
  validate(getSuppliersQuerySchema, 'query'),
  getSuppliersController
);

supplierRouter.get(
  '/get-supplier/:id',
  requireAuth,
  requireUserSubscription,
  validate(getSupplierByIdParamsSchema, 'params'),
  getSupplierByIdController
);

supplierRouter.put(
  '/update-supplier/:id',
  requireAuth,
  requireUserSubscription,
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
  requireUserSubscription,
  getSupplierStatsController
);

export default supplierRouter;
