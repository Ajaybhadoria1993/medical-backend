import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  cancelClinicAutoPay,
  checkClinicWithRazorpay,
  getBillingTestEnabled,
  getBillingTestStatus,
  runBillingTest,
  checkPaymentWithRazorpay,
  extendClinicPlan,
  getBillingChecks,
  getClinicBilling,
  refundClinicPayment,
  resendClinicInvoice,
  resolveBillingCheck,
  retryBillingCheck,
  retryStuckWebhook,
  runBillingChecks,
  syncClinicWithRazorpay,
} from '../../controllers/v2/billingChecks.controller';
import {
  billingCheckIdParamsSchema,
  billingClinicInvoiceParamsSchema,
  billingClinicParamsSchema,
  billingClinicPaymentParamsSchema,
  billingExtendSchema,
  billingReasonSchema,
  billingResolveSchema,
  billingTestParamsSchema,
} from '../../schemas/billingChecks.schemas';

const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

/** @route GET /api/v2/subscription/billing-checks — open differences with Razorpay and webhook health
 *  @access Super_Admin */
router.get('/', getBillingChecks);

/** @route GET /api/v2/subscription/billing-checks/clinic/:clinicId — one clinic's payments and AutoPay
 *  @access Super_Admin */
router.get(
  '/clinic/:clinicId',
  validate(billingClinicParamsSchema, 'params'),
  getClinicBilling
);

/** @route POST …/billing-checks/clinic/:clinicId/payments/:paymentId/refund — full refund; the plan stays
 *  @access Super_Admin; reason required, audit-logged */
router.post(
  '/clinic/:clinicId/payments/:paymentId/refund',
  validate(billingClinicPaymentParamsSchema, 'params'),
  validate(billingReasonSchema, 'body'),
  refundClinicPayment
);

/** @route GET …/billing-checks/test — is the staging test tool on
 *  @access Super_Admin */
router.get('/test', getBillingTestEnabled);

/** @route GET …/billing-checks/clinic/:clinicId/test — test status for one clinic (404 outside dev/staging)
 *  @access Super_Admin */
router.get(
  '/clinic/:clinicId/test',
  validate(billingClinicParamsSchema, 'params'),
  getBillingTestStatus
);

/** @route POST …/billing-checks/clinic/:clinicId/test/:action — move one clinic's renewal and run the real job
 *  @access Super_Admin; dev/staging with a Razorpay test key only; on the billing timeline */
router.post(
  '/clinic/:clinicId/test/:action',
  validate(billingTestParamsSchema, 'params'),
  runBillingTest
);

/** @route GET …/billing-checks/clinic/:clinicId/razorpay — live compare of this clinic with Razorpay (read only)
 *  @access Super_Admin */
router.get(
  '/clinic/:clinicId/razorpay',
  validate(billingClinicParamsSchema, 'params'),
  checkClinicWithRazorpay
);

/** @route GET …/billing-checks/clinic/:clinicId/payments/:paymentId/razorpay — one payment from Razorpay, on click
 *  @access Super_Admin */
router.get(
  '/clinic/:clinicId/payments/:paymentId/razorpay',
  validate(billingClinicPaymentParamsSchema, 'params'),
  checkPaymentWithRazorpay
);

/** @route POST …/billing-checks/clinic/:clinicId/razorpay/sync — make ours match Razorpay
 *  @access Super_Admin; reason required, audit-logged */
router.post(
  '/clinic/:clinicId/razorpay/sync',
  validate(billingClinicParamsSchema, 'params'),
  validate(billingReasonSchema, 'body'),
  syncClinicWithRazorpay
);

/** @route POST …/billing-checks/clinic/:clinicId/extend — add 1-90 days to the running paid plan
 *  @access Super_Admin; reason required, audit-logged */
router.post(
  '/clinic/:clinicId/extend',
  validate(billingClinicParamsSchema, 'params'),
  validate(billingExtendSchema, 'body'),
  extendClinicPlan
);

/** @route POST …/billing-checks/clinic/:clinicId/autopay/cancel — turn the clinic's AutoPay off
 *  @access Super_Admin; reason required, audit-logged */
router.post(
  '/clinic/:clinicId/autopay/cancel',
  validate(billingClinicParamsSchema, 'params'),
  validate(billingReasonSchema, 'body'),
  cancelClinicAutoPay
);

/** @route POST …/billing-checks/clinic/:clinicId/invoices/:invoiceId/resend — email the invoice again
 *  @access Super_Admin; reason required, audit-logged */
router.post(
  '/clinic/:clinicId/invoices/:invoiceId/resend',
  validate(billingClinicInvoiceParamsSchema, 'params'),
  validate(billingReasonSchema, 'body'),
  resendClinicInvoice
);

/** @route POST /api/v2/subscription/billing-checks/run — compare with Razorpay now
 *  @access Super_Admin */
router.post('/run', runBillingChecks);

/** @route POST /api/v2/subscription/billing-checks/webhooks/:id/retry — retry a Razorpay event that ran out of tries
 *  @access Super_Admin; logged with who retried it */
router.post(
  '/webhooks/:id/retry',
  validate(billingCheckIdParamsSchema, 'params'),
  retryStuckWebhook
);

/** @route POST /api/v2/subscription/billing-checks/:id/retry — apply a captured payment or retry a stuck refund
 *  @access Super_Admin */
router.post(
  '/:id/retry',
  validate(billingCheckIdParamsSchema, 'params'),
  retryBillingCheck
);

/** @route POST /api/v2/subscription/billing-checks/:id/resolve — close a difference with what was done
 *  @access Super_Admin; reason required, audit-logged */
router.post(
  '/:id/resolve',
  validate(billingCheckIdParamsSchema, 'params'),
  validate(billingResolveSchema, 'body'),
  resolveBillingCheck
);

export default router;

export const apiDocs = [
  {
    method: 'get',
    path: '/',
    description:
      'Open differences between our payments and Razorpay (Super Admin)',
    tags: ['subscription', 'billing'],
  },
  {
    method: 'get',
    path: '/clinic/:clinicId',
    description:
      "One clinic's payments with Razorpay IDs and its AutoPay (Super Admin)",
    tags: ['subscription', 'billing'],
  },
  {
    method: 'post',
    path: '/clinic/:clinicId/payments/:paymentId/refund',
    description: 'Refund a clinic payment with a reason (Super Admin)',
    tags: ['subscription', 'billing'],
  },
  {
    method: 'post',
    path: '/clinic/:clinicId/extend',
    description:
      "Extend a clinic's plan by 1-90 days with a reason (Super Admin)",
    tags: ['subscription', 'billing'],
  },
  {
    method: 'post',
    path: '/clinic/:clinicId/autopay/cancel',
    description: "Turn a clinic's AutoPay off with a reason (Super Admin)",
    tags: ['subscription', 'billing'],
  },
  {
    method: 'post',
    path: '/clinic/:clinicId/invoices/:invoiceId/resend',
    description: 'Email an invoice again (Super Admin)',
    tags: ['subscription', 'billing'],
  },
  {
    method: 'post',
    path: '/run',
    description: 'Compare with Razorpay now (Super Admin)',
    tags: ['subscription', 'billing'],
  },
  {
    method: 'post',
    path: '/:id/retry',
    description:
      'Apply a captured payment or retry a stuck refund (Super Admin)',
    tags: ['subscription', 'billing'],
  },
  {
    method: 'post',
    path: '/:id/resolve',
    description: 'Mark a difference resolved with a reason (Super Admin)',
    tags: ['subscription', 'billing'],
  },
];
