import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { CRON_JOBS, isEnabled, jobInfos, runNow } from '../../../cron/registry';
import { SystemJobsService } from '../services/systemJobs.service';

/** GET /api/v1/system-jobs — every background job with its last run and health. */
export const getSystemJobs = asyncHandler(
  async (_req: Request, res: Response) =>
    sendOk(
      res,
      'System jobs fetched',
      await SystemJobsService.health(jobInfos())
    )
);

/** POST /api/v1/system-jobs/:key/run — run one job now; safe because every job is idempotent. */
export const runSystemJob = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user?.id) throw new HttpError(401, 'Sign in again to continue.');
    const job = CRON_JOBS.find((j) => j.key === req.validatedParams.key);
    if (!job) throw new HttpError(404, 'This job does not exist.');
    if (!isEnabled(job))
      throw new HttpError(400, 'This job is switched off on this server.');
    try {
      const summary = await runNow(job, req.user.id);
      if (summary === null) {
        throw new HttpError(
          409,
          `${job.label} is already running. Try again in a minute.`
        );
      }
      return sendOk(res, `${job.label} ran: ${summary}`, { summary });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // The run is recorded with its error for the screen; the caller gets a plain message.
      throw new HttpError(
        502,
        `${job.label} failed. The error is shown on the job.`
      );
    }
  }
);
