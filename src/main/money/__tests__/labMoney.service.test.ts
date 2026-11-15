import { LabMoneyService } from '../services/labMoney.service';

type Stored = {
  id: string;
  sourceId: string;
  amountPaise: number;
  entryType: string;
  reason: string | null;
  receiptNo: string | null;
  paymentMode: string | null;
  paymentNotes: string | null;
  createdAt: Date;
};

/** A transaction double: records what is written and echoes it back like `.returning()`. */
function fakeTx(current?: Stored, receiptLastNo = 7) {
  const inserted: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const tx = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return {
          // The lab receipt counter.
          onConflictDoUpdate: () => ({
            returning: async () => [{ lastNo: receiptLastNo }],
          }),
          returning: async () => [{ id: 'entry-1', ...v }],
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (current ? [current] : []) }),
      }),
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        updates.push(s);
        return {
          where: () => ({ returning: async () => [{ ...current, ...s }] }),
        };
      },
    }),
  };
  return { tx: tx as never, inserted, updates };
}

const base = {
  sourceType: 'lab_test' as const,
  sourceId: 'order-1',
  labId: 'lab-1',
  patientId: 'patient-1',
  createdBy: 'user-1',
};

// The entry write is the last insert; a paid one is preceded by the receipt counter.
const entryWrite = (inserted: Record<string, unknown>[]) =>
  inserted[inserted.length - 1];

describe('LabMoneyService.insert', () => {
  it('writes a paid lab payment as a payment with a lab receipt and no clinic', async () => {
    const { tx, inserted } = fakeTx();
    const row = await LabMoneyService.insert(tx, {
      ...base,
      price: 90,
      paymentStatus: 'paid',
      paymentMode: 'CASH',
      paymentNotes: 'Paid at counter',
    });

    expect(entryWrite(inserted)).toMatchObject({
      clinicId: null,
      requestId: null,
      gatewayRef: null,
      channel: 'desk',
      entryType: 'payment',
      reason: null,
      amountPaise: 9000,
      paymentMode: 'CASH',
      paymentNotes: 'Paid at counter',
      createdBy: 'user-1',
    });
    expect(entryWrite(inserted).receiptNo).toMatch(/^L-\d{4}-000007$/);
    expect(row).toMatchObject({ price: 90, paymentStatus: 'paid' });
  });

  it('keeps a pending amount as a charge with no receipt, allowing ₹0', async () => {
    const { tx, inserted } = fakeTx();
    const row = await LabMoneyService.insert(tx, {
      ...base,
      price: 0,
      paymentStatus: 'pending',
    });

    expect(inserted).toHaveLength(1);
    expect(entryWrite(inserted)).toMatchObject({
      entryType: 'charge',
      reason: null,
      amountPaise: 0,
      receiptNo: null,
    });
    expect(row).toMatchObject({ price: 0, paymentStatus: 'pending' });
  });

  it('round-trips a failed payment through its reason', async () => {
    const { tx, inserted } = fakeTx();
    const row = await LabMoneyService.insert(tx, {
      ...base,
      price: 300,
      paymentStatus: 'failed',
    });

    expect(entryWrite(inserted)).toMatchObject({
      entryType: 'charge',
      reason: 'Payment failed',
    });
    expect(row.paymentStatus).toBe('failed');
  });
});

describe('LabMoneyService.update', () => {
  const pendingCharge: Stored = {
    id: 'entry-1',
    sourceId: 'order-1',
    amountPaise: 30000,
    entryType: 'charge',
    reason: null,
    receiptNo: null,
    paymentMode: null,
    paymentNotes: null,
    createdAt: new Date('2026-10-29T05:00:00.000Z'),
  };

  it('settles a pending charge in place, keeping its amount and issuing a receipt', async () => {
    const { tx, updates } = fakeTx(pendingCharge, 12);
    const row = await LabMoneyService.update(tx, 'entry-1', 'lab-1', {
      paymentStatus: 'paid',
    });

    expect(updates[0]).toMatchObject({ entryType: 'payment', reason: null });
    expect(updates[0]).not.toHaveProperty('amountPaise');
    expect(updates[0].receiptNo).toMatch(/^L-\d{4}-000012$/);
    expect(row).toMatchObject({ price: 300, paymentStatus: 'paid' });
  });

  it('never reissues a receipt, and a mode-only change leaves the status alone', async () => {
    const { tx, updates } = fakeTx({
      ...pendingCharge,
      entryType: 'payment',
      receiptNo: 'L-2026-000003',
    });
    const row = await LabMoneyService.update(tx, 'entry-1', 'lab-1', {
      paymentMode: 'UPI',
    });

    expect(updates[0]).toEqual({ paymentMode: 'UPI' });
    expect(row).toMatchObject({ paymentStatus: 'paid', paymentMode: 'UPI' });
  });

  it('returns null for an entry that does not exist', async () => {
    const { tx, updates } = fakeTx();
    expect(
      await LabMoneyService.update(tx, 'missing', 'lab-1', {
        paymentStatus: 'paid',
      })
    ).toBeNull();
    expect(updates).toHaveLength(0);
  });
});

describe('LabMoneyService.refund', () => {
  it('writes its own refund row with the reason, notes and a lab receipt', async () => {
    const { tx, inserted } = fakeTx(undefined, 21);
    const row = await LabMoneyService.refund(tx, {
      sourceType: 'lab_home_collection',
      sourceId: 'home-1',
      labId: 'lab-1',
      patientId: 'patient-1',
      amount: 500,
      reason: 'Visit cancelled',
      paymentMode: 'CASH',
      paymentNotes: 'Returned at desk',
      createdBy: 'user-1',
    });

    expect(entryWrite(inserted)).toMatchObject({
      clinicId: null,
      sourceType: 'lab_home_collection',
      sourceId: 'home-1',
      entryType: 'refund',
      reason: 'Visit cancelled',
      paymentNotes: 'Returned at desk',
      amountPaise: 50000,
      channel: 'desk',
    });
    expect(entryWrite(inserted).receiptNo).toMatch(/^L-\d{4}-000021$/);
    expect(row).toMatchObject({
      price: 500,
      paymentStatus: 'refunded',
      reason: 'Visit cancelled',
    });
  });
});
