import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import { listPayoutAccountsController } from '../../controllers/payoutAccounts.controller';
import { payoutAccountsQuerySchema } from '../../schemas/payoutAccounts.schema';

// Mounted at /api/v1/superadmin-analytics/payout-accounts.
const payoutAccountsRouter = express.Router();

/** @route GET /api/v1/superadmin-analytics/payout-accounts — ?page&pageSize&state&q */
payoutAccountsRouter.get(
  '/',
  requireAuth,
  requireSuperAdmin,
  validate(payoutAccountsQuerySchema, 'query'),
  listPayoutAccountsController
);

export default payoutAccountsRouter;

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/superadmin-analytics/payout-accounts',
  description:
    "Every clinic's payout account status with masked bank (Super Admin)",
  tags: ['superadmin'],
});
