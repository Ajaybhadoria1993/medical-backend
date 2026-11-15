// src/main/subscription/routes/v1/limitations.route.ts
import express from 'express';
import {
  requireAuth,
  requireClinic,
} from '../../../../middlewear/auth.middleware';
import { docsRegistry } from '../../../../apiDocs';
import { getClinicLimitsOverview } from '../../controllers/limitation.controller';

const limitationsRouter = express.Router();

/**
 * @route GET /api/v1/subscription/limitations/overview
 * @desc Get all plan limits and current usage for the clinic
 * @access Private (Authenticated + Clinic)
 */
limitationsRouter.get(
  '/overview',
  requireAuth,
  requireClinic,
  getClinicLimitsOverview
);

export default limitationsRouter;

// API Documentation
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/subscription/limitations/overview',
  description: 'Get all plan limits and current usage for the clinic',
  tags: ['limitations', 'plan'],
});
