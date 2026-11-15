import { desc, eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { FollowupNoteModel, FollowupTaskModel } from '../models/followup.model';
import { getSourceDataPort } from '../ports';
import type { SubscriptionSpan } from '../types/metrics.types';
import type {
  ClinicTimelineItem,
  ClinicTimelineResponse,
} from '../types/responses.types';

/** Enough history for a support call; the page shows it 10 at a time. */
const START_TYPES = new Set([
  'subscription_created',
  'free_trial_started',
  'plan_upgraded',
  'plan_downgraded',
]);

// Spans are on the IST clock (see the adapter); shift back to a real instant for display.
const realInstant = (d: Date) => new Date(d.getTime() - 330 * 60 * 1000);

const billingNote = (sp: SubscriptionSpan) =>
  sp.isTrial
    ? 'Free trial'
    : sp.isPaid && sp.monthlyValue > 0
      ? `Paid · ₹${Math.round(sp.monthlyValue)}/month`
      : sp.isPaid && !sp.isFreePlan
        ? 'Paid · ₹0 (coupon)'
        : 'Free plan';

const planItem = (
  id: string,
  at: Date,
  kind: string,
  title: string,
  detail: string | null
): ClinicTimelineItem => ({
  id,
  at: at.toISOString(),
  source: 'subscription',
  kind,
  title,
  detail,
  amount: null,
  actor: null,
  taskType: null,
});

const TIMELINE_LIMIT = 100;
const STAFF_ACTIVITY_DAYS = 7;

export class TimelineService {
  /** Subscription events and Action Center history for one clinic, newest first. */
  static async forClinic(clinicId: string): Promise<ClinicTimelineResponse> {
    const port = getSourceDataPort();
    const [subscription, spans, notes, admins, staff] = await Promise.all([
      port.getSubscriptionEvents(clinicId, TIMELINE_LIMIT),
      port.getSubscriptionSpans(),
      database
        .select({
          id: FollowupNoteModel.id,
          kind: FollowupNoteModel.kind,
          body: FollowupNoteModel.body,
          authorId: FollowupNoteModel.authorId,
          at: FollowupNoteModel.createdAt,
          taskType: FollowupTaskModel.type,
        })
        .from(FollowupNoteModel)
        .innerJoin(
          FollowupTaskModel,
          eq(FollowupTaskModel.id, FollowupNoteModel.taskId)
        )
        .where(eq(FollowupTaskModel.clinicId, clinicId))
        .orderBy(desc(FollowupNoteModel.createdAt))
        .limit(TIMELINE_LIMIT),
      port.getSuperAdmins(),
      port.getStaffActivity(clinicId, STAFF_ACTIVITY_DAYS),
    ]);
    const nameOf = new Map(admins.map((a) => [a.id, a.name]));

    // Plan periods, for starts the activity log never recorded (e.g. trials started at sign-up).
    const logged = subscription
      .filter((e) => START_TYPES.has(e.type))
      .map((e) => e.at.getTime());
    const planItems: ClinicTimelineItem[] = [];
    const now = Date.now();
    for (const sp of spans.filter(
      (x) => x.clinicId === clinicId && !x.continues
    )) {
      const start = realInstant(sp.startsAt);
      if (!logged.some((t) => Math.abs(t - start.getTime()) < 5 * 60_000))
        planItems.push(
          planItem(
            `plan-${start.getTime()}`,
            start,
            'plan_started',
            `${sp.planName} plan started`,
            billingNote(sp)
          )
        );
      if (
        sp.isTrial &&
        sp.expiresAt &&
        realInstant(sp.expiresAt).getTime() <= now
      )
        planItems.push(
          planItem(
            `trial-end-${start.getTime()}`,
            realInstant(sp.expiresAt),
            'trial_ended',
            `${sp.planName} trial ended`,
            null
          )
        );
    }

    const items: ClinicTimelineItem[] = [
      ...planItems,
      ...subscription.map((e, i) => ({
        id: `sub-${i}-${e.at.getTime()}`,
        at: e.at.toISOString(),
        source: 'subscription' as const,
        kind: e.type,
        title: e.title,
        detail: e.description,
        amount: e.amount,
        actor: null,
        taskType: null,
      })),
      ...notes.map((n) => ({
        id: n.id,
        at: n.at.toISOString(),
        source: 'followup' as const,
        kind: n.kind,
        title: n.body,
        detail: null,
        amount: null,
        actor: n.authorId ? (nameOf.get(n.authorId) ?? null) : null,
        taskType: n.taskType,
      })),
    ];
    return {
      items: items
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, TIMELINE_LIMIT),
      staffActivity: {
        days: STAFF_ACTIVITY_DAYS,
        actions: staff.actions,
        lastAt: staff.lastAt?.toISOString() ?? null,
      },
    };
  }
}
