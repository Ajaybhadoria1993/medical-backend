import { sql, type SQL } from 'drizzle-orm';
import type { database } from '../../../../configurations/dbConnection';
import { MoneyWriteService, type EntryType } from '../../../money';
import type { TreatmentPlan } from '../../models/treatmentPlan.model';

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];
type Db = Tx | typeof database;

/** A plan's due now in paise, same rule as planBalance: charged - paid - written off.
 *  Plan adjustments only ever undo a paid-at-visit (releaseVisitPayment), so they add back to due. */
export const planDuePaise = (
  planId: SQL | string
) => sql<number>`(select coalesce(sum(case
  when d.entry_type = 'charge' then d.amount_paise
  when d.entry_type in ('advance', 'payment', 'paid_at_visit', 'write_off') then -d.amount_paise
  when d.entry_type = 'refund' then d.amount_paise
  when d.entry_type = 'adjustment' then d.amount_paise else 0 end), 0)::bigint
  from money_entries d where d.account = 'clinic' and d.source_type = 'treatment_plan' and d.source_id = ${planId})`;

/** What the patient still has to pay on the whole plan in paise, same rule as planBalance.leftToPay. */
export const planLeftToPayPaise = (
  planId: SQL | string
) => sql<number>`(select greatest(0, round(p.total_amount * 100) - coalesce(sum(case
  when d.entry_type in ('advance', 'payment', 'paid_at_visit', 'write_off') then d.amount_paise
  when d.entry_type in ('refund', 'adjustment') then -d.amount_paise else 0 end), 0))::bigint
  from treatment_plans p left join money_entries d
    on d.account = 'clinic' and d.source_type = 'treatment_plan' and d.source_id = p.id
  where p.id = ${planId} group by p.total_amount)`;

export interface PlanMoneyInput {
  entryType: EntryType;
  amountPaise: number;
  /** The plan step it is for (a step charge, paid-at-visit). */
  stepId?: string | null;
  paymentMode?: string | null;
  reason?: string | null;
  /** The form's id, or a key the server builds for its own entries (a step charge). */
  requestId: string;
  approvedBy?: string | null;
  /** A refund: the payment it gives back. */
  reversesEntryId?: string | null;
  createdBy: string;
}

/** A plan's money lives in the clinic ledger (money_entries, source treatment_plan): same lock,
 *  retry safety, paise and receipt series as appointments. Plan-only limits stay in PlanLedgerService. */
export class PlanMoneyStore {
  static entries(db: Db, planId: string) {
    return MoneyWriteService.entriesOf(db, 'treatment_plan', planId);
  }

  /** Paise per entry type. */
  static async sums(db: Db, planId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    const rows = await this.entries(db, planId);
    const byId = new Map(rows.map((e) => [e.id, e]));
    for (const e of rows) {
      // An adjustment undoes part of its target, so it counts against the target's type.
      const target =
        e.entryType === 'adjustment' && e.reversesEntryId
          ? byId.get(e.reversesEntryId)
          : null;
      const type = target ? target.entryType : e.entryType;
      out[type] = (out[type] ?? 0) + (target ? -e.amountPaise : e.amountPaise);
    }
    return out;
  }

  /** The entry an earlier try of this request made, so a retry returns the first result. */
  static repeat(db: Db, clinicId: string, requestId: string) {
    return MoneyWriteService.findByRequest(db, clinicId, requestId);
  }

  static record(tx: Tx, plan: TreatmentPlan, m: PlanMoneyInput) {
    return MoneyWriteService.record(tx, {
      clinicId: plan.clinicId,
      patientId: plan.patientId,
      doctorId: plan.doctorId,
      sourceType: 'treatment_plan',
      sourceId: plan.id,
      lineRef: m.stepId ?? null,
      entryType: m.entryType,
      amountPaise: m.amountPaise,
      paymentMode: m.paymentMode ?? null,
      // Plan money is taken at the desk.
      channel: 'desk',
      requestId: m.requestId,
      reason: m.reason ?? null,
      approvedBy: m.approvedBy ?? null,
      reversesEntryId: m.reversesEntryId ?? null,
      createdBy: m.createdBy,
    });
  }
}
