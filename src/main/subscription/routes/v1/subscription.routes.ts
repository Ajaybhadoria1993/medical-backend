import express from 'express';
import {
  requireAuth,
  requireAdmin,
  requireClinic,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { requireBillingAdmin } from '../../middlewares/billingAdmin.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import {
  checkPlanDowngrade,
  downloadInvoicePdf,
  getBillingHistory,
  getSubscriptionActivity,
  getClinicSubscription,
  getPlans,
  getAllPlans,
  reportPaymentFailed,
  retrySubscriptionPayment,
  schedulePlanDowngrade,
  scheduleSubscriptionCancellation,
  subscribeClinic,
  undoScheduledPlanChange,
  undoSubscriptionCancellation,
  updatePlan,
  verifyAndSubscribe,
  razorpayWebhookController,
} from '../../controllers/subscription.controller';
import {
  checkPlanDowngradeSchema,
  planIdParamsSchema,
  reportPaymentFailedSchema,
  schedulePlanDowngradeSchema,
  subscribeClinicSchema,
  updatePlanSchema,
  verifySubscriptionSchema,
} from '../../schemas/subscription.schemas';

const subscriptionRouter = express.Router();

/**
 * @route PATCH /api/v1/subscription/plans/:id
 * @desc Update a subscription plan
 * @access Private (Super Admin)
 */
subscriptionRouter.patch(
  '/plans/:id',
  requireAuth,
  requireSuperAdmin,
  validate(planIdParamsSchema, 'params'),
  validate(updatePlanSchema, 'body'),
  updatePlan
);

/**
 * @route GET /api/v1/subscription/plans
 * @desc Get all available subscription plans
 * @access Public (no auth required — clinics need to browse plans)
 */
subscriptionRouter.get('/plans', getPlans);

/** @route GET /api/v1/subscription/plans/all — every plan, hidden ones included (Super Admin) */
subscriptionRouter.get(
  '/plans/all',
  requireAuth,
  requireSuperAdmin,
  getAllPlans
);

/**
 * @route POST /api/v1/subscription/subscribe
 * @desc Subscribe a clinic to a plan
 * @access Private (Clinic)
 */
subscriptionRouter.post(
  '/subscribe',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  validate(subscribeClinicSchema, 'body'),
  subscribeClinic
);

subscriptionRouter.post(
  '/verify-subscription',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  validate(verifySubscriptionSchema, 'body'),
  verifyAndSubscribe
);

subscriptionRouter.post(
  '/report-payment-failed',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  validate(reportPaymentFailedSchema, 'body'),
  reportPaymentFailed
);

/**
 * @route PUT /api/v1/subscription/schedule-cancel
 * @desc Schedule subscription cancellation at end of billing period
 * @access Private (Clinic)
 */
subscriptionRouter.put(
  '/schedule-cancel',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  scheduleSubscriptionCancellation
);

/**
 * @route PUT /api/v1/subscription/undo-cancel
 * @desc Undo a scheduled subscription cancellation
 * @access Private (Clinic)
 */
subscriptionRouter.put(
  '/undo-cancel',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  undoSubscriptionCancellation
);

/**
 * @route POST /api/v1/subscription/check-downgrade
 * @desc Pre-check resources and account limits before downgrading
 * @access Private (Admin + Clinic)
 */
subscriptionRouter.post(
  '/check-downgrade',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  validate(checkPlanDowngradeSchema, 'body'),
  checkPlanDowngrade
);

/**
 * @route PUT /api/v1/subscription/schedule-downgrade
 * @desc Schedule a plan downgrade at end of billing period
 * @access Private (Admin + Clinic)
 */
subscriptionRouter.put(
  '/schedule-downgrade',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  validate(schedulePlanDowngradeSchema, 'body'),
  schedulePlanDowngrade
);

/**
 * @route PUT /api/v1/subscription/undo-downgrade
 * @desc Undo a scheduled plan downgrade
 * @access Private (Admin + Clinic)
 */
subscriptionRouter.put(
  '/undo-downgrade',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  undoScheduledPlanChange
);

/**
 * @route POST /api/v1/subscription/payment/retry
 * @desc Create a fresh Razorpay order to retry a failed/pending payment
 * @access Private (Admin + Clinic)
 */
subscriptionRouter.post(
  '/payment/retry',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  retrySubscriptionPayment
);

/**
 * @route GET /api/v1/subscription/billing-history
 * @desc Get billing history for the current clinic
 * @access Private (Clinic)
 */
subscriptionRouter.get(
  '/billing-history',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  getBillingHistory
);

/**
 * @route GET /api/v1/subscription/invoice/:invoiceId/download
 * @desc Download invoice PDF for a subscription or add-on transaction
 * @access Private (Clinic)
 */
subscriptionRouter.get(
  '/invoice/:invoiceId/download',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  downloadInvoicePdf
);

/**
 * @route GET /api/v1/subscription/activity
 * @desc Get the subscription activity timeline for the current clinic
 * @access Private (Clinic)
 */
subscriptionRouter.get(
  '/activity',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  getSubscriptionActivity
);

/**
 * @route GET /api/v1/subscription/my-subscription
 * @desc Get current active subscription for the clinic
 * @access Private (Clinic)
 */
subscriptionRouter.get(
  '/my-subscription',
  requireAuth,
  requireAdmin,
  requireClinic,
  getClinicSubscription
);

/** @route POST /api/v1/subscription/razorpay — old webhook link, same handler as /api/v2/subscription/webhooks/razorpay
 *  @access Razorpay (signature-checked). Kept so the Razorpay dashboard needs no change; remove once it points at v2. */
subscriptionRouter.post('/razorpay', razorpayWebhookController);

export default subscriptionRouter;

docsRegistry.addEndpoint({
  method: 'patch',
  path: '/api/v1/subscription/plans/:id',
  description: 'update a subscription plan (Super Admin)',
  params: planIdParamsSchema,
  requestSchema: updatePlanSchema,
  tags: ['subscriptions', 'plan', 'super-admin'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/subscription/subscribe',
  description: 'subscribe to a plan',
  requestSchema: subscribeClinicSchema,
  tags: ['subscriptions', 'subscribe'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/subscription/plans',
  description: 'get subscription',
  tags: ['subscriptions', 'all subscriptions'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/subscription/billing-history',
  description: 'Get clinic billing history',
  tags: ['subscriptions', 'billing'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/subscription/invoice/:invoiceId/download',
  description: 'Download invoice PDF for subscription/add-on',
  tags: ['subscriptions', 'billing', 'invoice'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/subscription/activity',
  description: 'Get the subscription activity timeline for the clinic',
  tags: ['subscriptions', 'activity'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/subscription/my-subscription',
  description: 'Get current active subscription for the clinic',
  tags: ['subscriptions', 'active', 'clinic'],
});
