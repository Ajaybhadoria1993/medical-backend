import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import logger from '../../../../utils/logger';
import { CreditGrantsModel } from '../../models/creditGrants.model';
import { MessageLogModel } from '../../models/messageLog.model';
import type { DeliveryReport } from '../../types/credits.types';
import type { CreditType } from '../../utils/creditTypes.utils';
import { unitCostWithTax } from '../../utils/cost.utils';
import { CreditSettingsService } from '../core/settings.service';

// Meta can report within a second, before the worker has written the row.
const UNKNOWN_RETRY_DELAY_MS = 30_000;

export class DeliveryService {
  /** Applies one Meta status to the message's cost record. A clinic pays only for what
   *  Meta charges us: failed or not-billable messages are given back. Never throws. */
  static async record(report: DeliveryReport, isRetry = false): Promise<void> {
    try {
      const [row] = await database
        .select({
          channel: MessageLogModel.channel,
          refundedAt: MessageLogModel.refundedAt,
        })
        .from(MessageLogModel)
        .where(eq(MessageLogModel.messageId, report.messageId))
        .limit(1);

      if (!row) {
        if (isRetry) {
          logger.warn(
            `[Credits] Delivery report for unknown message ${report.messageId}`
          );
          return;
        }
        // ponytail: in-process retry, lost on restart; use a delayed queue job if that matters.
        setTimeout(
          () => void this.record(report, true),
          UNKNOWN_RETRY_DELAY_MS
        ).unref();
        return;
      }
      if (row.refundedAt) return;

      if (report.status === 'failed' || report.billable === false) {
        await this.refund(report.messageId);
      } else if (report.billable === true) {
        await this.charge(report.messageId, row.channel as CreditType);
      }
    } catch (err) {
      logger.error(
        `[Credits] Failed to apply ${report.status} report for message ${report.messageId}: ${(err as Error).message}`
      );
    }
  }

  /** Stores the cost from the settings in force now. Repeat reports write the same values. */
  private static async charge(messageId: string, creditType: CreditType) {
    const { unitCostInr, taxPercent } =
      await CreditSettingsService.getInForce(creditType);

    await database
      .update(MessageLogModel)
      .set({
        billable: true,
        costInr: unitCostWithTax(unitCostInr, taxPercent),
      })
      .where(
        and(
          eq(MessageLogModel.messageId, messageId),
          isNull(MessageLogModel.refundedAt)
        )
      );
  }

  /** Gives the message back once: it stops counting as a free message, and a credit
   *  returns to its grant. The refunded_at guard makes a repeated report a no-op. */
  private static async refund(messageId: string) {
    await database.transaction(async (tx) => {
      const [refunded] = await tx
        .update(MessageLogModel)
        .set({ refundedAt: new Date(), billable: false, costInr: '0' })
        .where(
          and(
            eq(MessageLogModel.messageId, messageId),
            isNull(MessageLogModel.refundedAt)
          )
        )
        .returning({
          paidWith: MessageLogModel.paidWith,
          creditGrantId: MessageLogModel.creditGrantId,
        });

      if (refunded?.paidWith !== 'credit' || !refunded.creditGrantId) return;

      await tx
        .update(CreditGrantsModel)
        .set({ creditsLeft: sql`${CreditGrantsModel.creditsLeft} + 1` })
        .where(
          and(
            eq(CreditGrantsModel.id, refunded.creditGrantId),
            lt(CreditGrantsModel.creditsLeft, CreditGrantsModel.creditsTotal)
          )
        );
    });
  }
}
