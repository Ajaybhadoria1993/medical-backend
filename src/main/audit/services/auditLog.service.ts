import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  like,
  lt,
  max,
  sql,
  type SQL,
} from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { startOfDayIST } from '../../../utils/istDateTime';
import logger from '../../../utils/logger';
import {
  buildPaginationMeta,
  getOffsetPagination,
} from '../../../utils/queryHelpers';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import { PharmacyAssignModel } from '../../pharmacy/models/pharmacy.model';
import { UserModel } from '../../users/models/user.model';
import { AuditLogModel } from '../models/auditLog.model';
import {
  AUDIT_ACTION_TYPES,
  type AuditLogQueryDto,
} from '../schemas/auditLog.schema';
import type {
  AuditEntryInput,
  AuditLogPage,
  AuditLogSummary,
} from '../types/auditLog.types';
import { auditActionLabel } from '../utils/trackedActions.utils';

const RETENTION_DAYS = Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? 90);
/** Guard against a mistyped env var quietly deleting everything. */
const MIN_RETENTION_DAYS = 7;
const PURGE_BATCH_SIZE = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Writes go out in one insert every FLUSH_MS, or sooner once this many are waiting. */
const FLUSH_MS = 10_000;
const FLUSH_AT = 200;
/** Memory cap while the DB is unreachable; beyond it the oldest entries are dropped. */
const MAX_QUEUED = 5_000;

type QueuedEntry = AuditEntryInput & { createdAt: Date };

export class AuditLogService {
  private static queue: QueuedEntry[] = [];
  private static timer: NodeJS.Timeout | null = null;
  private static flushing: Promise<void> | null = null;

  /** Queues the entry; it is written with others in one insert. Time is taken now, not at flush. */
  static async record(entry: AuditEntryInput): Promise<void> {
    this.queue.push({ ...entry, createdAt: new Date() });
    if (this.queue.length > MAX_QUEUED) {
      const dropped = this.queue.splice(0, this.queue.length - MAX_QUEUED);
      logger.warn(
        `[AuditLog] Queue full, dropped ${dropped.length} oldest entries`
      );
    }
    if (this.queue.length >= FLUSH_AT) void this.flush();
    else this.timer ??= setTimeout(() => void this.flush(), FLUSH_MS);
  }

