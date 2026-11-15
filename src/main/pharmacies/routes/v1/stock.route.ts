import express from 'express';
import { validate } from '../../../../middlewear/validation.middleware';
import { requireAuth } from '../../../../middlewear/auth.middleware';
import { fileCompressionMiddleware } from '../../../../middlewear/fileCompression.middleware';
import {
  addStockSchema,
  getAvailableStockQuerySchema,
  getExpiryStockQuerySchema,
  getStockByIdParamsSchema,
  getStockQuerySchema,
  updateSingleStockMedicineSchema,
  updateStockInvoiceParamsSchema,
  updateStockParamsSchema,
  updateStockSchema,
} from '../../schemas/stock.schema';
import {
  createPurchaseReturnSchema,
  getPurchaseReturnsQuerySchema,
} from '../../schemas/purchaseReturn.schema';
import {
  addStockController,
  downloadStockSampleTemplateController,
  exportAllStockController,
  getAvailableStockController,
  getExpiryStockController,
  getStockCacheController,
  getStockByIdController,
  getStocksController,
  getStockStatsController,
  importStockController,
  updateStockController,
  updateStockInvoiceController,
  updateStockMedicineController,
} from '../../controllers/stock.controller';
import {
  createPurchaseReturnController,
  getPurchaseReturnsController,
} from '../../controllers/purchaseReturn.controller';
import {
  uploadPharmacySupplierInvoice,
  uploadStockImport,
} from '../../../../configurations/s3/pharmacy.storage';
import {
  FEATURE_KEYS,
  requireFeature,
} from '../../../../middlewear/limitation.middleware';

const stockRouter = express.Router();

stockRouter.post(
  '/add-stock',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(addStockSchema, 'body'),
  addStockController
);

stockRouter.get(
  '/get-all-stock',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(getStockQuerySchema, 'query'),
  getStocksController
);

stockRouter.put(
  '/update-medicine-stock/:stockMedicineId',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(updateSingleStockMedicineSchema, 'body'),
  updateStockMedicineController
);

stockRouter.get(
  '/get-stock/:id',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(getStockByIdParamsSchema, 'params'),
  getStockByIdController
);

stockRouter.put(
  '/update-stock/:id',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(updateStockParamsSchema, 'params'),
  validate(updateStockSchema, 'body'),
  updateStockController
);

stockRouter.post(
  '/upload-invoice/:stockId',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  fileCompressionMiddleware,
  uploadPharmacySupplierInvoice.single('invoice'),
  validate(updateStockInvoiceParamsSchema, 'params'),
  updateStockInvoiceController
);

stockRouter.get(
  '/get-available-stock',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(getAvailableStockQuerySchema, 'query'),
  getAvailableStockController
);

stockRouter.get(
  '/get-stock-cache',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  getStockCacheController
);

stockRouter.get(
  '/export-all-stock',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  exportAllStockController
);

stockRouter.get(
  '/download-stock-sample-template',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  downloadStockSampleTemplateController
);

stockRouter.post(
  '/import-stock',
  requireAuth,
  uploadStockImport.single('file'),
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  importStockController
);

stockRouter.get(
  '/stats',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  getStockStatsController
);

stockRouter.get(
  '/get-expiry-stock',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(getExpiryStockQuerySchema, 'query'),
  getExpiryStockController
);

stockRouter.post(
  '/create-purchase-return',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(createPurchaseReturnSchema, 'body'),
  createPurchaseReturnController
);

stockRouter.get(
  '/get-purchase-returns',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(getPurchaseReturnsQuerySchema, 'query'),
  getPurchaseReturnsController
);

export default stockRouter;
