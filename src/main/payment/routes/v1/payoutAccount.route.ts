import express from 'express';
import multer from 'multer';
import {
  enforceClinicAutoLogout,
  requireAuth,
  requireClinic,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  changePayoutBankController,
  refreshPayoutAccountController,
  getPayoutAccountController,
  submitPayoutAccountController,
} from '../../controllers/payoutAccount.controller';
import { lockRouteOnboarding } from '../../middlewares/routeOnboardingLock.middleware';
import {
  payoutAccountBankSchema,
  payoutAccountSubmitSchema,
} from '../../schemas/payoutAccount.schemas';

// Razorpay's per-file limit; a business type needs at most a handful of documents.
const documents = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 10 },
});

const payoutAccountRouter = express.Router();
const owner = [
  requireAuth,
  requireClinic,
  requireRole(['Admin', 'Super_Admin']),
  enforceClinicAutoLogout,
];

/** @route GET /api/v1/payment/payout-account — the clinic's payout setup status card
 *  @access Admin, Super_Admin (clinic from the token) */
payoutAccountRouter.get('/', ...owner, getPayoutAccountController);

/** @route POST /api/v1/payment/payout-account — the one setup form: details + document files
 *  @access Admin, Super_Admin (clinic from the token) */
payoutAccountRouter.post(
  '/',
  ...owner,
  lockRouteOnboarding,
  documents.any(),
  validate(payoutAccountSubmitSchema, 'body'),
  submitPayoutAccountController
);

/** @route PUT /api/v1/payment/payout-account/bank — change the bank account after setup
 *  @access Admin, Super_Admin (clinic from the token) */
payoutAccountRouter.put(
  '/bank',
  ...owner,
  lockRouteOnboarding,
  validate(payoutAccountBankSchema, 'body'),
  changePayoutBankController
);

/** @route POST /api/v1/payment/payout-account/refresh — ask Razorpay for the status now (Check Status Now)
 *  @access Admin, Super_Admin (clinic from the token) */
payoutAccountRouter.post('/refresh', ...owner, refreshPayoutAccountController);

export default payoutAccountRouter;
