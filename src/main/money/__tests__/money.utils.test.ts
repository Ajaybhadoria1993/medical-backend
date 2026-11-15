import { DynamicSplitEngine } from '../../payment/engine/dynamicSplit.engine';
import type { IFeeConfig } from '../../payment/interfaces/splitEngine.types';
import {
  balanceOf,
  clinicSide,
  counterAccount,
  feeJournalLines,
  isBalanced,
  netLines,
  type FeePart,
  formatReceiptNo,
  fromPaise,
  toPaise,
  type BalanceRow,
} from '../utils/money.utils';

const row = (
  id: string,
  entryType: BalanceRow['entryType'],
  amountPaise: number,
  reversesEntryId: string | null = null
): BalanceRow => ({ id, entryType, amountPaise, reversesEntryId });

describe('balanceOf', () => {
  it('a charged, unpaid visit is fully due', () => {
    expect(balanceOf([row('c', 'charge', 50000)])).toEqual({
      charged: 50000,
      paid: 0,
      refunded: 0,
      writtenOff: 0,
      received: 0,
      due: 50000,
    });
  });

  it('a part payment lowers what is due', () => {
    const b = balanceOf([
      row('c', 'charge', 50000),
      row('p', 'payment', 30000),
    ]);
    expect(b.received).toBe(30000);
    expect(b.due).toBe(20000);
  });

  it('a refund lowers what was received and raises what is due', () => {
    const b = balanceOf([
      row('c', 'charge', 50000),
      row('p', 'payment', 50000),
      row('r', 'refund', 20000),
    ]);
    expect(b.received).toBe(30000);
    expect(b.due).toBe(20000);
  });

  it('a write-off clears what is due', () => {
    const b = balanceOf([
      row('c', 'charge', 50000),
      row('w', 'write_off', 50000),
    ]);
    expect(b.due).toBe(0);
  });

  it('an adjustment undoes part of its target entry', () => {
    const b = balanceOf([
      row('c', 'charge', 50000),
      row('p', 'payment', 50000),
      row('a', 'adjustment', 10000, 'p'),
    ]);
    expect(b.paid).toBe(40000);
    expect(b.due).toBe(10000);
  });

  it('an adjustment of a missing entry is ignored', () => {
    const b = balanceOf([
      row('c', 'charge', 50000),
      row('a', 'adjustment', 10000, 'x'),
    ]);
    expect(b.due).toBe(50000);
  });

  it('paying more than charged shows as credit (negative due)', () => {
    const b = balanceOf([
      row('c', 'charge', 50000),
      row('p', 'payment', 60000),
    ]);
    expect(b.due).toBe(-10000);
  });
});

describe('receipt and paise helpers', () => {
  it('receipts are zero-padded so they sort as text', () => {
    expect(formatReceiptNo(2026, 12)).toBe('R-2026-000012');
  });

  it('toPaise converts rupees exactly and keeps the sign', () => {
    expect(toPaise('500')).toBe(50000);
    expect(toPaise('12.34')).toBe(1234);
    expect(toPaise(-1.5)).toBe(-150);
  });

  it('toPaise rejects anything that is not a number', () => {
    expect(() => toPaise('abc')).toThrow('Not a money amount');
  });

  it('fromPaise gives two decimals', () => {
    expect(fromPaise(50050)).toBe('500.50');
  });
});

describe('balanceOf with treatment plan entries', () => {
  it('an advance and paid-at-visit count as paid for the plan', () => {
    const b = balanceOf([
      row('c', 'charge', 100000),
      row('a', 'advance', 30000),
      row('v', 'paid_at_visit', 20000),
    ]);
    expect(b.received).toBe(50000);
    expect(b.due).toBe(50000);
  });

  it('a refund after an advance lowers what was received', () => {
    const b = balanceOf([
      row('a', 'advance', 30000),
      row('r', 'refund', 10000),
    ]);
    expect(b.received).toBe(20000);
  });
});

describe('clinicSide / counterAccount', () => {
  it('money in credits the clinic; refunds and write-offs debit it', () => {
    expect(clinicSide('payment')).toBe('credit');
    expect(clinicSide('charge')).toBe('credit');
    expect(clinicSide('refund')).toBe('debit');
    expect(clinicSide('write_off')).toBe('debit');
  });

  it('a correction takes the opposite side of its target', () => {
    expect(clinicSide('adjustment', 'payment')).toBe('debit');
    expect(clinicSide('adjustment', 'refund')).toBe('credit');
  });

  it('no cash moves for charges, write-offs and paid-at-visit', () => {
    for (const t of ['charge', 'write_off', 'paid_at_visit'] as const)
      expect(counterAccount(t, 'desk')).toBe('patient_receivable');
  });

  it('cash goes to the drawer at the desk and to Razorpay online', () => {
    expect(counterAccount('payment', 'desk')).toBe('desk_cash');
    expect(counterAccount('refund', 'online')).toBe('gateway_clearing');
    expect(counterAccount('adjustment', 'online', 'payment')).toBe(
      'gateway_clearing'
    );
  });
});

