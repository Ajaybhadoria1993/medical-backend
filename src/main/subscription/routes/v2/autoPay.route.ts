import express from 'express';
import {
  requireAuth,
  requireClinic,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  disableAutoPay,
  getAutoPay,
  startAutoPaySetup,
  verifyAutoPaySetup,
} from '../../controllers/v2/autoPay.controller';
import { requireBillingAdmin } from '../../middlewares/billingAdmin.middleware';
import {
  autoPaySetupSchema,
  autoPayVerifySchema,
} from '../../schemas/autoPay.schemas';

const router = express.Router();
router.use(requireAuth, requireBillingAdmin, requireClinic);

/** @route GET /api/v2/subscription/auto-pay — AutoPay on/off, method, limit, or why it can't be turned on
 *  @access Admin, Super_Admin (billing admin) of the current clinic */
router.get('/', getAutoPay);

/** @route POST /api/v2/subscription/auto-pay/setup — start the AutoPay approval checkout (Idempotency-Key)
 *  @access Admin, Super_Admin of the current clinic; monthly paid plan only (service) */
router.post('/setup', validate(autoPaySetupSchema, 'body'), startAutoPaySetup);

/** @route POST /api/v2/subscription/auto-pay/disable — turn AutoPay off here and at Razorpay
 *  @access Admin, Super_Admin of the current clinic */
router.post('/disable', disableAutoPay);

/** @route POST /api/v2/subscription/auto-pay/verify — confirm the approval after Razorpay Checkout
 *  @access Admin, Super_Admin of the current clinic; the order must be this clinic's (service) */
router.post(
  '/verify',
  validate(autoPayVerifySchema, 'body'),
  verifyAutoPaySetup
);

export default router;

export const apiDocs = [
  {
    method: 'get',
    path: '/',
    description: 'AutoPay status (Admin)',
    tags: ['subscription', 'autopay'],
  },
  {
    method: 'post',
    path: '/setup',
    description: 'Start an AutoPay approval for a monthly plan (Admin)',
    tags: ['subscription', 'autopay'],
  },
  {
    method: 'post',
    path: '/disable',
    description: 'Turn AutoPay off (Admin)',
    tags: ['subscription', 'autopay'],
  },
  {
    method: 'post',
    path: '/verify',
    description: 'Confirm an AutoPay approval after Checkout (Admin)',
    tags: ['subscription', 'autopay'],
  },
];
