import express from 'express';
import {
  requireAuth,
  requireClinic,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import {
  getCreditSummaryController,
  listClinicGrantsController,
} from '../../controllers/credits.controller';
import {
  creditTypeQuerySchema,
  grantsQuerySchema,
} from '../../schemas/credits.schema';

// Mounted at /api/v1/credits; the clinic always comes from the token.
const creditsRouter = express.Router();

/** @route GET /api/v1/credits/summary — free messages this billing month and credit balance
 *  @access Admin (own clinic) */
creditsRouter.get(
  '/summary',
  requireAuth,
  requireRole(['Admin']),
  requireClinic,
  validate(creditTypeQuerySchema, 'query'),
  getCreditSummaryController
);

/** @route GET /api/v1/credits/grants — the clinic's credit grants and removals, newest first
 *  @access Admin (own clinic) */
creditsRouter.get(
  '/grants',
  requireAuth,
  requireRole(['Admin']),
  requireClinic,
  validate(grantsQuerySchema, 'query'),
  listClinicGrantsController
);

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/credits/summary',
  description:
    'Free messages used this billing month, reset date, credit balance and next expiry (Admin)',
  query: creditTypeQuerySchema,
  tags: ['credits'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/credits/grants',
  description: "The clinic's credit grants and removals, paginated (Admin)",
  query: grantsQuerySchema,
  tags: ['credits'],
});

export default creditsRouter;
