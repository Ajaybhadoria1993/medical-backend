import express from 'express';
import {
  requireAuth,
  requireClinic,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { requireBillingAdmin } from '../../middlewares/billingAdmin.middleware';
import { requireFeature } from '../../../../middlewear/limitation.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import { FEATURE_KEYS } from '../../services/limitation.service';
import {
  getActiveAddOns,
  getAvailableAddOns,
  purchaseAddOn,
  quoteAddOns,
  reduceAddOnQuantity,
  scheduleAddOnCancellation,
  undoAddOnCancellation,
  verifyPurchase,
} from '../../controllers/addon.controller';
import {
  initiatePurchaseSchema,
  verifyPurchaseSchema,
  clinicAddOnIdParamsSchema,
  scheduleCancelAddOnSchema,
  reduceAddOnQuantitySchema,
} from '../../schemas/addon.schemas';

const addonRouter = express.Router();

/**
 * @route GET /api/v1/subscription/addons/active
 * @desc Get active add-ons
 * @access Private (Admin)
 */
addonRouter.get('/active', requireAuth, requireSuperAdmin, getActiveAddOns);

/**
 * @route GET /api/v1/subscription/addons/available
 * @desc Get available add-ons for purchase
 * @access Private (Clinic)
 */
addonRouter.get(
  '/available',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  getAvailableAddOns
);

/**
 * @route POST /api/v1/subscription/addons/purchase
 * @desc Initiate add-on purchase
 * @access Private (Clinic)
 */
addonRouter.post(
  '/purchase',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  requireFeature(FEATURE_KEYS.ADD_ONS),
  validate(initiatePurchaseSchema, 'body'),
  purchaseAddOn
);

/**
 * @route POST /api/v1/subscription/addons/quote
 * @desc Pro-rated pricing for an add-on selection, without creating an order
 * @access Private (Clinic)
 */
addonRouter.post(
  '/quote',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  requireFeature(FEATURE_KEYS.ADD_ONS),
  validate(initiatePurchaseSchema, 'body'),
  quoteAddOns
);

/**
 * @route POST /api/v1/subscription/addons/verify-purchase
 * @desc Verify payment and complete add-on purchase
 * @access Private (Clinic)
 */
addonRouter.post(
  '/verify-purchase',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  validate(verifyPurchaseSchema, 'body'),
  verifyPurchase
);

/**
 * @route PUT /api/v1/subscription/addons/reduce-quantity/:clinicAddOnId
 * @desc Reduce the quantity of an active add-on
 * @access Private (Clinic)
 */
addonRouter.put(
  '/reduce-quantity/:clinicAddOnId',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  validate(clinicAddOnIdParamsSchema, 'params'),
  validate(reduceAddOnQuantitySchema, 'body'),
  reduceAddOnQuantity
);

/**
 * @route PUT /api/v1/subscription/addons/schedule-cancel/:clinicAddOnId
 * @desc Schedule add-on cancellation at end of billing period
 * @access Private (Clinic)
 */
addonRouter.put(
  '/schedule-cancel/:clinicAddOnId',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  validate(clinicAddOnIdParamsSchema, 'params'),
  validate(scheduleCancelAddOnSchema, 'body'),
  scheduleAddOnCancellation
);

/**
 * @route PUT /api/v1/subscription/addons/undo-cancel/:clinicAddOnId
 * @desc Undo a scheduled add-on cancellation
 * @access Private (Clinic)
 */
addonRouter.put(
  '/undo-cancel/:clinicAddOnId',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  validate(clinicAddOnIdParamsSchema, 'params'),
  undoAddOnCancellation
);

export default addonRouter;

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/subscription/addons/available',
  description: 'Get available add-ons for purchase',
  tags: ['addons', 'clinic'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/subscription/addons/purchase',
  description: 'Initiate add-on purchase',
  requestSchema: initiatePurchaseSchema,
  tags: ['addons', 'purchase'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/subscription/addons/quote',
  description: 'Pro-rated add-on pricing without creating an order',
  requestSchema: initiatePurchaseSchema,
  tags: ['addons', 'pricing'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/subscription/addons/verify-purchase',
  description: 'Verify payment and complete add-on purchase',
  requestSchema: verifyPurchaseSchema,
  tags: ['addons', 'purchase'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/subscription/addons/schedule-cancel/:clinicAddOnId',
  description: 'Schedule add-on cancellation at end of billing period',
  params: clinicAddOnIdParamsSchema,
  requestSchema: scheduleCancelAddOnSchema,
  tags: ['addons', 'clinic'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/subscription/addons/reduce-quantity/:clinicAddOnId',
  description: 'Reduce the quantity of an active add-on',
  params: clinicAddOnIdParamsSchema,
  requestSchema: reduceAddOnQuantitySchema,
  tags: ['addons', 'clinic'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/subscription/addons/undo-cancel/:clinicAddOnId',
  description: 'Undo a scheduled add-on cancellation',
  params: clinicAddOnIdParamsSchema,
  tags: ['addons', 'clinic'],
});
