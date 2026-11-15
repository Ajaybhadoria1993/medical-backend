/** What the screen shows about a job; the cron registry supplies it. */
export interface JobInfo {
  key: string;
  label: string;
  /** What the job is for, in plain words. */
  purpose: string;
  /** When it runs, in words ("Daily at 00:05 IST"). */
  when: string;
  /** False when switched off by env on this server. */
  enabled: boolean;
  /** Hours without a success before it counts as missed; null for jobs that only record failures. */
  maxGapHours: number | null;
}

export interface RunRecord {
  job: string;
  status: 'ok' | 'failed';
  startedAt: Date;
  durationMs: number;
  summary?: string | null;
  error?: string | null;
  triggeredBy?: string | null;
}

export interface RunView {
  status: 'ok' | 'failed';
  startedAt: Date;
  durationMs: number;
  summary: string | null;
  error: string | null;
  triggeredBy: string | null;
}

export interface JobHealth extends JobInfo {
  lastRun: RunView | null;
  lastSuccessAt: Date | null;
  lastFailure: RunView | null;
  failedLast24h: number;
  /** waiting: no run recorded yet, and not yet overdue. */
  state: 'ok' | 'failed' | 'missed' | 'waiting' | 'off';
}
