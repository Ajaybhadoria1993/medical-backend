import { and, eq, inArray } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import logger from '../../../utils/logger';
import { subscriptionNotify } from '../notify/subscriptionNotify';
import { SubscriptionActivityModel } from '../models/subscriptionActivity.model';
import {
  SubscriptionAddOnModel,
  SubscriptionModel,
} from '../models/ownerSubscription.model';
import { SubscriptionActivityService } from './subscriptionActivity.service';

type AccessChangeKind = 'plan_downgrade' | 'addon_reduction';

interface ScheduledDeactivationNotice {
  clinicId: string;
  userIds: string[];
  eventId: string;
  changeKind: AccessChangeKind;
  changeSummary: string;
  effectiveAt: Date;
}

const istDateKey = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

const istDateKeyAfterDays = (date: Date, days: number) => {
  const [year, month, day] = istDateKey(date).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
};

export class AccountAccessEmailService {
  static async notifyScheduledDeactivation(
    input: ScheduledDeactivationNotice
  ): Promise<void> {
    await this.sendNotices(input, false);
  }

  /** The scheduled change was withdrawn: the same people hear their access continues. */
  static async notifyDowngradeReversed(input: {
    clinicId: string;
    userIds: string[];
    eventId: string;
    currentPlanName: string;
    cancelledPlanName: string;
    effectiveAt: Date | null;
  }): Promise<void> {
    const userIds = [...new Set(input.userIds)];
    if (!userIds.length) return;
    await subscriptionNotify(
      'subscription.staff_access_kept',
      {
        clinicId: input.clinicId,
        userIds,
        currentPlanName: input.currentPlanName,
        cancelledPlanName: input.cancelledPlanName,
        effectiveAt: input.effectiveAt,
      },
      `${input.eventId}|kept`
    );
    await SubscriptionActivityService.record({
      clinicId: input.clinicId,
      type: 'account_access_email_sent',
      title: 'Access continues notice sent',
      description: `Sent to ${userIds.length} account(s) whose access stays on.`,
      metadata: {
        eventId: input.eventId,
        userIds,
        stage: 'downgrade_reversed',
      },
    });
  }

  /** Send the three-day warning for schedules still active on the effective date. */
  static async sendThreeDayReminders(now = new Date()): Promise<number> {
    const reminderDateKey = istDateKeyAfterDays(now, 3);
    const rows = await database
      .select({
        clinicId: SubscriptionActivityModel.clinicId,
        type: SubscriptionActivityModel.type,
        metadata: SubscriptionActivityModel.metadata,
      })
      .from(SubscriptionActivityModel)
      .where(
        inArray(SubscriptionActivityModel.type, [
          'plan_change_scheduled',
          'addon_quantity_reduction_scheduled',
          'addon_removal_scheduled',
        ])
      );

    let sent = 0;
    for (const row of rows) {
      const metadata = (row.metadata || {}) as Record<string, any>;
      const userIds = Array.isArray(metadata.deactivationNoticeUserIds)
        ? metadata.deactivationNoticeUserIds.filter(
            (id): id is string => typeof id === 'string'
          )
        : [];
      const effectiveAt = metadata.deactivationNoticeEffectiveAt
        ? new Date(metadata.deactivationNoticeEffectiveAt)
        : null;
      const eventId = metadata.deactivationNoticeEventId;
      if (
        userIds.length === 0 ||
        typeof eventId !== 'string' ||
        !effectiveAt ||
        Number.isNaN(effectiveAt.getTime()) ||
        istDateKey(effectiveAt) !== reminderDateKey
      ) {
        continue;
      }

      const changeKind: AccessChangeKind =
        row.type === 'plan_change_scheduled'
          ? 'plan_downgrade'
          : 'addon_reduction';
      if (
        !(await this.isScheduleStillActive(row.clinicId, metadata, changeKind))
      ) {
        continue;
      }

      sent += await this.sendNotices(
        {
          clinicId: row.clinicId,
          userIds,
          eventId,
          changeKind,
          changeSummary: String(
            metadata.deactivationNoticeSummary ||
              'a scheduled subscription change'
          ),
          effectiveAt,
        },
        true
      );
      logger.info(
        `Account access reminder processed for clinic ${row.clinicId}; selected=${userIds.length}.`
      );
    }
    return sent;
  }

