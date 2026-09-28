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
import { requireUserSubscription } from '../../../../middlewear/subscriptionAccess.middleware';

const salesRouter = express.Router();

salesRouter.post(
  '/create-sale',
  requireAuth,
  requireUserSubscription,
  validate(createSaleSchema, 'body'),
  createSaleController
);

salesRouter.get(
  '/get-all-sales',
  requireAuth,
  requireUserSubscription,
  validate(getSalesQuerySchema, 'query'),
  getSalesController
);

salesRouter.post(
  '/create-sales-return',
  requireAuth,
  requireUserSubscription,
  validate(createSalesReturnSchema, 'body'),
  createSalesReturnController
);

salesRouter.get(
  '/get-sales-returns',
  requireAuth,
  requireUserSubscription,
  validate(getSalesReturnsQuerySchema, 'query'),
  getSalesReturnsController
);

salesRouter.get(
  '/get-sale/:id',
  requireAuth,
  requireUserSubscription,
  validate(getSaleByIdParamsSchema, 'params'),
  getSaleByIdController
);

salesRouter.post(
  '/send-invoice-whatsapp/:saleId',
  requireAuth,
  requireUserSubscription,
  validate(sendInvoiceWhatsAppParamsSchema, 'params'),
  sendInvoiceWhatsAppController
);

salesRouter.get(
  '/stats',
  requireAuth,
  requireUserSubscription,
  getSalesStatsController
);

export default salesRouter;
