import express from 'express';
import {
  requireAuth,
  requireClinic,
} from '../../../../middlewear/auth.middleware';
import { requireBillingAdmin } from '../../middlewares/billingAdmin.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import { quotePlanPurchase } from '../../controllers/combinedPurchase.controller';
import { planQuoteSchema } from '../../schemas/combinedPurchase.schemas';

const combinedPurchaseRouter = express.Router();

/**
 * @route POST /api/v1/subscription/quote
 * @desc Price a plan purchase (cycle, proration credit, coupon) without an order
 * @access Private (Clinic)
 */
combinedPurchaseRouter.post(
  '/quote',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  validate(planQuoteSchema, 'body'),
  quotePlanPurchase
);

export default combinedPurchaseRouter;

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/subscription/quote',
  description: 'Price a plan purchase without creating an order',
  requestSchema: planQuoteSchema,
  tags: ['subscription', 'pricing'],
});