  /** The change is still scheduled for that day on the clinic's current subscription. */
  private static async isScheduleStillActive(
    clinicId: string,
    metadata: Record<string, any>,
    kind: AccessChangeKind
  ): Promise<boolean> {
    const effectiveAt = new Date(metadata.deactivationNoticeEffectiveAt);
    if (kind === 'plan_downgrade') {
      const [sub] = await database
        .select({
          scheduledPlanId: SubscriptionModel.scheduledPlanId,
          scheduledChangeAt: SubscriptionModel.scheduledChangeAt,
        })
        .from(SubscriptionModel)
        .where(
          and(
            eq(SubscriptionModel.ownerType, 'clinic'),
            eq(SubscriptionModel.ownerId, clinicId),
            inArray(SubscriptionModel.status, [
              'trialing',
              'active',
              'past_due',
            ])
          )
        )
        .limit(1);
      return Boolean(
        sub?.scheduledPlanId === metadata.toPlanId &&
        sub.scheduledChangeAt &&
        istDateKey(new Date(sub.scheduledChangeAt)) === istDateKey(effectiveAt)
      );
    }

    const id = metadata.subscriptionAddOnId;
    if (typeof id !== 'string') return false;
    const [row] = await database
      .select({
        scheduledQuantity: SubscriptionAddOnModel.scheduledQuantity,
        scheduledDeactivateUserIds:
          SubscriptionAddOnModel.scheduledDeactivateUserIds,
        periodEnd: SubscriptionModel.currentPeriodEnd,
      })
      .from(SubscriptionAddOnModel)
      .innerJoin(
        SubscriptionModel,
        eq(SubscriptionModel.id, SubscriptionAddOnModel.subscriptionId)
      )
      .where(
        and(
          eq(SubscriptionAddOnModel.id, id),
          eq(SubscriptionAddOnModel.status, 'active')
        )
      )
      .limit(1);
    return Boolean(
      row &&
      row.scheduledQuantity !== null &&
      (row.scheduledDeactivateUserIds ?? []).length > 0 &&
      row.periodEnd &&
      istDateKey(row.periodEnd) === istDateKey(effectiveAt)
    );
  }

  /** One event per notice: the dispatcher emails each person, and its job id stops a rerun resending. */
  private static async sendNotices(
    input: ScheduledDeactivationNotice,
    reminder: boolean
  ): Promise<number> {
    const userIds = [...new Set(input.userIds)];
    if (!userIds.length) return 0;
    await subscriptionNotify(
      reminder
        ? 'subscription.staff_access_ending'
        : 'subscription.staff_access_scheduled',
      {
        clinicId: input.clinicId,
        userIds,
        changeSummary: input.changeSummary,
        effectiveAt: input.effectiveAt,
      },
      `${input.eventId}|${reminder ? 'three_day_reminder' : 'scheduled'}`
    );
    await SubscriptionActivityService.record({
      clinicId: input.clinicId,
      type: 'account_access_email_sent',
      title: reminder
        ? 'Three-day access deactivation reminder sent'
        : 'Access deactivation notice sent',
      description: `${input.changeKind === 'plan_downgrade' ? 'Plan downgrade' : 'Add-on reduction'} notice sent to ${userIds.length} account(s).`,
      metadata: {
        eventId: input.eventId,
        userIds,
        stage: reminder ? 'three_day_reminder' : 'scheduled',
        effectiveAt: input.effectiveAt.toISOString(),
        changeKind: input.changeKind,
      },
    });
    return userIds.length;
  }
}
