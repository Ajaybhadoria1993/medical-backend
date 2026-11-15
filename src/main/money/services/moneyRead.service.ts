import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { database } from '../../../configurations/dbConnection';
import { MoneyEntryModel as E } from '../models/moneyEntry.model';
import { balanceOf, type SourceBalance } from '../utils/money.utils';

const T = alias(E, 'reversed_entry');
const IST_DAY = sql<string>`TO_CHAR(${E.createdAt} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`;
/** A range of IST days for the money screens, with the Doctor, Payment Mode and Service filters. */
export interface MoneyRange {
  clinicId: string;
  /** UTC ISO bounds of the IST days asked for. */
  start: string;
  end: string;
  doctorIds?: string[];
  paymentMode?: string;
  /** The visit's main service (Reports filter); plan money has none, so it drops out. */
  serviceName?: string;
}

/** Received money: payments and plan advances in, refunds out; an adjustment undoes its target.
 *  paid_at_visit is left out: that money is already received on the visit itself. */
const RECEIVED = sql<number>`CASE
  WHEN ${E.entryType} IN ('payment', 'advance') THEN ${E.amountPaise}
  WHEN ${E.entryType} = 'refund' THEN -${E.amountPaise}
  WHEN ${E.entryType} = 'adjustment' AND ${T.entryType} = 'payment' THEN -${E.amountPaise}
  WHEN ${E.entryType} = 'adjustment' AND ${T.entryType} = 'refund' THEN ${E.amountPaise}
  ELSE 0 END`;
const GROSS = sql<number>`CASE
  WHEN ${E.entryType} IN ('payment', 'advance') THEN ${E.amountPaise}
  WHEN ${E.entryType} = 'adjustment' AND ${T.entryType} = 'payment' THEN -${E.amountPaise}
  ELSE 0 END`;

export interface MoneyTotals {
  grossPaise: number;
  refundsPaise: number;
  netPaise: number;
  payments: number;
  refundsCount: number;
  byModePaise: Record<string, number>;
  bySourcePaise: Record<string, number>;
  /** Money in only (payments, advances) per source, before refunds. */
  grossBySourcePaise: Record<string, number>;
  /** Plan money is desk money. */
  byChannel: Record<
    'desk' | 'online',
    { grossPaise: number; netPaise: number }
  >;
}

/** The one reader of money for every screen: appointments and treatment plans in one ledger. */
export class MoneyReadService {
  private static where(r: MoneyRange): SQL {
    return and(
      eq(E.clinicId, r.clinicId),
      eq(E.account, 'clinic'),
      gte(E.createdAt, new Date(r.start)),
      lte(E.createdAt, new Date(r.end)),
      r.doctorIds?.length ? inArray(E.doctorId, r.doctorIds) : undefined,
      r.paymentMode
        ? sql`LOWER(${E.paymentMode}) = LOWER(${r.paymentMode})`
        : undefined,
      r.serviceName
        ? sql`${E.sourceType} = 'appointment' AND EXISTS (SELECT 1 FROM appointments a
            JOIN clinics_service cs ON cs.id = a.clinic_service_id
            WHERE a.id = ${E.sourceId} AND cs.service_name = ${r.serviceName})`
        : undefined
    )!;
  }

  private static base() {
    return database
      .select()
      .from(E)
      .leftJoin(T, eq(T.id, E.reversesEntryId))
      .$dynamic();
  }

