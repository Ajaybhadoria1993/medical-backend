import express from 'express';
import {
  requireAuth,
  requireAdmin,
  requireClinic,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import {
  cancelClinicSubscription,
  checkPlanDowngrade,
  createPlan,
  deletePlan,
  downloadInvoicePdf,
  getBillingHistory,
  getSubscriptionActivity,
  getClinicSubscription,
  getPlans,
  initialSubscribeClinic,
  manageFeatures,
  razorpayWebhookController,
  reportPaymentFailed,
  retrySubscriptionPayment,
  schedulePlanDowngrade,
  scheduleSubscriptionCancellation,
  subscribeClinic,
  subscribeWithAutoPay,
  undoScheduledPlanChange,
  undoSubscriptionCancellation,
  updatePlan,
  verifyAndSubscribe,
} from '../../controllers/subscription.controller';
import {
  cancelSubscribeSchema,
  checkPlanDowngradeSchema,
  createPlanSchema,
  initialSubscribeSchema,
  manageFeaturesBodySchema,
  manageFeaturesParamsSchema,
  planIdParamsSchema,
  reportPaymentFailedSchema,
  schedulePlanDowngradeSchema,
  subscribeClinicSchema,
  subscribeWithAutoPaySchema,
  updatePlanSchema,
  verifySubscriptionSchema,
} from '../../schemas/subscription.schemas';

const subscriptionRouter = express.Router();

/**
 * @route POST /api/v1/subscription/plans
 * @desc Create a new subscription plan
 * @access Private (Super Admin)
 */
subscriptionRouter.post(
  '/plans',
  requireAuth,
  requireSuperAdmin,
  validate(createPlanSchema, 'body'),
  createPlan
);

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
 * @route DELETE /api/v1/subscription/plans/:id
 * @desc Delete a subscription plan
 * @access Private (Super Admin)
 */
subscriptionRouter.delete(
  '/plans/:id',
  requireAuth,
  requireSuperAdmin,
  validate(planIdParamsSchema, 'params'),
  deletePlan
);

/**
 * @route PATCH /api/v1/subscription/manage-features/:planId
 * @desc Manage features for a plan (add, update, delete)
 * @access Private (Super Admin)
 */
subscriptionRouter.patch(
  '/manage-features/:planId',
  requireAuth,
  requireSuperAdmin,
  validate(manageFeaturesParamsSchema, 'params'),
  validate(manageFeaturesBodySchema, 'body'),
  manageFeatures
);

/**
 * @route GET /api/v1/subscription/plans
 * @desc Get all available subscription plans
 * @access Public (no auth required — clinics need to browse plans)
 */
subscriptionRouter.get('/plans', getPlans);

/**
 * @route POST /api/v1/subscription/subscribe
 * @desc Subscribe a clinic to a plan
 * @access Private (Clinic)
 */
subscriptionRouter.post(
  '/subscribe',
  requireAuth,
  requireClinic,
  validate(subscribeClinicSchema, 'body'),
  subscribeClinic
);

/**
 * @route POST /api/v1/subscription/subscribe-autopay
 * @desc Subscribe to a paid plan with AutoPay (pay now + auto-renew)
 * @access Private (Admin + Clinic)
 */
subscriptionRouter.post(
  '/subscribe-autopay',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(subscribeWithAutoPaySchema, 'body'),
  subscribeWithAutoPay
);

subscriptionRouter.post(
  '/verify-subscription',
  requireAuth,
  requireClinic,
  validate(verifySubscriptionSchema, 'body'),
  verifyAndSubscribe
);

subscriptionRouter.post(
  '/report-payment-failed',
  requireAuth,
  requireClinic,
  validate(reportPaymentFailedSchema, 'body'),
  reportPaymentFailed
);

subscriptionRouter.post(
  '/razorpay',
  express.raw({ type: 'application/json' }),
  razorpayWebhookController
);

subscriptionRouter.post(
  '/initial-subscribe',
  requireAuth,
  requireClinic,
  validate(initialSubscribeSchema, 'body'),
  initialSubscribeClinic
);

/**
 * @route PUT /api/v1/subscription/cancel/:subscriptionId
 * @desc Cancel an active clinic subscription (immediate)
 * @access Private
 */
subscriptionRouter.put(
  '/cancel/:subscriptionId',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(cancelSubscribeSchema, 'params'),
  cancelClinicSubscription
);

/**
 * @route PUT /api/v1/subscription/schedule-cancel
 * @desc Schedule subscription cancellation at end of billing period
 * @access Private (Clinic)
 */
subscriptionRouter.put(
  '/schedule-cancel',
  requireAuth,
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
  requireAdmin,
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
  requireAdmin,
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
  requireAdmin,
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
  requireAdmin,
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

// ============ RENEWAL REMINDER ROUTES ============

import {
  sendExpiryReminders,
  sendReminderToClinic,
} from '../../controllers/renewalReminder.controller';

/**
 * @route POST /api/v1/subscription/reminders/send-expiry-reminders
 * @desc Send renewal reminders to all clinics with expiring plans (cron/admin)
 * @access Private (Super Admin)
 */
subscriptionRouter.post(
  '/reminders/send-expiry-reminders',
  requireAuth,
  requireSuperAdmin,
  sendExpiryReminders
);

/**
 * @route POST /api/v1/subscription/reminders/send-to-clinic
 * @desc Send renewal reminder to a specific clinic
 * @access Private (Admin + Clinic)
 */
subscriptionRouter.post(
  '/reminders/send-to-clinic',
  requireAuth,
  requireAdmin,
  requireClinic,
  sendReminderToClinic
);

// ============ AUTO-RENEWAL ROUTES ============

import {
  enableAutoRenew,
  disableAutoRenew,
  getAutoRenewStatus,
} from '../../controllers/autoRenew.controller';

/**
 * @route GET /api/v1/subscription/auto-renew/status
 * @desc Get auto-renewal status for the clinic
 * @access Private (Clinic)
 */
subscriptionRouter.get(
  '/auto-renew/status',
  requireAuth,
  requireClinic,
  getAutoRenewStatus
);

/**
 * @route POST /api/v1/subscription/auto-renew/enable
 * @desc Enable auto-renewal (creates Razorpay subscription)
 * @access Private (Clinic)
 */
subscriptionRouter.post(
  '/auto-renew/enable',
  requireAuth,
  requireAdmin,
  requireClinic,
  enableAutoRenew
);

/**
 * @route POST /api/v1/subscription/auto-renew/disable
 * @desc Disable auto-renewal (cancels Razorpay subscription)
 * @access Private (Clinic)
 */
subscriptionRouter.post(
  '/auto-renew/disable',
  requireAuth,
  requireAdmin,
  requireClinic,
  disableAutoRenew
);

export default subscriptionRouter;

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/subscription/plans',
  description: 'create subscriptions plan (Super Admin)',
  requestSchema: createPlanSchema,
  tags: ['subscriptions', 'plan', 'super-admin'],
});

docsRegistry.addEndpoint({
  method: 'patch',
  path: '/api/v1/subscription/plans/:id',
  description: 'update a subscription plan (Super Admin)',
  params: planIdParamsSchema,
  requestSchema: updatePlanSchema,
  tags: ['subscriptions', 'plan', 'super-admin'],
});

docsRegistry.addEndpoint({
  method: 'delete',
  path: '/api/v1/subscription/plans/:id',
  description: 'delete a subscription plan (Super Admin)',
  params: planIdParamsSchema,
  tags: ['subscriptions', 'plan', 'super-admin'],
});

docsRegistry.addEndpoint({
  method: 'patch',
  path: '/api/v1/subscription/manage-features/:planId',
  description: 'Manage features (add, update, delete) for a plan (Super Admin)',
  params: manageFeaturesParamsSchema,
  requestSchema: manageFeaturesBodySchema,
  tags: ['subscriptions', 'features', 'super-admin'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/subscription/subscribe',
  description: 'subscribe to a plan',
  requestSchema: subscribeClinicSchema,
  tags: ['subscriptions', 'subscribe'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/subscription/cancel/:subscriptionId',
  description: 'cancel subscription',
  params: cancelSubscribeSchema,
  tags: ['subscriptions', 'cancel'],
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