describe('netLines / isBalanced', () => {
  it('nets one account to a single line and drops zeros', () => {
    expect(
      netLines([
        { account: 'gateway_clearing', side: 'debit', amountPaise: 500 },
        { account: 'gateway_clearing', side: 'credit', amountPaise: 200 },
        { account: 'pg_fee', side: 'debit', amountPaise: 100 },
        { account: 'pg_fee', side: 'credit', amountPaise: 100 },
      ])
    ).toEqual([
      { account: 'gateway_clearing', side: 'debit', amountPaise: 300 },
    ]);
  });

  it('balanced only when debits equal credits in whole positive paise', () => {
    expect(
      isBalanced([
        { account: 'desk_cash', side: 'debit', amountPaise: 500 },
        { account: 'clinic', side: 'credit', amountPaise: 500 },
      ])
    ).toBe(true);
    expect(
      isBalanced([
        { account: 'desk_cash', side: 'debit', amountPaise: 500 },
        { account: 'clinic', side: 'credit', amountPaise: 400 },
      ])
    ).toBe(false);
    expect(isBalanced([])).toBe(false);
    expect(
      isBalanced([
        { account: 'desk_cash', side: 'debit', amountPaise: 0.5 },
        { account: 'clinic', side: 'credit', amountPaise: 0.5 },
      ])
    ).toBe(false);
  });
});

describe('feeJournalLines: split math', () => {
  const amount = (lines: ReturnType<typeof feeJournalLines>, a: string) =>
    lines.find((l) => l.account === a)?.amountPaise ?? 0;

  it('patient total = clinic amount + fees the patient paid', () => {
    // ₹500 visit + ₹20 convenience fee + ₹3.60 GST, both paid by the patient.
    const parts: FeePart[] = [
      { account: 'convenience_fee', amountPaise: 2000, paidBy: 'patient' },
      { account: 'gst_on_platform_fees', amountPaise: 360, paidBy: 'patient' },
    ];
    const lines = feeJournalLines(parts);
    expect(isBalanced(lines)).toBe(true);
    // record() already debited Razorpay the 50000 clinic amount.
    expect(50000 + amount(lines, 'gateway_clearing')).toBe(52360);
  });

  it('clinic amount = transfer + fees the clinic bears', () => {
    const parts: FeePart[] = [
      { account: 'platform_commission', amountPaise: 2500, paidBy: 'clinic' },
      { account: 'gst_on_platform_fees', amountPaise: 450, paidBy: 'clinic' },
      { account: 'pg_fee', amountPaise: 1000, paidBy: 'clinic' },
      { account: 'route_fee', amountPaise: 125, paidBy: 'clinic' },
    ];
    const lines = feeJournalLines(parts);
    expect(isBalanced(lines)).toBe(true);
    const transfer = 50000 - amount(lines, 'clinic_fees');
    expect(transfer + 2500 + 450 + 1000 + 125).toBe(50000);
    expect(lines.some((l) => l.account === 'clinic')).toBe(false);
  });

  it('a GST line paid partly by each side keeps one line per account', () => {
    const lines = feeJournalLines([
      { account: 'gst_on_platform_fees', amountPaise: 360, paidBy: 'patient' },
      { account: 'gst_on_platform_fees', amountPaise: 450, paidBy: 'clinic' },
    ]);
    expect(amount(lines, 'gst_on_platform_fees')).toBe(810);
    expect(new Set(lines.map((l) => l.account)).size).toBe(lines.length);
  });

  it('matches the fee engine when every fee is added to the patient total (today)', () => {
    const fee = (
      feeType: string,
      rate: number,
      priority: number
    ): IFeeConfig => ({
      feeName: feeType,
      feeType,
      enabled: true,
      calculationMethod: 'PERCENTAGE',
      calculationBase: 'CLINIC_SERVICE_PRICE',
      rateOrAmount: rate,
      taxRate: 18,
      taxTreatment: 'TAX_EXCLUSIVE',
      priority,
      effectiveFrom: new Date(0),
    });
    const r = DynamicSplitEngine.calculate(500, [
      fee('CONVENIENCE_FEE', 4, 1),
      fee('CLINIC_COMMISSION', 5, 2),
      fee('GATEWAY_FEE', 2, 3),
      fee('ROUTE_TRANSFER_FEE', 0.25, 4),
    ]);
    const b = r.breakdown;
    const p = (rupees: number) => toPaise(rupees);
    const lines = feeJournalLines([
      {
        account: 'convenience_fee',
        amountPaise: p(b.convenienceFee),
        paidBy: 'patient',
      },
      {
        account: 'platform_commission',
        amountPaise: p(b.commission),
        paidBy: 'patient',
      },
      {
        account: 'gst_on_platform_fees',
        amountPaise: p(b.gstOnConvenienceFee + b.gstOnCommission),
        paidBy: 'patient',
      },
      {
        account: 'pg_fee',
        amountPaise: p(b.gatewayFee + b.gstOnGatewayFee),
        paidBy: 'patient',
      },
      {
        account: 'route_fee',
        amountPaise: p(b.routeTransferFee + b.gstOnRouteTransferFee),
        paidBy: 'patient',
      },
      {
        account: 'clinic_output_gst',
        amountPaise: p(b.gstOnPrice),
        paidBy: 'patient',
      },
    ]);
    expect(isBalanced(lines)).toBe(true);
    expect(p(r.clinicAmount) + amount(lines, 'gateway_clearing')).toBe(
      p(r.patientTotal)
    );
  });
});
