import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import {
  ReferralSignupsModel,
  type ReferralSignup,
} from '../models/referralSignup.model';
import { ReferralCodesModel } from '../models/referralCode.model';
import { getDirectoryPort } from '../ports';
import type {
  MyReferralsQuery,
  SuperadminReferralsQuery,
} from '../schemas/referral.schema';

const ROW = {
  id: ReferralSignupsModel.id,
  codeId: ReferralSignupsModel.codeId,
  referrerUserId: ReferralSignupsModel.referrerUserId,
  referredUserId: ReferralSignupsModel.referredUserId,
  referredClinicId: ReferralSignupsModel.referredClinicId,
  status: ReferralSignupsModel.status,
  signedUpAt: ReferralSignupsModel.signedUpAt,
  joinedAt: ReferralSignupsModel.joinedAt,
  paidAt: ReferralSignupsModel.paidAt,
};

// Joined counts approved clinics, so it includes paid ones; waiting ones count for paging only.
const COUNTS = {
  total: sql<number>`count(*)::int`,
  waiting: sql<number>`count(*) filter (where ${ReferralSignupsModel.status} = 'signed_up')::int`,
  joined: sql<number>`count(*) filter (where ${ReferralSignupsModel.status} in ('joined', 'paid'))::int`,
  paid: sql<number>`count(*) filter (where ${ReferralSignupsModel.status} = 'paid')::int`,
};

type Row = Pick<ReferralSignup, keyof typeof ROW>;

export class ReferralQueryService {
  /** The referrer's own signups, newest first, with Joined/Paid counts. */
  static async mine(referrerUserId: string, query: MyReferralsQuery) {
    const where = eq(ReferralSignupsModel.referrerUserId, referrerUserId);
    const [rows, [counts]] = await Promise.all([
      this.page(where, query.pageNumber, query.pageSize),
      database.select(COUNTS).from(ReferralSignupsModel).where(where),
    ]);
    const { users, clinics } = await this.names(rows, false);
    return {
      counts: {
        waiting: counts?.waiting ?? 0,
        joined: counts?.joined ?? 0,
        paid: counts?.paid ?? 0,
      },
      items: rows.map((row) => ({
        id: row.id,
        name: this.referredName(row, users, clinics),
        status: row.status,
        signedUpAt: row.signedUpAt,
        joinedAt: row.joinedAt,
        paidAt: row.paidAt,
      })),
      total: counts?.total ?? 0,
      pageNumber: query.pageNumber,
      pageSize: query.pageSize,
    };
  }

  /** Every referral across clinics, for Super Admin, with totals for the same filters. */
  static async all(query: SuperadminReferralsQuery) {
    const conditions: SQL[] = [];
    if (query.status) {
      conditions.push(eq(ReferralSignupsModel.status, query.status));
    }
    // Columns are timestamptz, so bound by the IST day explicitly.
    if (query.fromDate) {
      conditions.push(
        gte(
          ReferralSignupsModel.signedUpAt,
          new Date(`${query.fromDate}T00:00:00+05:30`)
        )
      );
    }
    if (query.toDate) {
      conditions.push(
        lte(
          ReferralSignupsModel.signedUpAt,
          new Date(`${query.toDate}T23:59:59.999+05:30`)
        )
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [counts]] = await Promise.all([
      this.page(where, query.pageNumber, query.pageSize),
      database.select(COUNTS).from(ReferralSignupsModel).where(where),
    ]);
    const referrerIds = [...new Set(rows.map((row) => row.referrerUserId))];
    // The referrer's clinic is the one saved on their code when it was created.
    const codeClinics = rows.length
      ? await database
          .select({
            id: ReferralCodesModel.id,
            clinicId: ReferralCodesModel.clinicId,
          })
          .from(ReferralCodesModel)
          .where(
            inArray(ReferralCodesModel.id, [
              ...new Set(rows.map((row) => row.codeId)),
            ])
          )
      : [];
    const codeClinic = new Map(codeClinics.map((c) => [c.id, c.clinicId]));
    const [{ users, clinics }, roles, referrerClinics] = await Promise.all([
      this.names(rows, true),
      getDirectoryPort().getUserRoles(referrerIds),
      getDirectoryPort().getClinicNames([
        ...new Set(
          codeClinics.flatMap((c) => (c.clinicId ? [c.clinicId] : []))
        ),
      ]),
    ]);
    return {
      counts: {
        waiting: counts?.waiting ?? 0,
        joined: counts?.joined ?? 0,
        paid: counts?.paid ?? 0,
      },
      items: rows.map((row) => ({
        id: row.id,
        referrerName: users.get(row.referrerUserId) ?? 'Removed user',
        referrerRole: roles.get(row.referrerUserId) ?? null,
        referrerClinicName:
          referrerClinics.get(codeClinic.get(row.codeId) ?? '') ?? null,
        referredName: this.referredName(row, users, clinics),
        status: row.status,
        signedUpAt: row.signedUpAt,
        joinedAt: row.joinedAt,
        paidAt: row.paidAt,
      })),
      total: counts?.total ?? 0,
      pageNumber: query.pageNumber,
      pageSize: query.pageSize,
    };
  }

  /** Referrer's name for each referred user; users who signed up without a code are left out. */
  static async referrerNames(
    referredUserIds: string[]
  ): Promise<Map<string, string>> {
    if (!referredUserIds.length) return new Map();
    const rows = await database
      .select({
        referredUserId: ReferralSignupsModel.referredUserId,
        referrerUserId: ReferralSignupsModel.referrerUserId,
      })
      .from(ReferralSignupsModel)
      .where(inArray(ReferralSignupsModel.referredUserId, referredUserIds));
    const users = await getDirectoryPort().getUserNames([
      ...new Set(rows.map((row) => row.referrerUserId)),
    ]);
    return new Map(
      rows.map((row) => [
        row.referredUserId,
        users.get(row.referrerUserId) ?? 'Removed user',
      ])
    );
  }

  private static page(
    where: SQL | undefined,
    pageNumber: number,
    pageSize: number
  ): Promise<Row[]> {
    return database
      .select(ROW)
      .from(ReferralSignupsModel)
      .where(where)
      .orderBy(desc(ReferralSignupsModel.signedUpAt))
      .limit(pageSize)
      .offset((pageNumber - 1) * pageSize);
  }

  private static async names(rows: Row[], withReferrer: boolean) {
    const directory = getDirectoryPort();
    const userIds = rows.flatMap((row) =>
      withReferrer
        ? [row.referredUserId, row.referrerUserId]
        : [row.referredUserId]
    );
    const clinicIds = rows.flatMap((row) =>
      row.referredClinicId ? [row.referredClinicId] : []
    );
    const [users, clinics] = await Promise.all([
      directory.getUserNames([...new Set(userIds)]),
      directory.getClinicNames([...new Set(clinicIds)]),
    ]);
    return { users, clinics };
  }

  // A referred clinic is known by its clinic name; fall back to the person.
  private static referredName(
    row: Row,
    users: Map<string, string>,
    clinics: Map<string, string>
  ) {
    return (
      (row.referredClinicId && clinics.get(row.referredClinicId)) ||
      users.get(row.referredUserId) ||
      'Removed user'
    );
  }
}