  /** Writes everything queued. Safe to call any time (shutdown awaits it); never throws. */
  static async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.flushing) await this.flushing;
    if (!this.queue.length) return;

    const batch = this.queue.splice(0);
    this.flushing = this.write(batch)
      .catch((error) => {
        logger.warn(`[AuditLog] Failed to save ${batch.length} entries`, error);
      })
      .finally(() => {
        this.flushing = null;
      });
    await this.flushing;
  }

  /** Users outside any clinic (Super_Admin, patients) resolve to no clinic and are skipped. */
  private static async write(batch: QueuedEntry[]): Promise<void> {
    const missing = [
      ...new Set(batch.filter((e) => !e.clinicId).map((e) => e.userId)),
    ];
    const clinicOf = missing.length
      ? await this.findClinicIds(missing)
      : new Map<string, string>();
    const rows = batch
      .map((e) => ({
        ...e,
        clinicId: e.clinicId ?? clinicOf.get(e.userId) ?? null,
      }))
      .filter(
        (e): e is QueuedEntry & { clinicId: string } => e.clinicId !== null
      );
    if (rows.length) await database.insert(AuditLogModel).values(rows);
  }

  static async listForClinic(
    clinicId: string,
    query: AuditLogQueryDto
  ): Promise<AuditLogPage> {
    const { limit, offset, pageSize, pageNumber } = getOffsetPagination(
      query,
      100
    );

    const where = and(
      this.buildWhere(clinicId, query),
      query.type ? like(AuditLogModel.action, `${query.type}.%`) : undefined
    );

    const [rows, summary] = await Promise.all([
      database
        .select({
          id: AuditLogModel.id,
          action: AuditLogModel.action,
          entityId: AuditLogModel.entityId,
          ip: AuditLogModel.ip,
          createdAt: AuditLogModel.createdAt,
          userId: AuditLogModel.userId,
          userName: UserModel.name,
          userRole: UserModel.userType,
        })
        .from(AuditLogModel)
        .leftJoin(UserModel, eq(UserModel.id, AuditLogModel.userId))
        .where(where)
        .orderBy(desc(AuditLogModel.createdAt))
        .limit(limit)
        .offset(offset),
      this.summarize(this.buildWhere(clinicId, query)),
    ]);
    // The per-type counts already hold this page set's size; no separate COUNT query.
    const total = query.type ? summary.byType[query.type] : summary.total;

    return {
      items: rows.map((row) => ({
        ...row,
        label: auditActionLabel(row.action),
      })),
      pagination: buildPaginationMeta(total, pageNumber, pageSize),
      summary,
    };
  }

  /** Same staff/date filters as the list but never the type, so the chips count every kind. */
  private static async summarize(
    where: SQL | undefined
  ): Promise<AuditLogSummary> {
    const prefix = sql<string>`split_part(${AuditLogModel.action}, '.', 1)`;

    // One grouped scan gives every count and the latest time; only the top-staff ranking needs its own.
    const [typeRows, [top]] = await Promise.all([
      database
        .select({
          type: prefix,
          total: count(),
          latest: max(AuditLogModel.createdAt),
        })
        .from(AuditLogModel)
        .where(where)
        .groupBy(prefix),
      database
        .select({
          userId: AuditLogModel.userId,
          name: UserModel.name,
          userRole: UserModel.userType,
          count: count(),
        })
        .from(AuditLogModel)
        .leftJoin(UserModel, eq(UserModel.id, AuditLogModel.userId))
        .where(where)
        .groupBy(AuditLogModel.userId, UserModel.name, UserModel.userType)
        .orderBy(desc(count()))
        .limit(1),
    ]);

    const byType = Object.fromEntries(
      AUDIT_ACTION_TYPES.map((type) => [type, 0])
    ) as Record<string, number>;
    for (const row of typeRows) byType[row.type] = row.total;

    return {
      total: typeRows.reduce((sum, row) => sum + row.total, 0),
      byType,
      topStaff: top ?? null,
      lastActivityAt: typeRows.reduce<Date | null>(
        (last, row) =>
          row.latest && (!last || row.latest > last) ? row.latest : last,
        null
      ),
    };
  }

  private static buildWhere(clinicId: string, query: AuditLogQueryDto) {
    return and(
      eq(AuditLogModel.clinicId, clinicId),
      query.userId ? eq(AuditLogModel.userId, query.userId) : undefined,
      gte(AuditLogModel.createdAt, startOfDayIST(query.from)),
      lt(
        AuditLogModel.createdAt,
        new Date(startOfDayIST(query.to).getTime() + DAY_MS)
      )
    );
  }

  /** Deletes in batches so one run never holds locks across the whole table. */
  static async purgeExpired(): Promise<number> {
    const days = Math.max(RETENTION_DAYS, MIN_RETENTION_DAYS);
    const cutoff = new Date(Date.now() - days * DAY_MS);
    let removed = 0;

    for (;;) {
      const batch = await database
        .select({ id: AuditLogModel.id })
        .from(AuditLogModel)
        .where(lt(AuditLogModel.createdAt, cutoff))
        .limit(PURGE_BATCH_SIZE);

      if (!batch.length) break;

      await database.delete(AuditLogModel).where(
        inArray(
          AuditLogModel.id,
          batch.map((row) => row.id)
        )
      );

      removed += batch.length;
      if (batch.length < PURGE_BATCH_SIZE) break;
    }

    return removed;
  }

  /** Same first-assignment rule as requireClinic, for a whole batch in at most two queries. */
  private static async findClinicIds(
    userIds: string[]
  ): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    const staff = await database
      .selectDistinctOn([ClinicAssignModel.userId], {
        userId: ClinicAssignModel.userId,
        clinicId: ClinicAssignModel.clinicId,
      })
      .from(ClinicAssignModel)
      .where(inArray(ClinicAssignModel.userId, userIds))
      .orderBy(ClinicAssignModel.userId, asc(ClinicAssignModel.createdAt));
    staff.forEach((r) => found.set(r.userId, r.clinicId));

    const rest = userIds.filter((id) => !found.has(id));
    if (!rest.length) return found;
    const pharmacists = await database
      .selectDistinctOn([PharmacyAssignModel.userId], {
        userId: PharmacyAssignModel.userId,
        clinicId: PharmacyAssignModel.clinicId,
      })
      .from(PharmacyAssignModel)
      .where(inArray(PharmacyAssignModel.userId, rest))
      .orderBy(PharmacyAssignModel.userId, asc(PharmacyAssignModel.createdAt));
    pharmacists.forEach((r) => r.clinicId && found.set(r.userId, r.clinicId));
    return found;
  }
}
