import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { InferSelectModel } from 'drizzle-orm';

export const cronRunStatusEnum = pgEnum('cron_run_status', ['ok', 'failed']);

const tz = { withTimezone: true } as const;

/** One background job run, for the Super Admin System jobs screen; kept 30 days. */
export const CronRunModel = pgTable(
  'cron_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Registry key, e.g. "PeriodEnd". */
    job: varchar('job', { length: 80 }).notNull(),
    status: cronRunStatusEnum('status').notNull(),
    startedAt: timestamp('started_at', tz).notNull(),
    durationMs: integer('duration_ms').notNull(),
    /** What the run did, in plain words ("2 plans ended"). */
    summary: varchar('summary', { length: 255 }),
    error: text('error'),
    /** The Super Admin who pressed "Run now"; null for a scheduled run. */
    triggeredBy: uuid('triggered_by'),
  },
  (t) => [index('cron_runs_job_started_idx').on(t.job, t.startedAt)]
);

export type CronRun = InferSelectModel<typeof CronRunModel>;
