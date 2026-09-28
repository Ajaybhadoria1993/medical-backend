import { Router } from 'express';
import {
  requireAuth,
  requireClinic,
  requireDoctor,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../../../middlewear/validateZod';
import {
  answerCallController,
  cancelCallController,
  declineCallController,
  getActiveCallsController,
  placeCallController,
} from '../../controllers/calls.controller';
import {
  activeCallsQuerySchema,
  callIdParamsSchema,
  placeCallSchema,
} from '../../schemas/calls.schema';

/** Doctor→reception calls, mounted at /api/v1/calls. Clinic always comes from the token. */
const callsRouter = Router();
const requireReceptionistOnly = requireRole(['Receptionist']);

callsRouter.use(requireAuth, requireClinic);

// No role guard: the response only ever holds the caller's own calls.
callsRouter.get(
  '/active',
  validateQuery(activeCallsQuerySchema),
  getActiveCallsController
);
callsRouter.post(
  '/',
  requireDoctor,
  validateBody(placeCallSchema),
  placeCallController
);
callsRouter.post(
  '/:callId/answer',
  requireReceptionistOnly,
  validateParams(callIdParamsSchema),
  answerCallController
);
callsRouter.post(
  '/:callId/decline',
  requireReceptionistOnly,
  validateParams(callIdParamsSchema),
  declineCallController
);
callsRouter.post(
  '/:callId/cancel',
  requireDoctor,
  validateParams(callIdParamsSchema),
  cancelCallController
);

const callIdParam = {
  in: 'path',
  name: 'callId',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const actionResponses = {
  200: { description: 'Updated call' },
  404: { description: 'Call not found, or not addressed to you' },
  409: { description: 'Call already ended or answered by someone else' },
};

export const apiDocs = [
  {
    method: 'get',
    path: '/active',
    summary: 'Live calls for the current user',
    description:
      'Refetch when the "calls:{clinicId}" realtime section changes, on reconnect, ' +
      'and when a ringing call reaches expiresAt (it then reads as missed).',
    tags: ['Calls'],
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        in: 'query',
        name: 'withReceptionists',
        required: false,
        schema: { type: 'string', enum: ['true', 'false'] },
        description: 'Doctor only: include receptionists who can be rung now.',
      },
    ],
    responses: {
      200: { description: 'incoming, myCall, receptionists?, serverTime' },
    },
  },
  {
    method: 'post',
    path: '/',
    summary: 'Doctor places a call to reception',
    tags: ['Calls'],
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          example: { type: 'RECEPTION' },
        },
      },
    },
    responses: {
      201: { description: 'Call ringing' },
      409: { description: 'Already ringing, or no receptionist online' },
    },
  },
  {
    method: 'post',
    path: '/{callId}/answer',
    summary: 'Receptionist answers ("I\'m coming"); first answer wins',
    tags: ['Calls'],
    security: [{ bearerAuth: [] }],
    parameters: [callIdParam],
    responses: actionResponses,
  },
  {
    method: 'post',
    path: '/{callId}/decline',
    summary: 'Receptionist declines; busy once every recipient declined',
    tags: ['Calls'],
    security: [{ bearerAuth: [] }],
    parameters: [callIdParam],
    responses: actionResponses,
  },
  {
    method: 'post',
    path: '/{callId}/cancel',
    summary: 'Doctor cancels a ringing call',
    tags: ['Calls'],
    security: [{ bearerAuth: [] }],
    parameters: [callIdParam],
    responses: actionResponses,
  },
];

export default callsRouter;
