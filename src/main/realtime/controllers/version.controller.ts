import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { getValidatedQuery } from '../../../middlewear/validateZod';
import { sendOk } from '../../../utils/response.utils';
import { readVersion } from '../services/streamVersion.service';
import type { GetVersionsQuery } from '../schemas/realtime.schemas';

/**
 * GET /api/v1/realtime/versions?sections=a,b,c
 *
 * Returns the current realtime version of each requested section.
 *
 * This exists so a screen can learn the version of the state it is holding
 * without the snapshot endpoints themselves having to carry one. Feature
 * modules stay untouched: the queue, board and lab endpoints keep returning
 * exactly what they always returned, and versioning lives entirely here.
 *
 * The trade-off is one extra request on mount — the client fetches its
 * snapshot and its version in parallel. Every subsequent version comes from
 * the socket signal itself, so this endpoint is called on mount, on
 * reconnect, and never on the steady-state path.
 *
 * A section nothing has changed yet reports 0, which is a real version and
 * not an error — the client stores it and compares against it like any other.
 */
export const getVersionsController = asyncHandler(
  async (_req: Request, res: Response) => {
    // From validateQuery, not req.query: the raw query still holds the
    // comma-separated string, and Express 5 forbids overwriting it in place.
    const { sections } = getValidatedQuery<GetVersionsQuery>(res);

    const versions = await Promise.all(
      sections.map(async (section) => ({
        section,
        v: await readVersion(section),
      }))
    );

    return sendOk(res, 'Realtime versions fetched successfully', {
      versions,
      at: new Date().toISOString(),
    });
  }
);
