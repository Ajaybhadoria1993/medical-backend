import express from 'express';
import { validate } from '../../../../middlewear/validation.middleware';
import { requireAuth } from '../../../../middlewear/auth.middleware';
import {
  createSaleSchema,
  getSaleByIdParamsSchema,
  getSalesQuerySchema,
  sendInvoiceWhatsAppParamsSchema,
} from '../../schemas/sales.schema';
import {
  createSalesReturnSchema,
  getSalesReturnsQuerySchema,
} from '../../schemas/salesReturn.schema';
import {
  createSaleController,
  getSaleByIdController,
  getSalesController,
  getSalesStatsController,
  sendInvoiceWhatsAppController,
} from '../../controllers/sales.controller';
import {
  createSalesReturnController,
  getSalesReturnsController,
} from '../../controllers/salesReturn.controller';
import {
  FEATURE_KEYS,
  requireFeature,
} from '../../../../middlewear/limitation.middleware';

const salesRouter = express.Router();

salesRouter.post(
  '/create-sale',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(createSaleSchema, 'body'),
  createSaleController
);

salesRouter.get(
  '/get-all-sales',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(getSalesQuerySchema, 'query'),
  getSalesController
);

salesRouter.post(
  '/create-sales-return',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(createSalesReturnSchema, 'body'),
  createSalesReturnController
);

salesRouter.get(
  '/get-sales-returns',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(getSalesReturnsQuerySchema, 'query'),
  getSalesReturnsController
);

salesRouter.get(
  '/get-sale/:id',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(getSaleByIdParamsSchema, 'params'),
  getSaleByIdController
);

salesRouter.post(
  '/send-invoice-whatsapp/:saleId',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(sendInvoiceWhatsAppParamsSchema, 'params'),
  sendInvoiceWhatsAppController
);

salesRouter.get(
  '/stats',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  getSalesStatsController
);

export default salesRouter;
