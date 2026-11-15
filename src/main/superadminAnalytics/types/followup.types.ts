import type { AdminUser, ClinicLabel } from './metrics.types';

export const FOLLOWUP_TYPES = [
  'setup_stuck',
  'no_first_value',
  'usage_drop',
  'dormant',
  'churn_risk',
  'trial_ending',
  'payout_blocked',
] as const;
export type FollowupType = (typeof FOLLOWUP_TYPES)[number];

export const FOLLOWUP_PRIORITIES = ['high', 'medium', 'low'] as const;
export type FollowupPriority = (typeof FOLLOWUP_PRIORITIES)[number];

export const FOLLOWUP_STATUSES = ['open', 'snoozed', 'resolved'] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];

/** How a task ended; `auto_cleared` is written only by the rules. */
export const FOLLOWUP_OUTCOMES = [
  'recovered',
  'converted',
  'not_interested',
  'unreachable',
  'churned',
  'other',
  'auto_cleared',
] as const;
export type FollowupOutcome = (typeof FOLLOWUP_OUTCOMES)[number];

/** One problem the rules found today; counts only. */
export interface FollowupDetection {
  clinicId: string;
  type: FollowupType;
  priority: FollowupPriority;
  reason: string;
  triggerData: Record<string, number | string | null>;
}

export interface FollowupRunResult {
  detected: number;
  opened: number;
  refreshed: number;
  autoClosed: number;
  woken: number;
}

export interface FollowupTaskRow {
  id: string;
  clinic: ClinicLabel;
  type: FollowupType;
  priority: FollowupPriority;
  status: FollowupStatus;
  owner: AdminUser | null;
  reason: string;
  triggerData: Record<string, unknown> | null;
  snoozedUntil: string | null;
  lastContactedAt: string | null;
  openedAt: string;
  resolvedAt: string | null;
  outcome: string | null;
}

export interface FollowupListResponse {
  items: FollowupTaskRow[];
  total: number;
  pageNumber: number;
  pageSize: number;
  /** Over all tasks, ignoring filters, for the page's tabs and KPI tiles. */
  counts: {
    open: number;
    snoozed: number;
    resolved: number;
    highOpen: number;
    unassigned: number;
  };
  owners: AdminUser[];
}

export interface FollowupNoteRow {
  id: string;
  kind: string;
  body: string;
  author: AdminUser | null;
  createdAt: string;
}

export interface FollowupDetailResponse {
  task: FollowupTaskRow;
  notes: FollowupNoteRow[];
  /** Who an in-app message goes to; null if the clinic has no owner. */
  clinicOwner: AdminUser | null;
}
