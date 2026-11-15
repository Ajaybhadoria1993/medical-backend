import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import { listAllReferralsController } from '../../controllers/superadmin.controller';
import { superadminReferralsQuerySchema } from '../../schemas/referral.schema';

// Mounted at /api/v1/referral/superadmin; cross-clinic, so Super Admin only.
const superadminReferralRouter = express.Router();

/** @route GET /api/v1/referral/superadmin/list — every referral with Joined/Paid totals
 *  @access Super_Admin */
superadminReferralRouter.get(
  '/list',
  requireAuth,
  requireSuperAdmin,
  validate(superadminReferralsQuerySchema, 'query'),
  listAllReferralsController
);

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/referral/superadmin/list',
  description:
    'Every referral, filterable by status and IST signup date, with Joined/Paid totals (Super Admin)',
  query: superadminReferralsQuerySchema,
  tags: ['referral'],
});

export default superadminReferralRouter;
