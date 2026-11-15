import { and, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import logger from '../../../../utils/logger';
import { CreditGrantsModel } from '../../models/creditGrants.model';
import { getNotifyPort } from '../../ports';
import { CREDIT_TYPES } from '../../utils/creditTypes.utils';
import { CreditSettingsService } from './settings.service';

const DAY_MS = 24 * 60 * 60 * 1000;
// Bounds one run; anything left over is picked up by the next day's run.
const BATCH_LIMIT = 500;

const expiresOnFormat = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
});

export class ExpiryService {
  /** Reminds clinic admins of grants expiring within each type's reminder_days.
   *  Marks a grant before alerting, so a rerun never sends a second reminder. Returns how many. */
  static async runReminders(now: Date = new Date()): Promise<number> {
    let reminded = 0;

    for (const creditType of CREDIT_TYPES) {
      const { reminderDays } = await CreditSettingsService.getInForce(
        creditType,
        now
      );
      if (reminderDays <= 0) continue;

      const due = await database
        .select({
          id: CreditGrantsModel.id,
          clinicId: CreditGrantsModel.clinicId,
          creditsLeft: CreditGrantsModel.creditsLeft,
          expiresAt: CreditGrantsModel.expiresAt,
        })
        .from(CreditGrantsModel)
        .where(
          and(
            eq(CreditGrantsModel.creditType, creditType),
            inArray(CreditGrantsModel.source, ['grant', 'purchase']),
            gt(CreditGrantsModel.creditsLeft, 0),
            isNull(CreditGrantsModel.expiryRemindedAt),
            gt(CreditGrantsModel.expiresAt, now),
            lte(
              CreditGrantsModel.expiresAt,
              new Date(now.getTime() + reminderDays * DAY_MS)
            )
          )
        )
        .limit(BATCH_LIMIT);

      for (const grant of due) {
        const [marked] = await database
          .update(CreditGrantsModel)
          .set({ expiryRemindedAt: now })
          .where(
            and(
              eq(CreditGrantsModel.id, grant.id),
              isNull(CreditGrantsModel.expiryRemindedAt)
            )
          )
          .returning({ id: CreditGrantsModel.id });
        if (!marked) continue;

        try {
          await getNotifyPort().creditsExpiring({
            clinicId: grant.clinicId,
            creditType,
            grantId: grant.id,
            creditsLeft: grant.creditsLeft,
            expiresOn: expiresOnFormat.format(grant.expiresAt),
          });
          reminded += 1;
        } catch (err) {
          logger.error(
            `[Credits] Expiry reminder for grant ${grant.id} failed: ${(err as Error).message}`
          );
        }
      }
    }

    return reminded;
  }
}
