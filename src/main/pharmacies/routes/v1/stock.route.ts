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
import { requireUserSubscription } from '../../../../middlewear/subscriptionAccess.middleware';

const stockRouter = express.Router();

stockRouter.post(
  '/add-stock',
  requireAuth,
  requireUserSubscription,
  validate(addStockSchema, 'body'),
  addStockController
);

stockRouter.get(
  '/get-all-stock',
  requireAuth,
  requireUserSubscription,
  validate(getStockQuerySchema, 'query'),
  getStocksController
);

stockRouter.put(
  '/update-medicine-stock/:stockMedicineId',
  requireAuth,
  requireUserSubscription,
  validate(updateSingleStockMedicineSchema, 'body'),
  updateStockMedicineController
);

stockRouter.get(
  '/get-stock/:id',
  requireAuth,
  requireUserSubscription,
  validate(getStockByIdParamsSchema, 'params'),
  getStockByIdController
);

stockRouter.put(
  '/update-stock/:id',
  requireAuth,
  requireUserSubscription,
  validate(updateStockParamsSchema, 'params'),
  validate(updateStockSchema, 'body'),
  updateStockController
);

stockRouter.post(
  '/upload-invoice/:stockId',
  requireAuth,
  requireUserSubscription,
  fileCompressionMiddleware,
  uploadPharmacySupplierInvoice.single('invoice'),
  validate(updateStockInvoiceParamsSchema, 'params'),
  updateStockInvoiceController
);

stockRouter.get(
  '/get-available-stock',
  requireAuth,
  requireUserSubscription,
  validate(getAvailableStockQuerySchema, 'query'),
  getAvailableStockController
);

stockRouter.get(
  '/get-stock-cache',
  requireAuth,
  requireUserSubscription,
  getStockCacheController
);

stockRouter.get(
  '/export-all-stock',
  requireAuth,
  requireUserSubscription,
  exportAllStockController
);

stockRouter.get(
  '/download-stock-sample-template',
  requireAuth,
  requireUserSubscription,
  downloadStockSampleTemplateController
);

stockRouter.post(
  '/import-stock',
  requireAuth,
  uploadStockImport.single('file'),
  requireUserSubscription,
  importStockController
);

stockRouter.get(
  '/stats',
  requireAuth,
  requireUserSubscription,
  getStockStatsController
);

stockRouter.get(
  '/get-expiry-stock',
  requireAuth,
  requireUserSubscription,
  validate(getExpiryStockQuerySchema, 'query'),
  getExpiryStockController
);

stockRouter.post(
  '/create-purchase-return',
  requireAuth,
  requireUserSubscription,
  validate(createPurchaseReturnSchema, 'body'),
  createPurchaseReturnController
);

stockRouter.get(
  '/get-purchase-returns',
  requireAuth,
  requireUserSubscription,
  validate(getPurchaseReturnsQuerySchema, 'query'),
  getPurchaseReturnsController
);

export default stockRouter;
