import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { MessageLogModel } from '../../models/messageLog.model';
import { getClinicPort, getPlanPort } from '../../ports';
import type { CostReportQuery } from '../../types/requests.types';
import { istDateRange } from '../../utils/billingPeriod.utils';

// Counts per row; refunded messages are counted once, under `refunded`, not as used.
const counts = {
  messages: sql<number>`count(*)::int`,
  free: sql<number>`count(*) filter (where ${MessageLogModel.paidWith} = 'plan' and ${MessageLogModel.refundedAt} is null)::int`,
  credit: sql<number>`count(*) filter (where ${MessageLogModel.paidWith} = 'credit' and ${MessageLogModel.refundedAt} is null)::int`,
  unlimited: sql<number>`count(*) filter (where ${MessageLogModel.paidWith} = 'unlimited' and ${MessageLogModel.refundedAt} is null)::int`,
  refunded: sql<number>`count(*) filter (where ${MessageLogModel.refundedAt} is not null)::int`,
  costInr: sql<string>`coalesce(sum(${MessageLogModel.costInr}), 0)::numeric(14,4)::text`,
};

export class CostReportService {
  /** Messages and real Meta cost per clinic for IST days from..to, costliest first. */
  static async build(query: CostReportQuery) {
    const { start, end } = istDateRange(query.from, query.to);
    const where = and(
      eq(MessageLogModel.channel, query.creditType),
      gte(MessageLogModel.sentAt, start),
      lt(MessageLogModel.sentAt, end)
    );

    const [rows, [totals], [clinicCount], plansWithoutLimit] =
      await Promise.all([
        database
          .select({ clinicId: MessageLogModel.clinicId, ...counts })
          .from(MessageLogModel)
          .where(where)
          .groupBy(MessageLogModel.clinicId)
          // coalesce: in DESC order Postgres puts NULL sums (no cost yet) first.
          .orderBy(
            desc(sql`coalesce(sum(${MessageLogModel.costInr}), 0)`),
            desc(sql`count(*)`)
          )
          .limit(query.pageSize)
          .offset((query.pageNumber - 1) * query.pageSize),
        database.select(counts).from(MessageLogModel).where(where),
        database
          .select({
            total: sql<number>`count(distinct ${MessageLogModel.clinicId})::int`,
          })
          .from(MessageLogModel)
          .where(where),
        getPlanPort().getPlansWithoutMessageLimit(query.creditType),
      ]);

    const names = await getClinicPort().getClinicNames(
      rows.map((r) => r.clinicId)
    );

    return {
      from: query.from,
      to: query.to,
      creditType: query.creditType,
      totals,
      clinics: {
        items: rows.map((r) => ({
          ...r,
          clinicName: names.get(r.clinicId) ?? 'Removed clinic',
        })),
        total: clinicCount?.total ?? 0,
        pageNumber: query.pageNumber,
        pageSize: query.pageSize,
      },
      plansWithoutLimit,
    };
  }
}
