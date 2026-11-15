import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  clearClinicFreeTrial,
  getFreeTrials,
  setClinicFreeTrial,
  setDefaultFreeTrial,
} from '../../controllers/v2/freeTrial.controller';
import {
  freeTrialClearSchema,
  freeTrialClinicParamsSchema,
  freeTrialDaysSchema,
} from '../../schemas/freeTrial.schemas';

const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

/** @route GET /api/v2/subscription/free-trial — the default trial length and every clinic with its own
 *  @access Super_Admin */
router.get('/', getFreeTrials);

/** @route POST /api/v2/subscription/free-trial/default — the trial length for clinics with none of their own
 *  @access Super_Admin; reason required */
router.post(
  '/default',
  validate(freeTrialDaysSchema, 'body'),
  setDefaultFreeTrial
);

/** @route POST /api/v2/subscription/free-trial/clinic/:clinicId — one clinic's own trial length
 *  @access Super_Admin; reason required, on the clinic's billing timeline */
router.post(
  '/clinic/:clinicId',
  validate(freeTrialClinicParamsSchema, 'params'),
  validate(freeTrialDaysSchema, 'body'),
  setClinicFreeTrial
);

/** @route POST /api/v2/subscription/free-trial/clinic/:clinicId/clear — back to the default trial length
 *  @access Super_Admin; reason required, on the clinic's billing timeline */
router.post(
  '/clinic/:clinicId/clear',
  validate(freeTrialClinicParamsSchema, 'params'),
  validate(freeTrialClearSchema, 'body'),
  clearClinicFreeTrial
);

export default router;

export const apiDocs = [
  {
    method: 'get',
    path: '/',
    description: 'Default free trial length and clinics with their own (Super Admin)',
    tags: ['subscription', 'trial'],
  },
  {
    method: 'post',
    path: '/default',
    description: 'Set the default free trial length with a reason (Super Admin)',
    tags: ['subscription', 'trial'],
  },
  {
    method: 'post',
    path: '/clinic/:clinicId',
    description: "Set one clinic's free trial length with a reason (Super Admin)",
    tags: ['subscription', 'trial'],
  },
  {
    method: 'post',
    path: '/clinic/:clinicId/clear',
    description: "Remove a clinic's own free trial length (Super Admin)",
    tags: ['subscription', 'trial'],
  },
];
