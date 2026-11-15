import express from 'express';

import {
  requireAuth,
  requireClinic,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import {
  checkFollowUpDateController,
  dismissFollowUpController,
  getFollowUpCallsController,
  getFollowUpsController,
  logFollowUpCallController,
} from '../../controllers/followUp.controller';
import {
  dismissFollowUpSchema,
  followUpCheckDateQuerySchema,
  followUpRefDocsSchema,
  followUpRefQuerySchema,
  getFollowUpsQuerySchema,
  logFollowUpCallSchema,
} from '../../schemas/followUp.schemas';

const followUpsRouter = express.Router();
const FOLLOW_UP_ROLES = ['Admin', 'Doctor', 'Receptionist'];

/** @route GET /api/v1/appointments/follow-ups/due — doctor follow-up dates and treatment-plan follow-ups due in a day range
 *  @access Admin (clinic-wide), Doctor (own patients), Receptionist (assigned doctors, via staff scope) */
followUpsRouter.get(
  '/due',
  requireAuth,
  requireRole(FOLLOW_UP_ROLES),
  requireClinic,
  validate(getFollowUpsQuerySchema, 'query'),
  getFollowUpsController
);

/** @route GET /api/v1/appointments/follow-ups/calls — call history of one follow-up row
 *  @access Admin, Doctor, Receptionist (same scope as /due; 404 outside it) */
followUpsRouter.get(
  '/calls',
  requireAuth,
  requireRole(FOLLOW_UP_ROLES),
  requireClinic,
  validate(followUpRefQuerySchema, 'query'),
  getFollowUpCallsController
);

/** @route POST /api/v1/appointments/follow-ups/calls — log a call (plan rows log on the plan)
 *  @access Admin, Doctor, Receptionist (same scope as /due; 404 outside it) */
followUpsRouter.post(
  '/calls',
  requireAuth,
  requireRole(FOLLOW_UP_ROLES),
  requireClinic,
  validate(logFollowUpCallSchema),
  logFollowUpCallController
);

/** @route POST /api/v1/appointments/follow-ups/dismiss — mark a follow-up done so it leaves the list
 *  @access Admin, Doctor, Receptionist (same scope as /due; 404 outside it) */
followUpsRouter.post(
  '/dismiss',
  requireAuth,
  requireRole(FOLLOW_UP_ROLES),
  requireClinic,
  validate(dismissFollowUpSchema),
  dismissFollowUpController
);

/** @route GET /api/v1/appointments/follow-ups/check-date — is a picked follow-up day good, and the next good day
 *  @access Admin (clinic-wide), Doctor (own days), Receptionist (assigned doctors); 404 outside scope */
followUpsRouter.get(
  '/check-date',
  requireAuth,
  requireRole(FOLLOW_UP_ROLES),
  requireClinic,
  validate(followUpCheckDateQuerySchema, 'query'),
  checkFollowUpDateController
);

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/follow-ups/check-date',
  description:
    'Checks one follow-up day (leave, off, past, inactive doctor, patient already booked) and suggests the next working day',
  query: followUpCheckDateQuerySchema,
  tags: ['appointments', 'follow-ups'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/follow-ups/due',
  description:
    'Follow-ups due between from and to (default: 30 days back to 30 days ahead), oldest first, with overdue/today/upcoming counts',
  query: getFollowUpsQuerySchema,
  tags: ['appointments', 'follow-ups'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/follow-ups/calls',
  description: 'Call history of one follow-up row, newest first',
  query: followUpRefDocsSchema,
  tags: ['appointments', 'follow-ups'],
});
docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/appointments/follow-ups/calls',
  description:
    'Log a follow-up call with an outcome and an optional call-again date',
  requestSchema: logFollowUpCallSchema,
  tags: ['appointments', 'follow-ups'],
});
docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/appointments/follow-ups/dismiss',
  description: 'Mark a follow-up done with a reason; it leaves the list',
  requestSchema: dismissFollowUpSchema,
  tags: ['appointments', 'follow-ups'],
});

export default followUpsRouter;