  static async totals(r: MoneyRange): Promise<MoneyTotals> {
    const rows = await database
      .select({
        mode: E.paymentMode,
        source: E.sourceType,
        channel: E.channel,
        net: sql<string>`COALESCE(SUM(${RECEIVED}), 0)`,
        gross: sql<string>`COALESCE(SUM(${GROSS}), 0)`,
        payments: sql<number>`COUNT(*) FILTER (WHERE ${E.entryType} IN ('payment', 'advance'))::int`,
        refundsCount: sql<number>`COUNT(*) FILTER (WHERE ${E.entryType} = 'refund')::int`,
      })
      .from(E)
      .leftJoin(T, eq(T.id, E.reversesEntryId))
      .where(this.where(r))
      .groupBy(E.paymentMode, E.sourceType, E.channel);
    const out: MoneyTotals = {
      grossPaise: 0,
      refundsPaise: 0,
      netPaise: 0,
      payments: 0,
      refundsCount: 0,
      byModePaise: {},
      bySourcePaise: {},
      grossBySourcePaise: {},
      byChannel: {
        desk: { grossPaise: 0, netPaise: 0 },
        online: { grossPaise: 0, netPaise: 0 },
      },
    };
    const add = (
      mode: string | null,
      source: string,
      gross: number,
      net: number,
      count: number,
      refunds: number
    ) => {
      out.grossPaise += gross;
      out.netPaise += net;
      out.payments += count;
      out.refundsCount += refunds;
      const m = mode || 'Unknown';
      out.byModePaise[m] = (out.byModePaise[m] ?? 0) + net;
      out.bySourcePaise[source] = (out.bySourcePaise[source] ?? 0) + net;
      out.grossBySourcePaise[source] =
        (out.grossBySourcePaise[source] ?? 0) + gross;
    };
    for (const x of rows) {
      add(
        x.mode,
        x.source,
        Number(x.gross),
        Number(x.net),
        Number(x.payments),
        Number(x.refundsCount || 0)
      );
      out.byChannel[x.channel].grossPaise += Number(x.gross);
      out.byChannel[x.channel].netPaise += Number(x.net);
    }
    out.refundsPaise = out.grossPaise - out.netPaise;
    return out;
  }

  /** Still owed on visits whose charges fall in the range; visits that never happened owe nothing. */
  static async outstanding(
    r: MoneyRange
  ): Promise<{ duePaise: number; visits: number; planDuePaise: number }> {
    // Visit dues and plan dues are independent, so both queries run together.
    // A plan has no clinic service, so a service filter leaves plans out.
    const [visitRows, planDuePaise] = await Promise.all([
      database.execute(sql`
      WITH s AS (
        SELECT e.source_id,
          SUM(CASE
            WHEN e.entry_type = 'charge' THEN e.amount_paise
            WHEN e.entry_type IN ('payment', 'write_off') THEN -e.amount_paise
            WHEN e.entry_type = 'refund' THEN e.amount_paise
            WHEN e.entry_type = 'adjustment' AND t.entry_type = 'charge' THEN -e.amount_paise
            WHEN e.entry_type = 'adjustment' AND t.entry_type IN ('payment', 'write_off') THEN e.amount_paise
            WHEN e.entry_type = 'adjustment' AND t.entry_type = 'refund' THEN -e.amount_paise
            ELSE 0 END) AS due
        FROM money_entries e LEFT JOIN money_entries t ON t.id = e.reverses_entry_id
        WHERE e.clinic_id = ${r.clinicId} AND e.account = 'clinic' AND e.source_type = 'appointment'
          AND e.source_id IN (SELECT source_id FROM money_entries
            WHERE clinic_id = ${r.clinicId} AND entry_type = 'charge'
              AND created_at BETWEEN ${r.start} AND ${r.end}
              ${r.serviceName ? sql`AND source_id IN (SELECT a.id FROM appointments a JOIN clinics_service cs ON cs.id = a.clinic_service_id WHERE cs.service_name = ${r.serviceName})` : sql``}
              ${
                r.doctorIds?.length
                  ? sql`AND doctor_id IN (${sql.join(
                      r.doctorIds.map((d) => sql`${d}`),
                      sql`, `
                    )})`
                  : sql``
              })
        GROUP BY e.source_id)
      SELECT COALESCE(SUM(due) FILTER (WHERE due > 0), 0) AS due, COUNT(*) FILTER (WHERE due > 0)::int AS visits FROM s`),
      r.serviceName ? Promise.resolve(0) : this.planDue(r),
    ]);
    const [row] = visitRows as unknown as { due: string; visits: number }[];
    // Plan dues add in, so every dues figure counts them; planDuePaise lets a screen say so.
    return {
      duePaise: Number(row?.due ?? 0) + planDuePaise,
      visits: row?.visits ?? 0,
      planDuePaise,
    };
  }

