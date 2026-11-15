import { and, eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import logger from '../../../utils/logger';
import { ReferralCodesModel } from '../models/referralCode.model';
import { ReferralSignupsModel } from '../models/referralSignup.model';
import { normalizeReferralCode } from '../utils/referralCode.utils';

export class ReferralSignupService {
  /** Saves a `signed_up` row (waiting for approval) for a new user. Never throws: a bad code must not break signup. */
  static async recordSignup(
    code: string,
    referredUserId: string,
    referredClinicId?: string | null
  ): Promise<void> {
    try {
      const [owner] = await database
        .select({
          id: ReferralCodesModel.id,
          userId: ReferralCodesModel.ownerUserId,
        })
        .from(ReferralCodesModel)
        .where(
          and(
            eq(ReferralCodesModel.code, normalizeReferralCode(code)),
            eq(ReferralCodesModel.active, true)
          )
        )
        .limit(1);

      if (!owner) {
        logger.warn('[Referral] signup with unknown or inactive code', {
          referredUserId,
        });
        return;
      }
      if (owner.userId === referredUserId) {
        logger.warn('[Referral] own code used at signup', { referredUserId });
        return;
      }

      await database
        .insert(ReferralSignupsModel)
        .values({
          codeId: owner.id,
          referrerUserId: owner.userId,
          referredUserId,
          referredClinicId: referredClinicId ?? null,
        })
        .onConflictDoNothing({ target: ReferralSignupsModel.referredUserId });
    } catch (err) {
      logger.error('[Referral] recordSignup failed', { referredUserId, err });
    }
  }

  /** Moves a waiting referral to `joined` when a Super Admin approves the clinic owner.
   *  Never throws: a referral must not fail an approval. */
  static async markJoined(
    referredUserId: string,
    referredClinicId: string | null
  ): Promise<void> {
    try {
      await database
        .update(ReferralSignupsModel)
        .set({
          status: 'joined',
          joinedAt: new Date(),
          ...(referredClinicId ? { referredClinicId } : {}),
        })
        .where(
          and(
            eq(ReferralSignupsModel.referredUserId, referredUserId),
            eq(ReferralSignupsModel.status, 'signed_up')
          )
        );
    } catch (err) {
      logger.error('[Referral] markJoined failed', { referredUserId, err });
    }
  }

  /** Moves a joined referral to `paid` on its first paid plan; later payments change nothing.
   *  Never throws: a referral must not fail a payment. */
  static async markPaid(
    referredUserId: string,
    referredClinicId: string
  ): Promise<void> {
    try {
      await database
        .update(ReferralSignupsModel)
        .set({ status: 'paid', paidAt: new Date(), referredClinicId })
        .where(
          and(
            eq(ReferralSignupsModel.referredUserId, referredUserId),
            eq(ReferralSignupsModel.status, 'joined')
          )
        );
    } catch (err) {
      logger.error('[Referral] markPaid failed', { referredUserId, err });
    }
  }
}
