import express from 'express';
import { validate } from '../../../../middlewear/validation.middleware';
import { requireAuth } from '../../../../middlewear/auth.middleware';
import {
  createSubscriptionSchema,
  getSubscriptionByIdParamsSchema,
  getSubscriptionsNotificationQuerySchema,
  getSubscriptionsQuerySchema,
  updateNextDeliveryDateSchema,
  updateSubscriptionSchema,
} from '../../schemas/patientSubscription.schema';
import {
  createPatientSubscriptionController,
  getPatientSubscriptionByIdController,
  getPatientSubscriptionsController,
  getPatientSubscriptionsNotificationController,
  getPatientSubscriptionStatsController,
  getSubscriptionSalesController,
  markSubscriptionNotificationReadController,
  updateNextDeliveryDateController,
  updatePatientSubscriptionController,
} from '../../controllers/patientSubscription.controller';
import { requireUserSubscription } from '../../../../middlewear/subscriptionAccess.middleware';

const patientSubscriptionRouter = express.Router();

patientSubscriptionRouter.post(
  '/create-patient-subscription',
  requireAuth,
  requireUserSubscription,
  validate(createSubscriptionSchema, 'body'),
  createPatientSubscriptionController
);

patientSubscriptionRouter.put(
  '/update-patient-subscription/:id',
  requireAuth,
  validate(updateSubscriptionSchema, 'body'),
  updatePatientSubscriptionController
);

patientSubscriptionRouter.get(
  '/get-patient-subscriptions',
  requireAuth,
  requireUserSubscription,
  validate(getSubscriptionsQuerySchema, 'query'),
  getPatientSubscriptionsController
);

patientSubscriptionRouter.get(
  '/get-patient-subscription/:id',
  requireAuth,
  requireUserSubscription,
  validate(getSubscriptionByIdParamsSchema, 'params'),
  getPatientSubscriptionByIdController
);

patientSubscriptionRouter.get(
  '/get-subscription-sales/:subscriptionId',
  requireAuth,
  validate(getSubscriptionsNotificationQuerySchema, 'query'),
  getSubscriptionSalesController
);

patientSubscriptionRouter.get(
  '/get-patient-subscriptions-notification',
  requireAuth,
  requireUserSubscription,
  validate(getSubscriptionsNotificationQuerySchema, 'query'),
  getPatientSubscriptionsNotificationController
);

patientSubscriptionRouter.post(
  '/mark-subscription-notification-read',
  requireAuth,
  requireUserSubscription,
  markSubscriptionNotificationReadController
);

patientSubscriptionRouter.patch(
  '/update-delivery-date/:id',
  requireAuth,
  requireUserSubscription,
  validate(updateNextDeliveryDateSchema),
  updateNextDeliveryDateController
);

patientSubscriptionRouter.get(
  '/stats',
  requireAuth,
  requireUserSubscription,
  getPatientSubscriptionStatsController
);

export default patientSubscriptionRouter;
