import express from 'express';
import {
  requireAuth,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import {
  getMyReferralCodeController,
  getMyReferralsController,
} from '../../controllers/referral.controller';
import { myReferralsQuerySchema } from '../../schemas/referral.schema';
import { REFERRAL_ROLES } from '../../utils/referralCode.utils';

// Mounted at /api/v1/referral; scoped to the caller's own code.
const referralRouter = express.Router();

/** @route GET /api/v1/referral/my-code — the caller's referral code and link, created on first call
 *  @access Admin, Doctor (own code) */
referralRouter.get(
  '/my-code',
  requireAuth,
  requireRole(REFERRAL_ROLES),
  getMyReferralCodeController
);

/** @route GET /api/v1/referral/my-referrals — signups with the caller's code, plus Joined/Paid counts
 *  @access Admin, Doctor (own code) */
referralRouter.get(
  '/my-referrals',
  requireAuth,
  requireRole(REFERRAL_ROLES),
  validate(myReferralsQuerySchema, 'query'),
  getMyReferralsController
);

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/referral/my-code',
  description: "The caller's referral code and signup link (Admin, Doctor)",
  tags: ['referral'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/referral/my-referrals',
  description:
    'Signups with the caller’s code, newest first, with Joined/Paid counts (Admin, Doctor)',
  query: myReferralsQuerySchema,
  tags: ['referral'],
});

export default referralRouter;