  /** Owed now on plans charged in the range: charged - paid - written off (planBalance's rule). */
  private static async planDue(r: MoneyRange): Promise<number> {
    const doctors = r.doctorIds?.length
      ? sql`AND doctor_id IN (${sql.join(
          r.doctorIds.map((d) => sql`${d}`),
          sql`, `
        )})`
      : sql``;
    const [row] = (await database.execute(sql`
      WITH p AS (
        SELECT SUM(CASE
            WHEN e.entry_type = 'charge' THEN e.amount_paise
            WHEN e.entry_type IN ('payment', 'advance', 'paid_at_visit', 'write_off') THEN -e.amount_paise
            WHEN e.entry_type IN ('refund', 'adjustment') THEN e.amount_paise
            ELSE 0 END) AS due
        FROM money_entries e
        WHERE e.clinic_id = ${r.clinicId} AND e.account = 'clinic' AND e.source_type = 'treatment_plan'
          AND e.source_id IN (SELECT source_id FROM money_entries
            WHERE clinic_id = ${r.clinicId} AND source_type = 'treatment_plan' AND entry_type = 'charge'
              AND created_at BETWEEN ${r.start} AND ${r.end} ${doctors})
        GROUP BY e.source_id)
      SELECT COALESCE(SUM(due) FILTER (WHERE due > 0), 0) AS due FROM p`)) as unknown as {
      due: string;
    }[];
    return Number(row?.due ?? 0);
  }

  /** Net received grouped by doctor name, service name or IST day, split by channel (paise). */
  static async receivedGrouped(
    r: MoneyRange,
    by: 'doctor' | 'service' | 'day' | 'type'
  ): Promise<{ key: string; channel: 'desk' | 'online'; paise: number }[]> {
    const key =
      by === 'doctor'
        ? sql`COALESCE(u.name, 'Unassigned')`
        : by === 'service'
          ? sql`CASE WHEN e.source_type = 'treatment_plan' THEN 'Treatment plans' ELSE COALESCE(cs.service_name, 'Unassigned') END`
          : by === 'type'
            ? sql`CASE WHEN e.source_type = 'treatment_plan' THEN 'Treatment plans' ELSE INITCAP(COALESCE(a.appointment_type, 'Other')) END`
            : sql`TO_CHAR(e.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`;
    const rows = (await database.execute(sql`
      SELECT ${key} AS key, e.channel,
        SUM(CASE
          WHEN e.entry_type IN ('payment', 'advance') THEN e.amount_paise
          WHEN e.entry_type = 'refund' THEN -e.amount_paise
          WHEN e.entry_type = 'adjustment' AND t.entry_type = 'payment' THEN -e.amount_paise
          WHEN e.entry_type = 'adjustment' AND t.entry_type = 'refund' THEN e.amount_paise
          ELSE 0 END) AS paise
      FROM money_entries e
      LEFT JOIN money_entries t ON t.id = e.reverses_entry_id
      LEFT JOIN users u ON u.id = e.doctor_id
      LEFT JOIN appointments a ON e.source_type = 'appointment' AND a.id = e.source_id
      LEFT JOIN clinics_service cs ON cs.id = a.clinic_service_id
      WHERE e.clinic_id = ${r.clinicId} AND e.account = 'clinic' AND e.created_at BETWEEN ${r.start} AND ${r.end}
        ${r.serviceName ? sql`AND e.source_type = 'appointment' AND cs.service_name = ${r.serviceName}` : sql``}
        ${r.paymentMode ? sql`AND LOWER(e.payment_mode) = LOWER(${r.paymentMode})` : sql``}
        ${
          r.doctorIds?.length
            ? sql`AND e.doctor_id IN (${sql.join(
                r.doctorIds.map((d) => sql`${d}`),
                sql`, `
              )})`
            : sql``
        }
      GROUP BY 1, 2`)) as unknown as {
      key: string;
      channel: 'desk' | 'online';
      paise: string;
    }[];
    const out = rows.map((x) => ({
      key: x.key,
      channel: x.channel,
      paise: Number(x.paise),
    }));
    return out;
  }

