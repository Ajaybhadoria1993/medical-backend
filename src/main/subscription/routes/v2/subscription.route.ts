import express from 'express';
import {
  requireAdmin,
  requireAuth,
  requireClinic,
} from '../../../../middlewear/auth.middleware';
import { razorpayWebhookController } from '../../controllers/subscription.controller';
import {
  getSubscriptionCatalog,
  getSubscriptionPage,
  startTrial,
} from '../../controllers/v2/subscription.controller';
import { requireBillingAdmin } from '../../middlewares/billingAdmin.middleware';

const subscriptionRouterV2 = express.Router();

/** @route POST /api/v2/subscription/trial — start the clinic's free trial
 *  @access Admin, Super_Admin (once per clinic, only from the Free plan) */
subscriptionRouterV2.post(
  '/trial',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  startTrial
);

/** @route GET /api/v2/subscription/catalog — plans and add-on prices (cached, the same for every clinic)
 *  @access Any signed-in user */
subscriptionRouterV2.get('/catalog', requireAuth, getSubscriptionCatalog);

/** @route GET /api/v2/subscription/overview — the clinic's plan, usage, renewal, add-on availability, recent invoices
 *  @access Admin (same as my-subscription) */
subscriptionRouterV2.get(
  '/overview',
  requireAuth,
  requireAdmin,
  requireClinic,
  getSubscriptionPage
);

/** @route POST /api/v2/subscription/webhooks/razorpay — Razorpay events, signature-checked
 *  @access Public (Razorpay only) */
subscriptionRouterV2.post('/webhooks/razorpay', razorpayWebhookController);

export default subscriptionRouterV2;

export const apiDocs = [
  {
    method: 'get',
    path: '/catalog',
    description: 'Plans and add-on prices, the same for every clinic (cached)',
    tags: ['subscription'],
  },
  {
    method: 'get',
    path: '/overview',
    description:
      "The clinic's billing page data: current plan, usage, next renewal, add-on availability, last 5 invoices",
    tags: ['subscription'],
  },
  {
    method: 'post',
    path: '/trial',
    description: "Start the clinic's free trial (Admin, Super Admin)",
    tags: ['subscription', 'trial'],
  },
  {
    method: 'post',
    path: '/webhooks/razorpay',
    description: 'Razorpay webhook (signature-checked)',
    tags: ['subscription', 'webhook'],
  },
];
