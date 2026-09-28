import { Router } from 'express';
import { requireAuth } from '../../../../middlewear/auth.middleware';
import { validateQuery } from '../../../../middlewear/validateZod';
import { getVersionsController } from '../../controllers/version.controller';
import { getVersionsQuerySchema } from '../../schemas/realtime.schemas';

/**
 * Realtime versions API.
 *
 * Auto-discovered by loadRoutes and mounted at /api/v1/realtime.
 *
 * Deliberately the only HTTP surface the realtime system adds. Snapshot data
 * keeps coming from each feature's own endpoint; this module contributes the
 * version a client compares socket signals against, and nothing else.
 */
const realtimeRouter = Router();

/**
 * @route GET /api/v1/realtime/versions
 * @desc Current realtime version for one or more sections
 * @query sections — comma-separated section ids, max 20
 * @access Private (Auth)
 */
realtimeRouter.get(
  '/versions',
  requireAuth,
  validateQuery(getVersionsQuerySchema),
  getVersionsController
);

export const apiDocs = [
  {
    method: 'get',
    path: '/versions',
    summary: 'Get realtime section versions',
    description:
      'Returns the current version of each requested section. A client ' +
      'compares these against the version carried by the ' +
      '"realtime.section.changed" socket signal to decide whether the data ' +
      'it holds is still current. Called on mount and on reconnect, not on ' +
      'the steady-state path.',
    tags: ['Realtime'],
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        in: 'query',
        name: 'sections',
        required: true,
        schema: { type: 'string' },
        example: 'queue:clinic-7:doctor-3:2026-08-21,board:clinic-7',
        description: 'Comma-separated section ids (max 20).',
      },
    ],
    responses: {
      200: {
        description: 'Versions fetched successfully',
        content: {
          'application/json': {
            example: {
              success: true,
              message: 'Realtime versions fetched successfully',
              data: {
                versions: [
                  { section: 'queue:clinic-7:doctor-3:2026-08-21', v: 42 },
                  { section: 'board:clinic-7', v: 17 },
                ],
                at: '2026-08-21T10:22:31.000Z',
              },
            },
          },
        },
      },
      400: { description: 'Invalid or missing sections query parameter' },
      401: { description: 'Unauthorized' },
    },
  },
];

export default realtimeRouter;
