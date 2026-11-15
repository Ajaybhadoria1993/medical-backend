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
import {
  FEATURE_KEYS,
  requireFeature,
} from '../../../../middlewear/limitation.middleware';

const patientSubscriptionRouter = express.Router();

patientSubscriptionRouter.post(
  '/create-patient-subscription',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
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
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(getSubscriptionsQuerySchema, 'query'),
  getPatientSubscriptionsController
);

patientSubscriptionRouter.get(
  '/get-patient-subscription/:id',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
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
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(getSubscriptionsNotificationQuerySchema, 'query'),
  getPatientSubscriptionsNotificationController
);

patientSubscriptionRouter.post(
  '/mark-subscription-notification-read',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  markSubscriptionNotificationReadController
);

patientSubscriptionRouter.patch(
  '/update-delivery-date/:id',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(updateNextDeliveryDateSchema),
  updateNextDeliveryDateController
);

patientSubscriptionRouter.get(
  '/stats',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  getPatientSubscriptionStatsController
);

export default patientSubscriptionRouter;
