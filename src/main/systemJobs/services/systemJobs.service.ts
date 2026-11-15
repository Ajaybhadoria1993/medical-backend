import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import logger from '../../../utils/logger';
import { CronRunModel as R } from '../models/cronRun.model';
import type { JobHealth, JobInfo, RunRecord } from '../types/systemJobs.types';

const HOUR_MS = 60 * 60 * 1000;
const KEEP_DAYS = 30;

export class SystemJobsService {
  /** Saves one run; never throws, so a recording problem cannot fail the job itself. */
  static async record(run: RunRecord): Promise<void> {
    try {
      await database.insert(R).values({
        ...run,
        summary: run.summary?.slice(0, 255) ?? null,
        error: run.error?.slice(0, 2000) ?? null,
      });
    } catch (err) {
      logger.error(`[SystemJobs] Could not record a run of ${run.job}:`, err);
    }
  }

  /** Each job with its latest run, latest failure and whether a due run is missing. */
  static async health(jobs: JobInfo[], now = new Date()): Promise<JobHealth[]> {
    const since = new Date(now.getTime() - KEEP_DAYS * 24 * HOUR_MS);
    // Latest run and latest failure per job, from the job+started index.
    const rows = await database
      .selectDistinctOn([R.job, R.status], {
        job: R.job,
        status: R.status,
        startedAt: R.startedAt,
        durationMs: R.durationMs,
        summary: R.summary,
        error: R.error,
        triggeredBy: R.triggeredBy,
      })
      .from(R)
      .where(gte(R.startedAt, since))
      .orderBy(R.job, R.status, desc(R.startedAt));
    // History starts when recording began (deploy): before a job's gap has passed, no run is not "missed".
    const [first] = await database
      .select({ at: sql<Date | null>`min(${R.startedAt})` })
      .from(R);
    const historyFrom = first?.at ? new Date(first.at) : now;
    const failedCounts = await database
      .select({ job: R.job, n: sql<number>`count(*)::int` })
      .from(R)
      .where(
        and(
          eq(R.status, 'failed'),
          gte(R.startedAt, new Date(now.getTime() - 24 * HOUR_MS))
        )
      )
      .groupBy(R.job);

    return jobs.map((job) => {
      const ok =
        rows.find((r) => r.job === job.key && r.status === 'ok') ?? null;
      const failed =
        rows.find((r) => r.job === job.key && r.status === 'failed') ?? null;
      const last =
        [ok, failed]
          .filter((r) => r !== null)
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0] ??
        null;
      // Only jobs that record successes can be "missed"; every-minute jobs record failures only.
      const gapMs = job.maxGapHours === null ? null : job.maxGapHours * HOUR_MS;
      const from = ok?.startedAt ?? historyFrom;
      const missed =
        job.enabled && gapMs !== null && now.getTime() - from.getTime() > gapMs;
      return {
        ...job,
        lastRun: last,
        lastSuccessAt: ok?.startedAt ?? null,
        lastFailure: failed,
        failedLast24h: failedCounts.find((f) => f.job === job.key)?.n ?? 0,
        state: !job.enabled
          ? 'off'
          : last?.status === 'failed'
            ? 'failed'
            : missed
              ? 'missed'
              : !last && job.maxGapHours !== null
                ? 'waiting'
                : 'ok',
      };
    });
  }

  /** Deletes runs older than 30 days; returns how many went. */
  static async purgeOld(now = new Date()): Promise<number> {
    const gone = await database
      .delete(R)
      .where(
        lt(R.startedAt, new Date(now.getTime() - KEEP_DAYS * 24 * HOUR_MS))
      )
      .returning({ id: R.id });
    return gone.length;
  }
}