  /** Net or gross (before refunds) per day / week / month bucket of the IST day (paise). */
  static async buckets(
    r: MoneyRange,
    unit: 'day' | 'week' | 'month',
    kind: 'net' | 'gross'
  ): Promise<{ dt: string; paise: number }[]> {
    const dt = sql<string>`date_trunc(${sql.raw(`'${unit}'`)}, ${E.createdAt} AT TIME ZONE 'Asia/Kolkata')`;
    const rows = await database
      .select({
        dt,
        v: sql<string>`COALESCE(SUM(${kind === 'net' ? RECEIVED : GROSS}), 0)`,
      })
      .from(E)
      .leftJoin(T, eq(T.id, E.reversesEntryId))
      .where(this.where(r))
      .groupBy(dt);
    return rows.map((x) => ({ dt: x.dt, paise: Number(x.v) }));
  }

  /** Per IST day and payment mode: net received and refunds (paise), for the revenue chart. */
  static async byDayAndMode(
    r: MoneyRange
  ): Promise<
    { day: string; mode: string; netPaise: number; refundsPaise: number }[]
  > {
    const REFUNDED = sql<number>`CASE
      WHEN ${E.entryType} = 'refund' THEN ${E.amountPaise}
      WHEN ${E.entryType} = 'adjustment' AND ${T.entryType} = 'refund' THEN -${E.amountPaise}
      ELSE 0 END`;
    const rows = await database
      .select({
        day: IST_DAY,
        mode: E.paymentMode,
        net: sql<string>`COALESCE(SUM(${RECEIVED}), 0)`,
        refunds: sql<string>`COALESCE(SUM(${REFUNDED}), 0)`,
      })
      .from(E)
      .leftJoin(T, eq(T.id, E.reversesEntryId))
      .where(this.where(r))
      .groupBy(IST_DAY, E.paymentMode);
    return rows
      .filter((x) => Number(x.net) || Number(x.refunds))
      .map((x) => ({
        day: x.day,
        mode: x.mode || 'Unknown',
        netPaise: Number(x.net),
        refundsPaise: Number(x.refunds),
      }));
  }

  /** Net received per IST day ('YYYY-MM-DD' → paise). */
  static async byDay(r: MoneyRange): Promise<Record<string, number>> {
    const rows = await database
      .select({ day: IST_DAY, net: sql<string>`COALESCE(SUM(${RECEIVED}), 0)` })
      .from(E)
      .leftJoin(T, eq(T.id, E.reversesEntryId))
      .where(this.where(r))
      .groupBy(IST_DAY);
    const out: Record<string, number> = {};
    for (const x of rows) out[x.day] = Number(x.net);
    return out;
  }

  /** Net received per doctor (paise). */
  static async byDoctor(r: MoneyRange): Promise<Record<string, number>> {
    const rows = await database
      .select({
        doctorId: E.doctorId,
        net: sql<string>`COALESCE(SUM(${RECEIVED}), 0)`,
      })
      .from(E)
      .leftJoin(T, eq(T.id, E.reversesEntryId))
      .where(this.where(r))
      .groupBy(E.doctorId);
    const out: Record<string, number> = {};
    for (const x of rows) if (x.doctorId) out[x.doctorId] = Number(x.net);
    return out;
  }

  /** All money one patient has paid, split into visits and treatment plans; one clinic, or all of them. */
  static async receivedByPatient(
    patientId: string,
    clinicId?: string
  ): Promise<{ visitPaise: number; planPaise: number }> {
    const rows = await database
      .select({
        source: E.sourceType,
        net: sql<string>`COALESCE(SUM(${RECEIVED}), 0)`,
      })
      .from(E)
      .leftJoin(T, eq(T.id, E.reversesEntryId))
      .where(
        and(
          eq(E.patientId, patientId),
          eq(E.account, 'clinic'),
          clinicId ? eq(E.clinicId, clinicId) : undefined
        )
      )
      .groupBy(E.sourceType);
    const of = (s: string) =>
      Number(rows.find((x) => x.source === s)?.net ?? 0);
    return {
      visitPaise: of('appointment'),
      planPaise: of('treatment_plan'),
    };
  }

