import { eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import {
  ReferralCodesModel,
  type ReferralCode,
} from '../models/referralCode.model';
import { generateReferralCode } from '../utils/referralCode.utils';

// A random code can collide with an existing one; retry with a fresh one.
const CREATE_ATTEMPTS = 5;

export class ReferralCodeService {
  /** The user's code, created on first call. Safe under concurrent calls. */
  static async getOrCreate(
    ownerUserId: string,
    tenant: { clinicId?: string | null; labId?: string | null }
  ): Promise<ReferralCode> {
    const existing = await this.findByOwner(ownerUserId);
    if (existing) return existing;

    for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
      await database
        .insert(ReferralCodesModel)
        .values({
          code: generateReferralCode(),
          ownerUserId,
          clinicId: tenant.clinicId ?? null,
          labId: tenant.labId ?? null,
        })
        .onConflictDoNothing();
      // Re-read either way: a parallel request may have created it first.
      const created = await this.findByOwner(ownerUserId);
      if (created) return created;
    }
    throw new Error(
      `[Referral] could not create a unique code for ${ownerUserId}`
    );
  }

  private static async findByOwner(ownerUserId: string) {
    const [row] = await database
      .select()
      .from(ReferralCodesModel)
      .where(eq(ReferralCodesModel.ownerUserId, ownerUserId))
      .limit(1);
    return row;
  }
}
