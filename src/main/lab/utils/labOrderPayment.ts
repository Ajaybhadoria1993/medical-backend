import { eq, getTableColumns, sql } from 'drizzle-orm';
import { LabOrderModel } from '../../test/models/labOrder.model';
import {
  LabMoneyService,
  type LabMoneyRow,
  type LabPaymentStatus,
  type LabRowStatus,
} from '../../money';
import type { DbTransaction } from '../services/labCatalog.service';

/**
 * Payment fields used to be columns on lab_orders, then rows in
 * lab_updated_payments; they now live in money_entries (source lab_test).
 * These correlated projections keep the old flat API shape.
 */
const ledgerColumns = LabMoneyService.columns(
  'lab_test',
  sql.raw('"lab_orders"."id"')
);

export const labOrderPaymentColumns = {
  price: ledgerColumns.price,
  paymentStatus: ledgerColumns.paymentStatus,
  // Lab test money is always the 'test' payment type; the source type says so.
  paymentType: sql<string>`'test'`,
  paymentMode: ledgerColumns.paymentMode,
  paymentNotes: ledgerColumns.paymentNotes,
};

export const labOrderWithPaymentColumns = {
  ...getTableColumns(LabOrderModel),
  ...labOrderPaymentColumns,
};

/** Kept out of labOrderPaymentColumns so the selects that spread those gain no field. */
export const labOrderRefundedAmountColumn = ledgerColumns.refundedAmount;

export type LabOrderPayment = {
  id: string;
  labOrderId: string;
  price: number;
  paymentStatus: LabRowStatus;
  paymentType: string;
  paymentMode: string | null;
  paymentNotes: string | null;
  /** Set on a refund. */
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// The ledger keeps no updatedAt; createdAt stands in so the response shape is unchanged.
const toPayment = (row: LabMoneyRow): LabOrderPayment => ({
  id: row.id,
  labOrderId: row.sourceId,
  price: row.price,
  paymentStatus: row.paymentStatus,
  paymentType: 'test',
  paymentMode: row.paymentMode,
  paymentNotes: row.paymentNotes,
  reason: row.reason,
  createdAt: row.createdAt,
  updatedAt: row.createdAt,
});

/** A payment record, never a refund: what insert, update and latest hand back. */
export type LabOrderPaymentRecord = LabOrderPayment & {
  paymentStatus: LabPaymentStatus;
};
const toRecord = (row: LabMoneyRow) => toPayment(row) as LabOrderPaymentRecord;

export type LabOrderPaymentInsert = {
  labOrderId: string;
  /** For the lab's receipt series. */
  labId: string;
  createdBy: string;
  /** Looked up from the order when not passed. */
  patientId?: string | null;
  price?: number | null;
  paymentStatus?: LabPaymentStatus;
  paymentMode?: string | null;
  paymentNotes?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};

const getOrderPatientId = async (trx: DbTransaction, labOrderId: string) => {
  const [order] = await trx
    .select({ patientId: LabOrderModel.patientId })
    .from(LabOrderModel)
    .where(eq(LabOrderModel.id, labOrderId))
    .limit(1);
  return order?.patientId ?? null;
};

export async function insertLabOrderPayment(
  trx: DbTransaction,
  values: LabOrderPaymentInsert
): Promise<LabOrderPaymentRecord[]> {
  const row = await LabMoneyService.insert(trx, {
    sourceType: 'lab_test',
    sourceId: values.labOrderId,
    labId: values.labId,
    patientId:
      values.patientId !== undefined
        ? values.patientId
        : await getOrderPatientId(trx, values.labOrderId),
    price: values.price,
    paymentStatus: values.paymentStatus ?? 'pending',
    paymentMode: values.paymentMode,
    paymentNotes: values.paymentNotes,
    createdBy: values.createdBy,
    createdAt: values.createdAt ?? values.updatedAt ?? new Date(),
  });
  return [toRecord(row)];
}

export type LabOrderPaymentUpdate = {
  labId: string;
  price?: number | null;
  paymentStatus?: LabPaymentStatus;
  paymentMode?: string | null;
  paymentNotes?: string | null;
  updatedAt?: Date;
};

export async function updateLabOrderPayment(
  trx: DbTransaction,
  paymentId: string,
  values: LabOrderPaymentUpdate
): Promise<LabOrderPaymentRecord[]> {
  const row = await LabMoneyService.update(trx, paymentId, values.labId, {
    price: values.price,
    paymentStatus: values.paymentStatus,
    paymentMode: values.paymentMode,
    paymentNotes: values.paymentNotes,
  });
  return row ? [toRecord(row)] : [];
}

/**
 * Backward-compatible update-or-insert behavior for appointment payment flows.
 * Lab-order payment transactions use insertLabOrderPayment instead.
 */
export async function upsertLabOrderPayment(
  trx: DbTransaction,
  values: LabOrderPaymentInsert
) {
  const existing = await getLabOrderPayment(trx, values.labOrderId);

  if (!existing) {
    return insertLabOrderPayment(trx, values);
  }

  return updateLabOrderPayment(trx, existing.id, values);
}

/** The latest payment record for the order; a refund is never it. */
export async function getLabOrderPayment(
  trx: DbTransaction,
  labOrderId: string
): Promise<LabOrderPaymentRecord | null> {
  const row = await LabMoneyService.latest(trx, 'lab_test', labOrderId);
  return row ? toRecord(row) : null;
}

/** Every payment and refund row for the orders, oldest first. */
export async function getLabOrderPayments(
  trx: DbTransaction,
  labOrderIds: string[]
): Promise<LabOrderPayment[]> {
  const rows = await LabMoneyService.list(trx, 'lab_test', labOrderIds);
  return rows.map(toPayment);
}
