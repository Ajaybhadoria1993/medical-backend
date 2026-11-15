import type { PaginationMeta } from '../../../utils/queryHelpers';

export interface TrackedAction {
  action: string;
  label: string;
  /** Params key (or body key, for routes that carry the id there) naming the record. */
  idParam?: string;
}

export interface AuditEntryInput {
  userId: string;
  /** Null for account routes that skip requireClinic; the service resolves it. */
  clinicId: string | null;
  action: string;
  entityId: string | null;
  ip: string | null;
}

export interface AuditLogItem {
  id: string;
  action: string;
  label: string;
  entityId: string | null;
  ip: string | null;
  createdAt: Date;
  userId: string;
  userName: string | null;
  userRole: string | null;
}

export interface AuditLogSummary {
  total: number;
  /** Count per action prefix (`appointment`, `queue`, …); absent prefixes are 0. */
  byType: Record<string, number>;
  topStaff: {
    userId: string;
    name: string | null;
    userRole: string | null;
    count: number;
  } | null;
  lastActivityAt: Date | null;
}

export interface AuditLogPage {
  items: AuditLogItem[];
  pagination: PaginationMeta;
  summary: AuditLogSummary;
}
