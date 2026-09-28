/**
 * Dispatch — turns one event into the right notifications for the right people.
 *
 * Everything here runs in the queue worker, never on a request thread. That is
 * not only a latency decision: the legacy path called notifications from inside
 * a database transaction while writing through a different connection, so a
 * rollback could leave a notification for an appointment that never existed,
 * and a client refetching on the socket signal could read pre-commit state. A
 * job that runs in another process cannot be inside the caller's transaction.
 *
 * Resolution order for recipients is role -> staff scope -> permission:
 *
 *   1. the event's own rule says who is conceptually involved
 *   2. staff scope narrows that to the people responsible for this doctor
 *   3. the required permission removes anyone who could not act on it anyway
 *
 * Step 3 is what makes "do not notify users who cannot take action" literal
 * rather than a matter of judgement.
 */

import { UnrecoverableError } from 'bullmq';
import { sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import logger from '../../../utils/logger';
import { getUserNotificationPreferences } from '../preferences/notificationPreferences.utils';
import { envConfig } from '../../../utils/envConfig';
import { isLegacyInAppAllowed } from '../killswitch/killSwitch';
import { enqueueWhatsAppTemplate } from '../queues/whatsappOutbox.queue';
import { normalizeWhatsAppNumber } from '../utils/whatsappTemplate.utils';
import { NotificationsModel } from '../models/notifications.model';
import { getDirectoryPort, getEmitPort } from '../ports';
import { getEvent, resolveEventKey } from '../registry';
import { SnsNotificationService } from './sns.service';
import type {
  NotificationAudience,
  NotificationEventDefinition,
} from '../registry/types';

export interface NotifyJobData {
  eventKey: string;
  /** Everything the event's own rules and copy need. Serialised through Redis. */
  ctx: Record<string, unknown>;
}

/** The socket event every in-app notification is delivered under. */
export const NOTIFICATION_SOCKET_EVENT = 'notification.new';

export async function dispatch(
  data: NotifyJobData,
  jobId?: string
): Promise<void> {
  const key = resolveEventKey(data.eventKey);
  const event = key ? getEvent(key) : undefined;

  if (!key || !event) {
    // Retrying cannot help: the registry is code, not state. Fail the job once
    // and leave it in the failed set where it is visible.
    throw new UnrecoverableError(
      `[Notifications] Unknown event key "${data.eventKey}"`
    );
  }

  const directory = getDirectoryPort();

  // Enrichment first: recipients and copy both read from the finished context.
  // Caller-supplied values win, so a call site that already knows a name is
  // never overwritten by a lookup.
  let ctx = data.ctx as never;
  if (event.enrich) {
    try {
      const extra = await event.enrich(ctx, { directory });
      ctx = { ...(extra as object), ...(data.ctx as object) } as never;
    } catch (err) {
      // Degraded copy beats no notification: the fallbacks in each message
      // builder cover a missing name.
      logger.warn(
        `[Notifications] enrich failed for "${key}", continuing with raw context`,
        err
      );
    }
  }

  const tenant = event.tenant?.(ctx) ?? null;

  // First, so a failing bell insert (which retries the job) cannot hold it up;
  // the outbox jobId makes the retry's re-enqueue a no-op.
  await deliverWhatsApp(event, ctx, tenant, jobId);

  // Audiences are delivered independently: each has its own recipients, its own
  // wording, and its own permission rule. A patient reading about their own
  // appointment holds no clinic permission, so the staff filter must not reach
  // them.
  const seen = new Set<string>();

  for (const audience of event.audiences) {
    const resolved = await audience.recipients(ctx, { directory });

    let recipients = [...new Set(resolved.filter(Boolean))].filter(
      (id) => !seen.has(id)
    );

    if (audience.requiredPermission && tenant?.type === 'clinic') {
      const exempt = new Set(
        (audience.permissionExempt?.(ctx) ?? []).filter((id): id is string =>
          Boolean(id)
        )
      );
      const toCheck = recipients.filter((id) => !exempt.has(id));
      const allowed = await directory.filterByPermission(
        toCheck,
        tenant.id,
        audience.requiredPermission
      );
      recipients = recipients.filter(
        (id) => exempt.has(id) || allowed.includes(id)
      );
    }

    if (!recipients.length) continue;

    // Someone who lands in two audiences — a doctor who is also the patient at
    // their own clinic — is told once, by the first audience that claims them.
    recipients.forEach((id) => seen.add(id));

    await deliverInApp(key, event, audience, ctx, recipients, tenant);
  }
}

async function deliverInApp(
  key: string,
  event: NotificationEventDefinition<never>,
  audience: NotificationAudience<never>,
  ctx: never,
  recipients: string[],
  tenant: { type: 'clinic' | 'lab' | 'pharmacy'; id: string } | null
): Promise<void> {
  const build = audience.message.inApp;
  if (!build || !event.channels.includes('inApp')) return;

  const content = build(ctx);
  const click = (audience.clickAction ?? event.clickAction)(ctx);
  const collapseKey = event.collapseKey?.(ctx) ?? null;

  // Legacy key: stored preferences predate the rebuild, and a miss resolves to
  // "enabled", so the canonical key would silently un-mute everyone.
  const preferenceKey = event.aliases?.[0] ?? key;

  const prefMap = await getUserNotificationPreferences(
    recipients,
    preferenceKey
  );
  const prefs = recipients.map(
    (userId) => prefMap.get(userId) ?? { inApp: true, push: true }
  );

  // Activity ignores the toggle: muting must not erase history.
  // Activity never pushes. Push honours the kill switch though the insert below
  // does not — enabling the registry for a trial must not reach real phones.
  const pushTo =
    event.kind === 'activity' ||
    !event.channels.includes('push') ||
    !isLegacyInAppAllowed(key, preferenceKey)
      ? new Set<string>()
      : new Set(recipients.filter((_, i) => prefs[i].push));

  const rows = recipients
    .filter((_, i) => event.kind === 'activity' || prefs[i].inApp)
    .map((userId) => ({
      userId,
      type: key,
      eventKey: key,
      title: content.title,
      body: content.body,
      category: event.category,
      priority: event.priority,
      kind: event.kind,
      clickRoute: click.route,
      clickParams: click.params ?? null,
      collapseKey,
      tenantType: tenant?.type ?? null,
      tenantId: tenant?.id ?? null,
      data: null,
      metadata: null,
    }));

  if (!rows.length) return;

  // One statement for the fan-out; a collapse-key collision refreshes the unread
  // row instead of adding a second. The partial unique index makes it safe.
  const inserted = await database
    .insert(NotificationsModel)
    .values(rows)
    .onConflictDoUpdate({
      target: [NotificationsModel.userId, NotificationsModel.collapseKey],
      // Mirrors the partial unique index this upsert targets.
      targetWhere: sql`read = false AND collapse_key IS NOT NULL`,
      set: {
        // eventKey moves with the copy, or a collapsed row misreports itself.
        eventKey: key,
        type: key,
        title: content.title,
        body: content.body,
        category: event.category,
        priority: event.priority,
        kind: event.kind,
        clickRoute: click.route,
        clickParams: click.params ?? null,
        createdAt: new Date(),
      },
    })
    .returning({
      id: NotificationsModel.id,
      userId: NotificationsModel.userId,
    });

  const emitter = getEmitPort();
  for (const row of inserted) {
    try {
      emitter.emitToRoom(`user:${row.userId}`, NOTIFICATION_SOCKET_EVENT, {
        notificationId: row.id,
        eventKey: key,
        category: event.category,
        priority: event.priority,
        kind: event.kind,
        title: content.title,
        body: content.body,
        clickRoute: click.route,
        clickParams: click.params ?? null,
        ts: new Date().toISOString(),
      });
    } catch (err) {
      // Row is committed, so the client still sees it on next load.
      logger.warn(
        `[Notifications] socket emit failed for user=${row.userId}`,
        err
      );
    }
  }

  // Inline rather than a second queue job: this function is one, and a retry
  // would re-run the insert. Errors stay per-recipient for the same reason.
  const pushBuild = audience.message.push ?? build;
  const pushContent = pushBuild === build ? content : pushBuild(ctx);

  for (const row of inserted) {
    if (!pushTo.has(row.userId)) continue;

    SnsNotificationService.sendPushNotification(
      row.userId,
      pushContent.title,
      pushContent.body,
      {
        notificationId: row.id,
        eventKey: key,
        clickRoute: click.route,
        clickParams: click.params ?? null,
      }
    ).catch((err) => {
      logger.warn(
        `[Notifications] push delivery failed for user=${row.userId}: ${(err as Error).message}`
      );
    });
  }
}

/** Event-level patient WhatsApp. Ignores bell prefs: the bell toggle governs
 *  the bell, not the clinic's contact with a patient. */
async function deliverWhatsApp(
  event: NotificationEventDefinition<never>,
  ctx: never,
  tenant: { type: 'clinic' | 'lab' | 'pharmacy'; id: string } | null,
  jobId?: string
): Promise<void> {
  if (!event.whatsapp) return;

  const message = event.whatsapp.message(ctx);
  // Per-template switch: the legacy sender skips exactly the listed keys.
  if (!message || !envConfig.WHATSAPP_VIA_REGISTRY.has(message.key)) return;

  const directory = getDirectoryPort();

  // Clinic-level opt-out, matching the legacy senders. No tenant means no
  // clinic settings to consult, so nothing is sent.
  if (!envConfig.WHATSAPP_FORCE_ENABLED) {
    if (tenant?.type !== 'clinic') return;
    const settings = await directory.getClinicChannelSettings(tenant.id);
    if (!settings?.whatsappEnabled) return;
  }

  const recipients = [
    ...new Set(await event.whatsapp.recipients(ctx, { directory })),
  ].filter(Boolean);
  if (!recipients.length) return;

  const mobiles = await directory.getUserMobiles(recipients);
  const { appointmentId } = ctx as { appointmentId?: unknown };

  for (const userId of recipients) {
    const mobile = mobiles.get(userId);
    if (!mobile) continue;
    await enqueueWhatsAppTemplate(
      normalizeWhatsAppNumber(mobile),
      message,
      typeof appointmentId === 'string' ? appointmentId : undefined,
      // BullMQ rejects ':' in custom ids.
      jobId ? `wa-${jobId}-${userId}` : undefined
    );
  }
}
