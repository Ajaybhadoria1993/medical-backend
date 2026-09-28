import express from 'express';
import { requireAuth } from '../../../../middlewear/auth.middleware';
import { noLossController } from '../../controllers/setting.controller';
import { requireUserSubscription } from '../../../../middlewear/subscriptionAccess.middleware';

const settingRouter = express.Router();

settingRouter.post(
  '/no-loss',
  requireAuth,
  requireUserSubscription,
  noLossController
);

export default settingRouter;
