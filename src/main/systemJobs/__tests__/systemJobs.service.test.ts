import { database } from '../../../configurations/dbConnection';
import { SystemJobsService } from '../services/systemJobs.service';
import type { JobInfo } from '../types/systemJobs.types';

jest.mock('../../../configurations/dbConnection', () => ({
  database: { select: jest.fn(), selectDistinctOn: jest.fn() },
}));

// A query builder that resolves to `rows` however it is chained.
const rowsOf = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'groupBy']) q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(ok, ko);
  return q;
};

const now = new Date('2026-11-11T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);
const job = (key: string, over: Partial<JobInfo> = {}): JobInfo => ({
  key,
  label: key,
  purpose: '',
  when: '',
  enabled: true,
  maxGapHours: 26,
  ...over,
});
const run = (jobKey: string, status: 'ok' | 'failed', h: number) => ({
  job: jobKey,
  status,
  startedAt: hoursAgo(h),
  durationMs: 10,
  summary: status === 'ok' ? 'Done' : null,
  error: status === 'failed' ? 'boom' : null,
  triggeredBy: null,
});

/** Runs health() against the given runs; history began `historyHours` ago. */
const healthOf = async (
  jobs: JobInfo[],
  runs: ReturnType<typeof run>[],
  historyHours: number
) => {
  (database.selectDistinctOn as jest.Mock).mockReturnValueOnce(rowsOf(runs));
  (database.select as jest.Mock)
    .mockReturnValueOnce(rowsOf([{ at: hoursAgo(historyHours) }]))
    .mockReturnValueOnce(
      rowsOf(
        runs
          .filter((r) => r.status === 'failed')
          .map((r) => ({ job: r.job, n: 1 }))
      )
    );
  const out = await SystemJobsService.health(jobs, now);
  return Object.fromEntries(out.map((j) => [j.key, j.state]));
};

describe('SystemJobsService.health', () => {
  beforeEach(() => jest.resetAllMocks());

  it('names each job ok, failed, missed, off or not run yet', async () => {
    const states = await healthOf(
      [
        job('Fresh'), // ran 2 h ago
        job('Broke'), // ran fine, then failed
        job('Stale'), // last success 30 h ago
        job('Never'), // no run, history only 5 h old
        job('Minute', { maxGapHours: null }), // every-minute job, no failures
        job('Disabled', { enabled: false }),
      ],
      [
        run('Fresh', 'ok', 2),
        run('Broke', 'ok', 20),
        run('Broke', 'failed', 1),
        run('Stale', 'ok', 30),
      ],
      5
    );
    expect(states).toEqual({
      Fresh: 'ok',
      Broke: 'failed',
      Stale: 'missed',
      Never: 'waiting',
      Minute: 'ok',
      Disabled: 'off',
    });
  });

  it('calls a job missed once history is older than its gap and it never ran', async () => {
    const states = await healthOf([job('Never')], [], 30);
    expect(states).toEqual({ Never: 'missed' });
  });

  it('is ok again when a success follows a failure', async () => {
    const states = await healthOf(
      [job('Recovered')],
      [run('Recovered', 'failed', 3), run('Recovered', 'ok', 1)],
      48
    );
    expect(states).toEqual({ Recovered: 'ok' });
  });
});
