import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import logger from '../../../../utils/logger';
import { CreditGrantsModel } from '../../models/creditGrants.model';
import { getClinicPort } from '../../ports';
import type { CreditChangeInput } from '../../types/credits.types';
import type { CreditType } from '../../utils/creditTypes.utils';
import { CreditSettingsService } from './settings.service';

const DAY_MS = 24 * 60 * 60 * 1000;
// Two concurrent sends can race for the last credit of one grant; the loser retries the next grant.
const USE_ATTEMPTS = 3;

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];

// Credits a clinic can spend: given by an admin or bought; a removal row only records the removal.
const SPENDABLE = ['grant', 'purchase'] as const;

const liveGrants = (clinicId: string, creditType: CreditType) =>
  and(
    eq(CreditGrantsModel.clinicId, clinicId),
    eq(CreditGrantsModel.creditType, creditType),
    inArray(CreditGrantsModel.source, [...SPENDABLE]),
    gt(CreditGrantsModel.creditsLeft, 0),
    gt(CreditGrantsModel.expiresAt, sql`now()`)
  );

export class GrantsService {
  /** Credits the clinic can use now: unexpired grants with credits left. */
  static async balance(
    clinicId: string,
    creditType: CreditType
  ): Promise<number> {
    const [row] = await database
      .select({
        balance: sql<number>`coalesce(sum(${CreditGrantsModel.creditsLeft}), 0)::int`,
      })
      .from(CreditGrantsModel)
      .where(liveGrants(clinicId, creditType));
    return row?.balance ?? 0;
  }

  /** The soonest-expiring credits still usable, for "50 expire on 12 Oct". */
  static async nextExpiring(clinicId: string, creditType: CreditType) {
    const [row] = await database
      .select({
        credits: CreditGrantsModel.creditsLeft,
        expiresAt: CreditGrantsModel.expiresAt,
      })
      .from(CreditGrantsModel)
      .where(liveGrants(clinicId, creditType))
      .orderBy(asc(CreditGrantsModel.expiresAt))
      .limit(1);
    return row ?? null;
  }

  /** A clinic's grants and removals, newest first. `withActor` adds who did it (Super Admin views). */
  static async list(
    clinicId: string,
    creditType: CreditType,
    pageNumber: number,
    pageSize: number,
    withActor = false
  ) {
    const where = and(
      eq(CreditGrantsModel.clinicId, clinicId),
      eq(CreditGrantsModel.creditType, creditType)
    );
    const [rows, [count]] = await Promise.all([
      database
        .select({
          id: CreditGrantsModel.id,
          source: CreditGrantsModel.source,
          creditsTotal: CreditGrantsModel.creditsTotal,
          creditsLeft: CreditGrantsModel.creditsLeft,
          reason: CreditGrantsModel.reason,
          expiresAt: CreditGrantsModel.expiresAt,
          createdAt: CreditGrantsModel.createdAt,
          grantedBy: CreditGrantsModel.grantedBy,
        })
        .from(CreditGrantsModel)
        .where(where)
        .orderBy(desc(CreditGrantsModel.createdAt))
        .limit(pageSize)
        .offset((pageNumber - 1) * pageSize),
      database
        .select({ total: sql<number>`count(*)::int` })
        .from(CreditGrantsModel)
        .where(where),
    ]);

    const names = withActor
      ? await getClinicPort().getUserNames([
          ...new Set(
            rows.map((row) => row.grantedBy).filter((id): id is string => !!id)
          ),
        ])
      : null;
    const now = Date.now();
    return {
      items: rows.map(({ grantedBy, ...row }) => ({
        ...row,
        expired: row.source !== 'removal' && row.expiresAt.getTime() <= now,
        ...(names
          ? {
              grantedBy,
              // A purchase has no Super Admin behind it.
              grantedByName: grantedBy
                ? (names.get(grantedBy) ?? 'Removed user')
                : 'Bought by the clinic',
            }
          : {}),
      })),
      total: count?.total ?? 0,
      pageNumber,
      pageSize,
    };
  }

  /** Super Admin adds credits; they expire after the expiry days in force now. */
  static async grant(input: CreditChangeInput) {
    if (!Number.isInteger(input.credits) || input.credits <= 0) {
      throw new HttpError(422, 'Credits must be a whole number above zero');
    }
    const { expiryDays } = await CreditSettingsService.getInForce(
      input.creditType
    );

    const [grant] = await database
      .insert(CreditGrantsModel)
      .values({
        clinicId: input.clinicId,
        creditType: input.creditType,
        source: 'grant',
        creditsTotal: input.credits,
        creditsLeft: input.credits,
        grantedBy: input.actorUserId,
        reason: input.reason,
        expiresAt: new Date(Date.now() + expiryDays * DAY_MS),
      })
      .returning();

    logger.info(
      `[Credits] Granted ${input.credits} ${input.creditType} credits to clinic ${input.clinicId} by ${input.actorUserId}`
    );
    return grant;
  }

