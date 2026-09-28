// src/main/feedback/routes/v1/feedback.route.ts
import express from 'express';

import {
  requireAdmin,
  requireAuth,
  requireClinic,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import {
  createFeedbackSchema,
  feedbackParamsSchema,
  respondFeedbackSchema,
  updateFeedbackSchema,
} from '../../schemas/feedback.schemas';
import {
  createFeedBackController,
  deleteFeedBackController,
  getAllClinicFeedBackController,
  getAllUserFeedBackController,
  getFeedBackByIdController,
  updateFeedBackController,
} from '../../controllers/feedback.controller';

const feedbackRouter = express.Router();

/**
 * @route POST /api/v1/feedback/
 * @desc Submit new feedback for the clinic
 * @access Private (Admin, Clinic)
 */
feedbackRouter.post(
  '/',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(createFeedbackSchema, 'body'),
  createFeedBackController
);

/**
 * @route PUT /api/v1/feedback/respond/:feedbackId
 * @desc Respond to a specific feedback entry
 * @access Private (Admin, Clinic)
 */
feedbackRouter.put(
  '/respond/:feedbackId',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(respondFeedbackSchema, 'body'),
  validate(feedbackParamsSchema, 'params'),
  updateFeedBackController
);

/**
 * @route PUT /api/v1/feedback/update-feedback/:feedbackId
 * @desc Update an existing feedback entry
 * @access Private (Admin, Clinic)
 */
feedbackRouter.put(
  '/update-feedback/:feedbackId',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(updateFeedbackSchema, 'body'),
  validate(feedbackParamsSchema, 'params'),
  updateFeedBackController
);

/**
 * @route DELETE /api/v1/feedback/delete/:feedbackId
 * @desc Delete a specific feedback entry
 * @access Private (Admin, Clinic)
 */
feedbackRouter.delete(
  '/delete/:feedbackId',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(feedbackParamsSchema, 'params'),
  deleteFeedBackController
);

/**
 * @route GET /api/v1/feedback/clinic/all
 * @desc Get all feedback entries for the current clinic
 * @access Private (Admin, Clinic)
 */
feedbackRouter.get(
  '/clinic/all',
  requireAuth,
  requireAdmin,
  requireClinic,
  getAllClinicFeedBackController
);

/**
 * @route GET /api/v1/feedback/user/all
 * @desc Get all feedback entries submitted by the current user
 * @access Private (Admin, Clinic)
 */
feedbackRouter.get(
  '/user/all',
  requireAuth,
  requireAdmin,
  requireClinic,
  getAllUserFeedBackController
);

/**
 * @route GET /api/v1/feedback/get-feedback/:feedbackId
 * @desc Get details of a specific feedback entry by ID
 * @access Private (Admin, Clinic)
 */
feedbackRouter.get(
  '/get-feedback/:feedbackId',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(feedbackParamsSchema, 'params'),
  getFeedBackByIdController
);

export default feedbackRouter;

// Register endpoints with schemas
docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/feedback',
  description: 'Create a feedback',
  requestSchema: createFeedbackSchema,
  tags: ['feedback'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/feedback/respond/:feedbackId',
  description: 'update a feedback',
  requestSchema: respondFeedbackSchema,
  params: feedbackParamsSchema,
  tags: ['feedback'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/feedback/update-feedback/:feedbackId',
  description: 'update a feedback',
  requestSchema: updateFeedbackSchema,
  params: feedbackParamsSchema,
  tags: ['feedback'],
});

docsRegistry.addEndpoint({
  method: 'delete',
  path: '/api/v1/feedback/:feedbackId',
  description: 'delete a feedback',
  params: feedbackParamsSchema,
  tags: ['feedback'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/feedback/clinic/all',
  description: 'get all clinic a feedback',
  tags: ['feedback'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/feedback/user/all',
  description: 'get all user a feedback',
  tags: ['feedback'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/feedback/get-feedback/:feedbackId',
  description: 'get by id  a feedback',
  params: feedbackParamsSchema,
  tags: ['feedback'],
});
