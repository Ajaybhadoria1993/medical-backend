import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { MessageLogModel } from '../../models/messageLog.model';
import { getPlanPort } from '../../ports';
import type { AllowanceDecision } from '../../types/credits.types';
import { billingPeriod } from '../../utils/billingPeriod.utils';
import type { MessageChannel } from '../../utils/creditTypes.utils';
import { GrantsService } from './grants.service';

export class AllowanceService {
  /** Who pays for the next message right now. */
  static async decide(
    clinicId: string,
    channel: MessageChannel,
    now: Date = new Date()
  ): Promise<AllowanceDecision> {
    const plan = getPlanPort();
    const limit = await plan.getMessageLimit(clinicId, channel);
    if (limit.unlimited) return { source: 'unlimited' };

    const period = billingPeriod(await plan.getBillingAnchor(clinicId), now);
    const used = await this.countFreeUsed(clinicId, channel, period.start);
    const base = { used, limit: limit.limit, period };

    if (used < limit.limit) return { source: 'plan', ...base };
    if ((await GrantsService.balance(clinicId, channel)) > 0) {
      return { source: 'credit', ...base };
    }
    return { source: 'none', ...base };
  }

  /** Free messages used since `since`; refunded ones don't count. Served by the partial index. */
  private static async countFreeUsed(
    clinicId: string,
    channel: MessageChannel,
    since: Date
  ): Promise<number> {
    const [row] = await database
      .select({ used: sql<number>`count(*)::int` })
      .from(MessageLogModel)
      .where(
        and(
          eq(MessageLogModel.clinicId, clinicId),
          eq(MessageLogModel.channel, channel),
          eq(MessageLogModel.paidWith, 'plan'),
          isNull(MessageLogModel.refundedAt),
          gte(MessageLogModel.sentAt, since)
        )
      );
    return row?.used ?? 0;
  }
}