  /** Credits a clinic paid for. Keyed by the payment, so a repeat call adds nothing. */
  static async grantPurchase(input: {
    clinicId: string;
    creditType: CreditType;
    credits: number;
    paymentId: string;
    reason: string;
  }) {
    const { expiryDays } = await CreditSettingsService.getInForce(
      input.creditType
    );
    const [grant] = await database
      .insert(CreditGrantsModel)
      .values({
        clinicId: input.clinicId,
        creditType: input.creditType,
        source: 'purchase',
        creditsTotal: input.credits,
        creditsLeft: input.credits,
        grantedBy: null,
        paymentId: input.paymentId,
        reason: input.reason,
        expiresAt: new Date(Date.now() + expiryDays * DAY_MS),
      })
      .onConflictDoNothing()
      .returning({ id: CreditGrantsModel.id });
    if (grant) {
      logger.info(
        `[Credits] Clinic ${input.clinicId} bought ${input.credits} ${input.creditType} credits (payment ${input.paymentId})`
      );
    }
    return { added: !!grant };
  }

  /** A refunded pack: its unused credits end now. Returns how many were taken back; safe to rerun. */
  static async revokePurchase(
    paymentId: string,
    reason: string,
    byUserId: string
  ) {
    const taken = await database.transaction(async (tx) => {
      const [grant] = await tx
        .select()
        .from(CreditGrantsModel)
        .where(
          and(
            eq(CreditGrantsModel.paymentId, paymentId),
            eq(CreditGrantsModel.source, 'purchase')
          )
        )
        .for('update')
        .limit(1);
      if (!grant || grant.creditsLeft <= 0) return 0;
      await tx
        .update(CreditGrantsModel)
        .set({ creditsLeft: 0 })
        .where(eq(CreditGrantsModel.id, grant.id));
      await tx.insert(CreditGrantsModel).values({
        clinicId: grant.clinicId,
        creditType: grant.creditType,
        source: 'removal',
        creditsTotal: grant.creditsLeft,
        creditsLeft: 0,
        grantedBy: byUserId,
        reason,
        expiresAt: new Date(),
      });
      return grant.creditsLeft;
    });
    if (taken)
      logger.info(
        `[Credits] Took back ${taken} unused credits of refunded payment ${paymentId}`
      );
    return taken;
  }

  /** Super Admin removes credits, soonest-expiring first, and records the removal
   *  in the same transaction. Refuses (409) to go below zero. */
  static async remove(input: CreditChangeInput) {
    if (!Number.isInteger(input.credits) || input.credits <= 0) {
      throw new HttpError(422, 'Credits must be a whole number above zero');
    }

    const removal = await database.transaction(async (tx) => {
      const grants = await tx
        .select({
          id: CreditGrantsModel.id,
          creditsLeft: CreditGrantsModel.creditsLeft,
        })
        .from(CreditGrantsModel)
        .where(liveGrants(input.clinicId, input.creditType))
        .orderBy(asc(CreditGrantsModel.expiresAt))
        .for('update');

      const available = grants.reduce((sum, g) => sum + g.creditsLeft, 0);
      if (available < input.credits) {
        throw new HttpError(
          409,
          `Only ${available} credits are available to remove`
        );
      }

      let remaining = input.credits;
      for (const grant of grants) {
        if (remaining === 0) break;
        const take = Math.min(remaining, grant.creditsLeft);
        await tx
          .update(CreditGrantsModel)
          .set({ creditsLeft: grant.creditsLeft - take })
          .where(eq(CreditGrantsModel.id, grant.id));
        remaining -= take;
      }

      const [row] = await tx
        .insert(CreditGrantsModel)
        .values({
          clinicId: input.clinicId,
          creditType: input.creditType,
          source: 'removal',
          creditsTotal: input.credits,
          creditsLeft: 0,
          grantedBy: input.actorUserId,
          reason: input.reason,
          expiresAt: new Date(),
        })
        .returning();
      return row;
    });

    logger.info(
      `[Credits] Removed ${input.credits} ${input.creditType} credits from clinic ${input.clinicId} by ${input.actorUserId}`
    );
    return removal;
  }

  /** Takes one credit from the soonest-expiring grant, inside the caller's transaction.
   *  Returns the grant id, or null when none is left. */
  static async useOne(
    tx: Tx,
    clinicId: string,
    creditType: CreditType
  ): Promise<string | null> {
    for (let attempt = 0; attempt < USE_ATTEMPTS; attempt += 1) {
      // Plain FOR UPDATE, not SKIP LOCKED: a skipped lock on the only grant would read as "no credits".
      const [used] = await tx
        .update(CreditGrantsModel)
        .set({ creditsLeft: sql`${CreditGrantsModel.creditsLeft} - 1` })
        .where(
          and(
            gt(CreditGrantsModel.creditsLeft, 0),
            eq(
              CreditGrantsModel.id,
              sql`(select id from credit_grants
                   where clinic_id = ${clinicId} and credit_type = ${creditType}
                     and source in ('grant', 'purchase') and credits_left > 0 and expires_at > now()
                   order by expires_at limit 1 for update)`
            )
          )
        )
        .returning({ id: CreditGrantsModel.id });
      if (used) return used.id;

      // Nothing updated: either no credits at all, or another send just took this grant's last one.
      const [next] = await tx
        .select({ id: CreditGrantsModel.id })
        .from(CreditGrantsModel)
        .where(liveGrants(clinicId, creditType))
        .limit(1);
      if (!next) return null;
    }
    return null;
  }
}