  /** Payments and refunds in the range, newest first, from every source. */
  static async entries(r: MoneyRange) {
    const rows = await this.base()
      .where(
        and(
          this.where(r),
          sql`(${E.entryType} IN ('payment', 'refund', 'advance') OR (${E.entryType} = 'adjustment' AND ${T.entryType} IN ('payment', 'refund')))`
        )
      )
      .orderBy(desc(E.createdAt));
    // Plan rows are labelled with their plan, as Payment History shows them.
    const planIds = [
      ...new Set(
        rows
          .filter((x) => x.money_entries.sourceType === 'treatment_plan')
          .map((x) => x.money_entries.sourceId)
      ),
    ];
    const titles = new Map<string, string>();
    if (planIds.length)
      for (const p of (await database.execute(
        sql`SELECT id, title FROM treatment_plans WHERE id IN (${sql.join(
          planIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      )) as unknown as { id: string; title: string }[])
        titles.set(p.id, p.title);
    const PLAN_LABEL: Record<string, string> = {
      advance: 'Advance',
      payment: 'Payment',
      refund: 'Refund',
    };
    return rows.map(({ money_entries: x, reversed_entry: t }) => ({
      id: x.id,
      sourceType: x.sourceType as string,
      sourceId: x.sourceId,
      label:
        x.sourceType === 'treatment_plan'
          ? `Treatment plan: ${titles.get(x.sourceId) ?? 'Plan'} (${PLAN_LABEL[x.entryType] ?? 'Correction'})`
          : '',
      // Scoped to one clinic, so never a lab row: clinic rows always carry a patient.
      patientId: x.patientId!,
      doctorId: x.doctorId,
      // A correction moves money the opposite way to the entry it corrects; an advance is money in.
      type: (x.entryType === 'adjustment'
        ? t?.entryType === 'payment'
          ? 'refund'
          : 'payment'
        : x.entryType === 'refund'
          ? 'refund'
          : 'payment') as 'payment' | 'refund',
      correction: x.entryType === 'adjustment',
      reason: x.reason,
      gatewayRef: x.gatewayRef,
      channel: x.channel as string,
      amountPaise: x.amountPaise,
      paymentMode: x.paymentMode,
      receiptNo: x.receiptNo,
      createdAt: x.createdAt,
    }));
  }

  /** One visit's or plan's figures (ledger sources only). */
  /** Refunds per visit for the appointment screens, in the old field shape (rupees as text). */
  static async refundsOf(appointmentIds: string[]) {
    const out = new Map<
      string,
      {
        refundedAmount: string;
        refundMode: string | null;
        refundNotes: string | null;
      }
    >();
    if (!appointmentIds.length) return out;
    const rows = await database
      .select({
        id: E.sourceId,
        paise: sql<number>`SUM(CASE WHEN ${E.entryType} = 'refund' THEN ${E.amountPaise}
          WHEN ${E.entryType} = 'adjustment' AND ${T.entryType} = 'refund' THEN -${E.amountPaise} ELSE 0 END)::bigint`,
        mode: sql<
          string | null
        >`(ARRAY_AGG(${E.paymentMode} ORDER BY ${E.createdAt} DESC) FILTER (WHERE ${E.entryType} = 'refund'))[1]`,
        notes: sql<
          string | null
        >`(ARRAY_AGG(${E.reason} ORDER BY ${E.createdAt} DESC) FILTER (WHERE ${E.entryType} = 'refund'))[1]`,
      })
      .from(E)
      .leftJoin(T, eq(T.id, E.reversesEntryId))
      .where(
        and(
          eq(E.sourceType, 'appointment'),
          inArray(E.sourceId, appointmentIds),
          eq(E.account, 'clinic'),
          sql`(${E.entryType} = 'refund' OR (${E.entryType} = 'adjustment' AND ${T.entryType} = 'refund'))`
        )
      )
      .groupBy(E.sourceId);
    for (const r of rows)
      out.set(r.id, {
        refundedAmount: (Number(r.paise) / 100).toFixed(2),
        refundMode: r.mode,
        refundNotes: r.notes,
      });
    return out;
  }

  static async balance(
    sourceType: 'appointment' | 'treatment_plan',
    sourceId: string
  ): Promise<SourceBalance> {
    const rows = await database
      .select({
        id: E.id,
        entryType: E.entryType,
        amountPaise: E.amountPaise,
        reversesEntryId: E.reversesEntryId,
      })
      .from(E)
      .where(
        and(
          eq(E.sourceType, sourceType),
          eq(E.sourceId, sourceId),
          eq(E.account, 'clinic')
        )
      );
    return balanceOf(rows);
  }
}
