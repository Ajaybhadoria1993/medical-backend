import {
  LabMoneyService,
  type LabPaymentStatus,
  type LabRowStatus,
} from '../../money';
import type { DbTransaction } from '../services/labCatalog.service';

export type HomeCollectionPaymentInsert = {
  homeCollectionId: string;
  labId: string;
  patientId: string;
  createdBy: string;
  price?: number | null;
  paymentStatus?: LabPaymentStatus;
  paymentMode?: string | null;
  paymentNotes?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export async function insertHomeCollectionPayment(
  trx: DbTransaction,
  values: HomeCollectionPaymentInsert
) {
  const row = await LabMoneyService.insert(trx, {
    sourceType: 'lab_home_collection',
    sourceId: values.homeCollectionId,
    labId: values.labId,
    patientId: values.patientId,
    price: values.price,
    paymentStatus: values.paymentStatus ?? 'pending',
    paymentMode: values.paymentMode,
    paymentNotes: values.paymentNotes,
    createdBy: values.createdBy,
    createdAt: values.createdAt ?? values.updatedAt ?? new Date(),
  });
  return [{ ...row, homeCollectionId: row.sourceId }];
}

export type HomeCollectionPaymentEntry = {
  id: string;
  price: number;
  paymentStatus: LabRowStatus;
  paymentMode: string | null;
  paymentNotes: string | null;
  reason: string | null;
  createdAt: Date;
};

export type HomeCollectionPaymentSummary = {
  /** The latest payment record's amount (a refund never replaces it). */
  paidAmount: number | null;
  paymentStatus: LabRowStatus;
  paymentMode: string | null;
  paymentNotes: string | null;
  refundedAmount: number;
  /** Every payment and refund row, oldest first — same list a test's payments[] shows. */
  payments: HomeCollectionPaymentEntry[];
};

/** Per home collection; a missing id has no payment yet. */
export async function getLatestHomeCollectionPayments(
  trx: DbTransaction,
  homeCollectionIds: string[]
) {
  const rows = await LabMoneyService.list(
    trx,
    'lab_home_collection',
    homeCollectionIds
  );
  const summaries = new Map<string, HomeCollectionPaymentSummary>();
  const paidById = new Map<string, number>();
  // Oldest first, so the last payment record per id is its latest.
  for (const row of rows) {
    const summary = summaries.get(row.sourceId) ?? {
      paidAmount: null,
      paymentStatus: 'pending',
      paymentMode: null,
      paymentNotes: null,
      refundedAmount: 0,
      payments: [],
    };
    summary.payments.push({
      id: row.id,
      price: row.price,
      paymentStatus: row.paymentStatus,
      paymentMode: row.paymentMode,
      paymentNotes: row.paymentNotes,
      reason: row.reason,
      createdAt: row.createdAt,
    });
    if (row.paymentStatus === 'refunded') {
      summary.refundedAmount += row.price;
    } else {
      summary.paidAmount = row.price;
      summary.paymentStatus = row.paymentStatus;
      summary.paymentMode = row.paymentMode;
      summary.paymentNotes = row.paymentNotes;
      if (row.paymentStatus === 'paid')
        paidById.set(
          row.sourceId,
          (paidById.get(row.sourceId) ?? 0) + row.price
        );
    }
    summaries.set(row.sourceId, summary);
  }
  for (const [id, summary] of summaries) {
    if (
      summary.refundedAmount > 0 &&
      summary.refundedAmount >= (paidById.get(id) ?? 0)
    )
      summary.paymentStatus = 'refunded';
  }
  return summaries;
}
