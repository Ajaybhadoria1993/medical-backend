import express from 'express';
import {
  requireAuth,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import {
  getNoLossController,
  noLossController,
} from '../../controllers/setting.controller';
import {
  FEATURE_KEYS,
  requireFeature,
} from '../../../../middlewear/limitation.middleware';

const settingRouter = express.Router();

// Pharmacist owns the pharmacy; Admin owns the clinic it belongs to.
const NO_LOSS_ROLES = ['Admin', 'Pharmacist'];

/** @route GET /api/v1/pharmacies/setting/no-loss — read the pharmacy's No Loss flag
 *  @access Admin, Pharmacist (own pharmacy; Admin falls back to the clinic's) */
settingRouter.get(
  '/no-loss',
  requireAuth,
  requireRole(NO_LOSS_ROLES),
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  getNoLossController
);

/** @route POST /api/v1/pharmacies/setting/no-loss — toggle the pharmacy's No Loss flag
 *  @access Admin, Pharmacist (own pharmacy; Admin falls back to the clinic's) */
settingRouter.post(
  '/no-loss',
  requireAuth,
  requireRole(NO_LOSS_ROLES),
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  noLossController
);

export default settingRouter;
