import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import redisClient from '../../../../configurations/redisConfig';
import { HttpError } from '../../../../middlewear/errorHandler';
import { formatISTDate } from '../../../../utils/istDateTime';
import { UserModel } from '../../../users/models/user.model';
import { AddOnModel, PlanAddOnLimitsModel } from '../../models/addon.model';
import { SubscriptionAddOnModel } from '../../models/ownerSubscription.model';
import { reducedQuantity, seatExcess } from '../../utils/addOnChange.utils';
import { AddOnService } from '../addon.service';
import { FEATURE_KEYS, LimitationService } from '../limitation.service';
import { SubscriptionActivityService } from '../subscriptionActivity.service';
import { OwnerSubscriptionService } from './ownerSubscription.service';
import { subscriptionNotify } from '../../notify/subscriptionNotify';
import type { Tx } from '../../types/db.types';

const DOCTOR_KEYS = new Set([
  'additional_doctor',
  FEATURE_KEYS.DOCTOR_ACCOUNTS,
]);
const STAFF_KEYS = new Set(['additional_staff', FEATURE_KEYS.STAFF_ACCOUNTS]);

/** Add-on reduce, remove and undo: nothing changes until the period ends. */
export class AddOnChangeService {
  static async reduce(
    clinicId: string,
    id: string,
    reduceBy: number,
    deactivateUserIds: string[]
  ) {
    const { row, periodEnd } = await AddOnChangeService.load(clinicId, id);
    const next = reducedQuantity(row.quantity, row.scheduledQuantity, reduceBy);
    if (next === null) {
      throw new HttpError(
        400,
        `You have ${row.scheduledQuantity ?? row.quantity} ${row.name} for the next period; reduce by 1 to ${row.scheduledQuantity ?? row.quantity}.`
      );
    }
    return AddOnChangeService.schedule(
      clinicId,
      row,
      next,
      deactivateUserIds,
      periodEnd
    );
  }

  static async remove(
    clinicId: string,
    id: string,
    deactivateUserIds: string[]
  ) {
    const { row, periodEnd } = await AddOnChangeService.load(clinicId, id);
    return AddOnChangeService.schedule(
      clinicId,
      row,
      0,
      deactivateUserIds,
      periodEnd
    );
  }

  static async undo(clinicId: string, id: string) {
    await OwnerSubscriptionService.assertNoRenewalInFlight(clinicId);
    const { row } = await AddOnChangeService.load(clinicId, id);
    if (row.scheduledQuantity === null) {
      throw new HttpError(409, `${row.name} has no change to undo.`);
    }
    const [updated] = await database
      .update(SubscriptionAddOnModel)
      .set({
        scheduledQuantity: null,
        scheduledDeactivateUserIds: [],
        updatedAt: new Date(),
      })
      .where(eq(SubscriptionAddOnModel.id, row.id))
      .returning();
    await SubscriptionActivityService.record({
      clinicId,
      type: 'addon_removal_undone',
      title: `Kept ${row.name}`,
      description: `${row.name} stays at ${row.quantity} from the next period.`,
      metadata: { subscriptionAddOnId: row.id },
    });
    return updated;
  }

  /** In the renewal transaction: scheduled quantities take effect, 0 ends the add-on. Returns users to archive. */
  /** The add-ons a plan version allows: add-on id → its cap (null = no cap); absent = not allowed. */
  static async capsForVersion(
    planVersionId: string,
    db: Tx | typeof database = database
  ) {
    const rows = await db
      .select({
        addOnId: PlanAddOnLimitsModel.addOnId,
        maxCap: PlanAddOnLimitsModel.maxCap,
      })
      .from(PlanAddOnLimitsModel)
      .where(eq(PlanAddOnLimitsModel.planVersionId, planVersionId));
    return new Map(rows.map((r) => [r.addOnId, r.maxCap]));
  }

  /** Applies reductions scheduled before the renewal was priced (`pricedAt`); later ones wait for the next renewal. */
  static async applyAtRenewal(tx: Tx, subscriptionId: string, pricedAt?: Date) {
    const due = await tx
      .select()
      .from(SubscriptionAddOnModel)
      .where(
        and(
          eq(SubscriptionAddOnModel.subscriptionId, subscriptionId),
          eq(SubscriptionAddOnModel.status, 'active'),
          isNotNull(SubscriptionAddOnModel.scheduledQuantity),
          pricedAt ? lte(SubscriptionAddOnModel.updatedAt, pricedAt) : undefined
        )
      );
    const archive: string[] = [];
    for (const r of due) {
      archive.push(...(r.scheduledDeactivateUserIds ?? []));
      await tx
        .update(SubscriptionAddOnModel)
        .set(
          r.scheduledQuantity === 0
            ? {
                status: 'cancelled',
                scheduledQuantity: null,
                scheduledDeactivateUserIds: [],
                updatedAt: new Date(),
              }
            : {
                quantity: r.scheduledQuantity!,
                scheduledQuantity: null,
                scheduledDeactivateUserIds: [],
                updatedAt: new Date(),
              }
        )
        .where(eq(SubscriptionAddOnModel.id, r.id));
    }
    return { applied: due.length, archive };
  }

