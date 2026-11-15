import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { getISTDateString } from '../../../utils/istDateTime';
import logger from '../../../utils/logger';
import { notify } from '../../notifications/queues/notification.queue';
import {
  FollowupNoteModel,
  FollowupTaskModel,
  type FollowupTask,
} from '../models/followup.model';
import { getSourceDataPort } from '../ports';
import { storedNow } from '../utils/period.utils';
import type {
  FollowupActionDto,
  FollowupListQueryDto,
} from '../schemas/followups.schema';
import type {
  FollowupDetailResponse,
  FollowupListResponse,
  FollowupRunResult,
  FollowupTaskRow,
} from '../types/followup.types';
import type { AdminUser, ClinicLabel } from '../types/metrics.types';
import { detectFollowups } from '../utils/followupRules.utils';

const T = FollowupTaskModel;
const N = FollowupNoteModel;
const LIVE = ne(T.status, 'resolved');
/** A task the team closed stays closed this long, even if the problem is still there. */
export const FOLLOWUP_COOLDOWN_DAYS = 30;
const PRIORITY_RANK = sql`CASE ${T.priority} WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toRow(
  t: FollowupTask,
  labels: Map<string, ClinicLabel>,
  admins: Map<string, AdminUser>
): FollowupTaskRow {
  return {
    id: t.id,
    // A hard-deleted clinic has no label left; keep the row readable anyway.
    clinic: labels.get(t.clinicId) ?? {
      clinicId: t.clinicId,
      clinicCode: '—',
      name: 'Removed clinic',
    },
    type: t.type as FollowupTaskRow['type'],
    priority: t.priority as FollowupTaskRow['priority'],
    status: t.status as FollowupTaskRow['status'],
    owner: t.ownerAdminId ? (admins.get(t.ownerAdminId) ?? null) : null,
    reason: t.reason,
    triggerData: (t.triggerData as Record<string, unknown> | null) ?? null,
    snoozedUntil: iso(t.snoozedUntil),
    lastContactedAt: iso(t.lastContactedAt),
    openedAt: t.openedAt.toISOString(),
    resolvedAt: iso(t.resolvedAt),
    outcome: t.outcome,
  };
}

async function lookups(clinicIds: string[]) {
  const port = getSourceDataPort();
  const [labels, admins] = await Promise.all([
    port.getClinicLabels([...new Set(clinicIds)]),
    port.getSuperAdmins(),
  ]);
  return {
    labels: new Map(labels.map((l) => [l.clinicId, l])),
    admins: new Map(admins.map((a) => [a.id, a])),
    adminList: admins,
  };
}

export class FollowupsService {
  /** Nightly sync: open new problems, refresh live ones, close cleared ones, wake snoozes. Idempotent. */
  static async runRules(): Promise<FollowupRunResult> {
    const port = getSourceDataPort();
    const [facts, spans] = await Promise.all([
      port.getClinicFacts(getISTDateString()),
      port.getSubscriptionSpans(),
    ]);
    const now = new Date();
    const detections = detectFollowups(facts, spans, storedNow());

    const result = await database.transaction(async (tx) => {
      const r: FollowupRunResult = {
        detected: detections.length,
        opened: 0,
        refreshed: 0,
        autoClosed: 0,
        woken: 0,
      };

      const woken = await tx
        .update(T)
        .set({ status: 'open', snoozedUntil: null, updatedAt: now })
        .where(and(eq(T.status, 'snoozed'), lte(T.snoozedUntil, now)))
        .returning({ id: T.id });
      r.woken = woken.length;
      if (woken.length)
        await tx.insert(N).values(
          woken.map((w) => ({
            taskId: w.id,
            kind: 'auto',
            body: 'Snooze ended, back in the queue',
          }))
        );

      const live = await tx.select().from(T).where(LIVE);
      // Closed by a person recently: respect that decision instead of reopening every night.
      const cooldownStart = new Date(
        now.getTime() - FOLLOWUP_COOLDOWN_DAYS * 86_400_000
      );
      const recentlyClosed = await tx
        .select({ clinicId: T.clinicId, type: T.type })
        .from(T)
        .where(
          and(
            eq(T.status, 'resolved'),
            isNotNull(T.resolvedBy),
            gte(T.resolvedAt, cooldownStart)
          )
        );
      const coolingDown = new Set(
        recentlyClosed.map((t) => `${t.clinicId}|${t.type}`)
      );
      const byKey = new Map(live.map((t) => [`${t.clinicId}|${t.type}`, t]));
      const seen = new Set<string>();

      for (const det of detections) {
        const key = `${det.clinicId}|${det.type}`;
        seen.add(key);
        const existing = byKey.get(key);
        if (!existing && coolingDown.has(key)) continue;
        if (existing) {
          await tx
            .update(T)
            .set({
              reason: det.reason,
              priority: det.priority,
              triggerData: det.triggerData,
              updatedAt: now,
            })
            .where(eq(T.id, existing.id));
          r.refreshed++;
          continue;
        }
        // DoNothing covers a manual run racing the cron on the live-task unique index.
        const [created] = await tx
          .insert(T)
          .values({
            clinicId: det.clinicId,
            type: det.type,
            priority: det.priority,
            reason: det.reason,
            triggerData: det.triggerData,
          })
          .onConflictDoNothing()
          .returning({ id: T.id });
        if (created) {
          await tx.insert(N).values({
            taskId: created.id,
            kind: 'auto',
            body: `Opened: ${det.reason}`,
          });
          r.opened++;
        }
      }

      const cleared = live.filter((t) => !seen.has(`${t.clinicId}|${t.type}`));
      for (const t of cleared) {
        await tx
          .update(T)
          .set({
            status: 'resolved',
            resolvedAt: now,
            resolvedBy: null,
            outcome: 'auto_cleared',
            updatedAt: now,
          })
          .where(eq(T.id, t.id));
        await tx.insert(N).values({
          taskId: t.id,
          kind: 'auto',
          body: 'Closed automatically: the problem cleared',
        });
      }
      r.autoClosed = cleared.length;
      return r;
    });

    logger.info(
      `[Followups] detected=${result.detected} opened=${result.opened} refreshed=${result.refreshed} autoClosed=${result.autoClosed} woken=${result.woken}`
    );
    return result;
  }

  /** Open tasks per problem, for the Overview card; the same rows the Action Center lists. */
  static async openCounts() {
    const rows = await database
      .select({
        type: T.type,
        priority: T.priority,
        n: sql<number>`COUNT(*)::int`,
      })
      .from(T)
      .where(eq(T.status, 'open'))
      .groupBy(T.type, T.priority);
    const sum = (test: (r: (typeof rows)[number]) => boolean) =>
      rows.filter(test).reduce((s, r) => s + Number(r.n), 0);
    return {
      paidDormant: sum((r) => r.type === 'dormant' && r.priority === 'high'),
      declining: sum((r) => r.type === 'usage_drop'),
      setupStuck: sum((r) => r.type === 'setup_stuck'),
      noFirstValue: sum((r) => r.type === 'no_first_value'),
      payoutBlocked: sum((r) => r.type === 'payout_blocked'),
    };
  }

  static async list(
    q: FollowupListQueryDto,
    userId: string
  ): Promise<FollowupListResponse> {
    const where: SQL[] = [eq(T.status, q.status)];
    if (q.type) where.push(eq(T.type, q.type));
    if (q.priority) where.push(eq(T.priority, q.priority));
    if (q.clinicId) where.push(eq(T.clinicId, q.clinicId));
    if (q.owner === 'me') where.push(eq(T.ownerAdminId, userId));
    else if (q.owner === 'unassigned') where.push(isNull(T.ownerAdminId));
    else if (q.owner) where.push(eq(T.ownerAdminId, q.owner));

    const [rows, [{ total }], countRows] = await Promise.all([
      database
        .select()
        .from(T)
        .where(and(...where))
        .orderBy(PRIORITY_RANK, desc(T.openedAt))
        .limit(q.pageSize)
        .offset((q.pageNumber - 1) * q.pageSize),
      database
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(T)
        .where(and(...where)),
      database
        .select({
          open: sql<number>`COUNT(*) FILTER (WHERE ${T.status} = 'open')::int`,
          snoozed: sql<number>`COUNT(*) FILTER (WHERE ${T.status} = 'snoozed')::int`,
          resolved: sql<number>`COUNT(*) FILTER (WHERE ${T.status} = 'resolved')::int`,
          highOpen: sql<number>`COUNT(*) FILTER (WHERE ${T.status} = 'open' AND ${T.priority} = 'high')::int`,
          unassigned: sql<number>`COUNT(*) FILTER (WHERE ${T.status} = 'open' AND ${T.ownerAdminId} IS NULL)::int`,
        })
        .from(T),
    ]);

    const { labels, admins, adminList } = await lookups(
      rows.map((r) => r.clinicId)
    );
    return {
      items: rows.map((t) => toRow(t, labels, admins)),
      total: Number(total),
      pageNumber: q.pageNumber,
      pageSize: q.pageSize,
      counts: countRows[0],
      owners: adminList,
    };
  }

  static async detail(taskId: string): Promise<FollowupDetailResponse> {
    const [task] = await database
      .select()
      .from(T)
      .where(eq(T.id, taskId))
      .limit(1);
    if (!task) throw new HttpError(404, 'Follow-up task not found');
    const notes = await database
      .select()
      .from(N)
      .where(eq(N.taskId, taskId))
      .orderBy(asc(N.createdAt));
    const [{ labels, admins }, clinicOwner] = await Promise.all([
      lookups([task.clinicId]),
      getSourceDataPort().getClinicOwner(task.clinicId),
    ]);
    return {
      clinicOwner,
      task: toRow(task, labels, admins),
      notes: notes.map((n) => ({
        id: n.id,
        kind: n.kind,
        body: n.body,
        author: n.authorId ? (admins.get(n.authorId) ?? null) : null,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  }

  /** One team action on a task; the change and its history note commit together. */
  static async act(
    taskId: string,
    userId: string,
    a: FollowupActionDto
  ): Promise<FollowupDetailResponse> {
    const [task] = await database
      .select()
      .from(T)
      .where(eq(T.id, taskId))
      .limit(1);
    if (!task) throw new HttpError(404, 'Follow-up task not found');
    const resolved = task.status === 'resolved';
    if (resolved && a.action !== 'reopen' && a.action !== 'note')
      throw new HttpError(409, 'This task is resolved. Reopen it first.');

    const clinicOwner =
      a.action === 'message'
        ? await getSourceDataPort().getClinicOwner(task.clinicId)
        : null;
    if (a.action === 'message' && !clinicOwner)
      throw new HttpError(404, 'This clinic has no owner to message');

    const now = new Date();
    let patch: Partial<FollowupTask> = {};
    let note: { kind: string; body: string };

    switch (a.action) {
      case 'assign': {
        const admins = await getSourceDataPort().getSuperAdmins();
        const owner = a.ownerAdminId
          ? admins.find((x) => x.id === a.ownerAdminId)
          : null;
        if (a.ownerAdminId && !owner)
          throw new HttpError(400, 'Owner must be a Super Admin user');
        patch = { ownerAdminId: a.ownerAdminId };
        note = {
          kind: 'assigned',
          body: owner ? `Assigned to ${owner.name}` : 'Unassigned',
        };
        break;
      }
      case 'note':
        note = { kind: 'note', body: a.body };
        break;
      case 'contacted':
        // Whoever calls an unowned clinic takes the task.
        patch = {
          lastContactedAt: now,
          ownerAdminId: task.ownerAdminId ?? userId,
        };
        note = { kind: 'contacted', body: a.body || 'Clinic contacted' };
        break;
      case 'snooze': {
        const until = new Date(`${a.until}T00:00:00.000+05:30`);
        if (until <= now)
          throw new HttpError(400, 'Snooze until a future date');
        patch = { status: 'snoozed', snoozedUntil: until };
        note = {
          kind: 'status_change',
          body: `Snoozed until ${a.until}${a.body ? ` · ${a.body}` : ''}`,
        };
        break;
      }
      case 'resolve':
        patch = {
          status: 'resolved',
          resolvedAt: now,
          resolvedBy: userId,
          outcome: a.outcome,
          snoozedUntil: null,
        };
        note = {
          kind: 'status_change',
          body: `Resolved (${a.outcome.replace('_', ' ')})${a.body ? ` · ${a.body}` : ''}`,
        };
        break;
      case 'message':
        // Messaging a clinic counts as contacting it; whoever sends takes an unowned task.
        patch = {
          lastContactedAt: now,
          ownerAdminId: task.ownerAdminId ?? userId,
        };
        note = {
          kind: 'message',
          body: `Sent in app to ${clinicOwner?.name ?? 'clinic owner'}: ${a.title} · ${a.body}`,
        };
        break;
      case 'reopen':
        if (!resolved) throw new HttpError(409, 'This task is already open');
        patch = {
          status: 'open',
          resolvedAt: null,
          resolvedBy: null,
          outcome: null,
          snoozedUntil: null,
        };
        note = { kind: 'status_change', body: 'Reopened' };
        break;
    }

    try {
      await database.transaction(async (tx) => {
        await tx
          .update(T)
          .set({ ...patch, updatedAt: now })
          .where(eq(T.id, taskId));
        await tx.insert(N).values({ taskId, authorId: userId, ...note });
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505')
        throw new HttpError(
          409,
          'The rules already opened a newer task for this problem.'
        );
      throw err;
    }
    // After commit, never inside the transaction (BE §7); notify() logs its own failures.
    if (a.action === 'message' && clinicOwner)
      await notify('platform.message', {
        clinicId: task.clinicId,
        ownerUserId: clinicOwner.id,
        title: a.title,
        body: a.body,
      });
    return FollowupsService.detail(taskId);
  }
}
