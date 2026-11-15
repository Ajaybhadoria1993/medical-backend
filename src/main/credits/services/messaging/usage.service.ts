import { TransactionRollbackError } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import logger from '../../../../utils/logger';
import { MessageLogModel } from '../../models/messageLog.model';
import type {
  CheckSendResult,
  RecordSentInput,
} from '../../types/credits.types';
import { crossedWarning } from '../../utils/billingPeriod.utils';
import type { MessageChannel } from '../../utils/creditTypes.utils';
import { AllowanceService } from '../core/allowance.service';
import { GrantsService } from '../core/grants.service';
import { CreditSettingsService } from '../core/settings.service';
import { AlertsService } from './alerts.service';

export class UsageService {
  /** Whether a message may go out now. Fails open: a lookup error must not
   *  silence a clinic's patient messages, so it logs and allows. */
  static async checkSend(
    clinicId: string,
    channel: MessageChannel,
    templateKey: string
  ): Promise<CheckSendResult> {
    try {
      const decision = await AllowanceService.decide(clinicId, channel);
      if (decision.source !== 'none') return { allowed: true };

      logger.info(
        `[Credits] ${channel} "${templateKey}" skipped for clinic ${clinicId}: ${decision.used}/${decision.limit} free messages used since ${decision.period.start.toISOString()}`
      );
      await AlertsService.paused({ clinicId, channel, ...decision });
      return { allowed: false };
    } catch (err) {
      logger.error(
        `[Credits] Send check failed for clinic ${clinicId}, sending anyway: ${(err as Error).message}`
      );
      return { allowed: true };
    }
  }

  /** Records a message Meta accepted. Never throws: the message is already out, and a
   *  thrown error would make the outbox retry the job and send the patient a second copy. */
  static async recordSent(input: RecordSentInput): Promise<void> {
    try {
      const decision = await AllowanceService.decide(
        input.clinicId,
        input.channel
      );

      // `none` here: a concurrent send used up what the check saw. It went out, so
      // it takes a credit if one is left, else counts as free (the accepted overshoot).
      if (decision.source === 'credit' || decision.source === 'none') {
        await this.recordWithCredit(input);
        return;
      }

      await database
        .insert(MessageLogModel)
        .values({
          ...this.logRow(input),
          paidWith: decision.source,
        })
        .onConflictDoNothing({ target: MessageLogModel.messageId });

      if (decision.source === 'unlimited') return;

      const { warnPercent } = await CreditSettingsService.getInForce(
        input.channel
      );
      const usedAfter = decision.used + 1;
      if (
        crossedWarning(decision.used, usedAfter, decision.limit, warnPercent)
      ) {
        await AlertsService.warning({
          clinicId: input.clinicId,
          channel: input.channel,
          used: usedAfter,
          limit: decision.limit,
          period: decision.period,
        });
      }
    } catch (err) {
      logger.error(
        `[Credits] Failed to record ${input.channel} message ${input.messageId} for clinic ${input.clinicId}: ${(err as Error).message}`
      );
    }
  }

  /** Takes the credit and writes the row in one transaction, so neither happens alone.
   *  A repeated message id rolls back, so it never costs a second credit. */
  private static async recordWithCredit(input: RecordSentInput) {
    try {
      await database.transaction(async (tx) => {
        const grantId = await GrantsService.useOne(
          tx,
          input.clinicId,
          input.channel
        );
        const [inserted] = await tx
          .insert(MessageLogModel)
          .values({
            ...this.logRow(input),
            paidWith: grantId ? 'credit' : 'plan',
            creditGrantId: grantId,
          })
          .onConflictDoNothing({ target: MessageLogModel.messageId })
          .returning({ id: MessageLogModel.id });
        if (!inserted) tx.rollback();
      });
    } catch (err) {
      if (!(err instanceof TransactionRollbackError)) throw err;
    }
  }

  private static logRow(input: RecordSentInput) {
    return {
      clinicId: input.clinicId,
      channel: input.channel,
      messageId: input.messageId,
      templateKey: input.templateKey,
    };
  }
}
