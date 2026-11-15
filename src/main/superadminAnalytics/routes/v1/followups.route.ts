import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import {
  actOnFollowupController,
  getFollowupController,
  listFollowupsController,
  runFollowupRulesController,
} from '../../controllers/followups.controller';
import {
  followupActionSchema,
  followupListQuerySchema,
  followupParamSchema,
} from '../../schemas/followups.schema';

// Mounted at /api/v1/superadmin-analytics/followups; cross-clinic, so Super Admin only.
const followupsRouter = express.Router();

followupsRouter.get(
  '/',
  requireAuth,
  requireSuperAdmin,
  validate(followupListQuerySchema, 'query'),
  listFollowupsController
);

// Same job the nightly cron runs, for "Refresh now" and for checking rules without waiting.
followupsRouter.post(
  '/run',
  requireAuth,
  requireSuperAdmin,
  runFollowupRulesController
);

followupsRouter.get(
  '/:taskId',
  requireAuth,
  requireSuperAdmin,
  validate(followupParamSchema, 'params'),
  getFollowupController
);

followupsRouter.patch(
  '/:taskId',
  requireAuth,
  requireSuperAdmin,
  validate(followupParamSchema, 'params'),
  validate(followupActionSchema, 'body'),
  actOnFollowupController
);

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/superadmin-analytics/followups',
  description:
    'Action Center queue: follow-up tasks by status/type/priority/owner, with counts and owners (Super_Admin)',
  query: followupListQuerySchema,
  tags: ['superadmin-analytics'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/superadmin-analytics/followups/run',
  description:
    'Run the follow-up rules now (the nightly job): opens, refreshes and auto-closes tasks (Super_Admin)',
  tags: ['superadmin-analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/superadmin-analytics/followups/{taskId}',
  description: 'One follow-up task with its full note history (Super_Admin)',
  params: followupParamSchema,
  tags: ['superadmin-analytics'],
});

docsRegistry.addEndpoint({
  method: 'patch',
  path: '/api/v1/superadmin-analytics/followups/{taskId}',
  description:
    'Act on a task: assign, note, contacted, snooze, resolve or reopen (Super_Admin)',
  params: followupParamSchema,
  requestSchema: followupActionSchema,
  tags: ['superadmin-analytics'],
});

export default followupsRouter;
