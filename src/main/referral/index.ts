// Public surface of the module: code outside main/referral imports only from here.
import { sql, type AnyColumn } from 'drizzle-orm';
import { ReferralSignupsModel } from './models/referralSignup.model';
import logger from '../../utils/logger';
import { ReferralQueryService } from './services/referralQuery.service';
import { ReferralSignupService } from './services/referralSignup.service';

export { REFERRAL_ROLES } from './utils/referralCode.utils';
export { registerDirectoryPort } from './ports';
export type { DirectoryPort } from './ports';

/** Call after a user is created, when signup carried a code. Never throws. */
export const recordReferralSignup = (
  code: string,
  referredUserId: string,
  referredClinicId?: string | null
) => ReferralSignupService.recordSignup(code, referredUserId, referredClinicId);

/** Call when a Super Admin approves a clinic owner (status → Active). Never throws. */
export const markReferralJoined = (
  referredUserId: string,
  clinicId: string | null
) => ReferralSignupService.markJoined(referredUserId, clinicId);

/** Call after a paid plan activates, with the clinic owner. Never throws; safe on every payment. */
export const markReferralPaid = (referredUserId: string, clinicId: string) =>
  ReferralSignupService.markPaid(referredUserId, clinicId);

/** Referrer's name per referred user, for the Requests board. Never throws: returns an empty map on failure. */
export const getReferrerNames = async (referredUserIds: string[]) => {
  try {
    return await ReferralQueryService.referrerNames(referredUserIds);
  } catch (err) {
    logger.error('[Referral] getReferrerNames failed', { err });
    return new Map<string, string>();
  }
};

/** True when `userIdColumn`'s user signed up with a referral code; for SQL CASE/WHERE. */
export const referredUserExistsSql = (userIdColumn: AnyColumn) =>
  sql`EXISTS (SELECT 1 FROM ${ReferralSignupsModel} WHERE ${ReferralSignupsModel.referredUserId} = ${userIdColumn})`;
