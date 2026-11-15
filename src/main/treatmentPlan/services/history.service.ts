import type { database } from '../../../configurations/dbConnection';
import { TreatmentPlanHistoryModel } from '../models/treatmentPlanHistory.model';
import type {
  HistoryAction,
  HistoryMetaByAction,
} from '../types/history.types';

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];

type Entry<A extends HistoryAction> = {
  clinicId: string | null;
  actorId: string | null;
  action: A;
  meta: HistoryMetaByAction[A];
  fromValue?: string | null;
  toValue?: string | null;
  reason?: string | null;
  notes?: string | null;
} & (
  | { planId: string; templateId?: never }
  | { templateId: string; planId?: never }
);

export class TreatmentHistoryService {
  /** Writes inside the caller's transaction, so the event and the change commit together. */
  static async record<A extends HistoryAction>(
    tx: Tx,
    entry: Entry<A>
  ): Promise<void> {
    await tx.insert(TreatmentPlanHistoryModel).values(entry);
  }
}