  /** After the renewal commits: the picked accounts go, then any account still over the limit. */
  static async afterRenewal(
    clinicId: string,
    applied: number,
    archive: string[],
    paymentId: string
  ) {
    if (!applied) return;
    if (archive.length) {
      const users = await database
        .update(UserModel)
        .set({ isArchive: true, userStatus: 'Inactive', updatedAt: new Date() })
        .where(
          and(inArray(UserModel.id, archive), eq(UserModel.isArchive, false))
        )
        .returning({ id: UserModel.id });
      if (users.length)
        await redisClient.del(...users.map((u) => `user:${u.id}`));
    }
    await LimitationService.invalidateClinicCache(clinicId);
    await LimitationService.enforceStaffLimitsOnExpiry(clinicId);
    await SubscriptionActivityService.record({
      clinicId,
      type: 'addon_quantity_reduction_applied',
      title: 'Scheduled add-on changes applied',
      description: `${applied} add-on change(s) took effect with the renewal.`,
      metadata: { archivedUserIds: archive },
    });
    await subscriptionNotify(
      'subscription.change_applied',
      {
        clinicId,
        summary: `${applied} add-on change(s) you scheduled now apply${archive.length ? `, and ${archive.length} account(s) were switched off` : ''}.`,
        effectiveAt: new Date(),
      },
      paymentId
    );
  }

  private static async schedule(
    clinicId: string,
    row: Awaited<ReturnType<typeof AddOnChangeService.load>>['row'],
    next: number,
    deactivateUserIds: string[],
    periodEnd: Date
  ) {
    // Allowed while a renewal is with the bank: renewal capture moves it to the next period.
    const isDoctor = DOCTOR_KEYS.has(row.featureKey);
    const isSeat = isDoctor || STAFF_KEYS.has(row.featureKey);
    let picked: string[] = [];
    if (isSeat) {
      const check = isDoctor
        ? await LimitationService.checkDoctorLimit(clinicId)
        : await LimitationService.checkStaffLimit(clinicId);
      const excess = seatExcess(
        check.currentUsage,
        check.limit ?? 0,
        row.quantity - next,
        row.unitValue || 1
      );
      // The server alone decides how many must go; the screen opens its picker with this number.
      if (excess > 0 && deactivateUserIds.length !== excess) {
        const role = isDoctor ? 'doctor' : 'staff';
        throw new HttpError(
          400,
          `Choose ${excess} ${role} account${excess === 1 ? '' : 's'} to switch off when this period ends.`,
          {
            needsToDeactivate: excess,
            role,
            activeCount: check.currentUsage,
            newLimit: Math.max(0, check.currentUsage - excess),
          }
        );
      }
      await AddOnService.validateDeactivateUsers(
        clinicId,
        row.featureKey,
        excess,
        deactivateUserIds
      );
      picked = excess > 0 ? deactivateUserIds : [];
    }

    const [updated] = await database
      .update(SubscriptionAddOnModel)
      .set({
        scheduledQuantity: next,
        scheduledDeactivateUserIds: picked,
        updatedAt: new Date(),
      })
      .where(eq(SubscriptionAddOnModel.id, row.id))
      .returning();

    const removal = next === 0;
    await SubscriptionActivityService.record({
      clinicId,
      type: removal
        ? 'addon_removal_scheduled'
        : 'addon_quantity_reduction_scheduled',
      title: removal
        ? `${row.name} ends at period end`
        : `${row.name} reduced to ${next}`,
      description: `From ${formatISTDate(periodEnd)}; nothing changes before then.`,
      // The deactivationNotice* fields are what the 3-day staff-access reminder reads.
      metadata: {
        subscriptionAddOnId: row.id,
        from: row.quantity,
        to: next,
        deactivateUserIds: picked,
        deactivationNoticeUserIds: picked,
        deactivationNoticeEventId: `addon|${row.id}|${next}|${periodEnd.toISOString()}`,
        deactivationNoticeEffectiveAt: periodEnd.toISOString(),
        deactivationNoticeSummary: removal
          ? `${row.name} ends`
          : `${row.name} goes down to ${next}`,
      },
    });
    const key = `${row.id}|${next}|${periodEnd.toISOString()}`;
    await (removal
      ? subscriptionNotify(
          'subscription.addon_removal_scheduled',
          {
            clinicId,
            addOnName: row.name,
            effectiveAt: periodEnd,
            scheduled: true,
            quantity: row.quantity,
          },
          key
        )
      : subscriptionNotify(
          'subscription.addon_reduction_scheduled',
          {
            clinicId,
            addOnName: row.name,
            previousQuantity: row.quantity,
            newQuantity: next,
            effectiveAt: periodEnd,
          },
          key
        ));
    return updated;
  }

  /** The clinic's own active add-on on its current paid subscription, with its period end. */
  private static async load(clinicId: string, id: string) {
    const current = await OwnerSubscriptionService.getCurrent(
      'clinic',
      clinicId
    );
    const sub = current?.subscription;
    if (
      !current?.state.isValid ||
      current.plan.kind !== 'paid' ||
      !sub?.currentPeriodEnd
    ) {
      throw new HttpError(409, 'Add-ons can only be changed on a paid plan.');
    }
    const [row] = await database
      .select({
        id: SubscriptionAddOnModel.id,
        quantity: SubscriptionAddOnModel.quantity,
        scheduledQuantity: SubscriptionAddOnModel.scheduledQuantity,
        name: AddOnModel.name,
        featureKey: AddOnModel.featureKey,
        unitValue: AddOnModel.unitValue,
      })
      .from(SubscriptionAddOnModel)
      .innerJoin(AddOnModel, eq(AddOnModel.id, SubscriptionAddOnModel.addOnId))
      .where(
        and(
          eq(SubscriptionAddOnModel.id, id),
          eq(SubscriptionAddOnModel.subscriptionId, sub.id),
          eq(SubscriptionAddOnModel.status, 'active')
        )
      )
      .limit(1);
    if (!row) throw new HttpError(404, 'Active add-on not found.');
    return { row, periodEnd: sub.currentPeriodEnd };
  }
}
