/** Pure ledger rules; all amounts in paise. */
import type {
  moneyAccountEnum,
  moneySideEnum,
} from '../models/moneyEntry.model';

export type Account = (typeof moneyAccountEnum.enumValues)[number];
export type Side = (typeof moneySideEnum.enumValues)[number];

export interface JournalLine {
  account: Account;
  side: Side;
  amountPaise: number;
}

export type EntryType =
  | 'charge'
  | 'payment'
  | 'refund'
  | 'write_off'
  | 'adjustment'
  | 'advance'
  | 'paid_at_visit';

export interface BalanceRow {
  id: string;
  entryType: EntryType;
  amountPaise: number;
  reversesEntryId: string | null;
}

export interface SourceBalance {
  charged: number;
  paid: number;
  refunded: number;
  writtenOff: number;
  received: number;
  /** Negative = credit for the patient. */
  due: number;
}

/** An adjustment counts against its target entry's bucket, with the opposite sign. */
export function balanceOf(rows: BalanceRow[]): SourceBalance {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sums = { charge: 0, payment: 0, refund: 0, write_off: 0 };
  // A plan's advance and paid-at-visit settle its balance like a payment.
  const bucket = (t: EntryType) =>
    t === 'advance' || t === 'paid_at_visit' ? 'payment' : t;
  for (const r of rows) {
    if (r.entryType === 'adjustment') {
      const target = r.reversesEntryId ? byId.get(r.reversesEntryId) : null;
      if (target && target.entryType !== 'adjustment')
        sums[bucket(target.entryType) as keyof typeof sums] -= r.amountPaise;
      continue;
    }
    sums[bucket(r.entryType) as keyof typeof sums] += r.amountPaise;
  }
  const received = sums.payment - sums.refund;
  return {
    charged: sums.charge,
    paid: sums.payment,
    refunded: sums.refund,
    writtenOff: sums.write_off,
    received,
    due: sums.charge - sums.write_off - received,
  };
}

const CLINIC_CREDIT: EntryType[] = [
  'charge',
  'payment',
  'advance',
  'paid_at_visit',
];
/** The side a counter or reversing line takes. */
export const oppositeSide = (s: Side): Side =>
  s === 'credit' ? 'debit' : 'credit';

/** Side of the clinic line; an adjustment takes the opposite side of the entry it reverses. */
export function clinicSide(type: EntryType, targetType?: EntryType): Side {
  if (type === 'adjustment')
    return oppositeSide(clinicSide(targetType ?? 'payment'));
  return CLINIC_CREDIT.includes(type) ? 'credit' : 'debit';
}

/** Counter account: owed money when no cash moves, else the cash drawer or Razorpay. */
export function counterAccount(
  type: EntryType,
  channel: 'desk' | 'online',
  targetType?: EntryType
): Account {
  const t = type === 'adjustment' ? (targetType ?? 'payment') : type;
  if (t === 'charge' || t === 'write_off' || t === 'paid_at_visit')
    return 'patient_receivable';
  return channel === 'online' ? 'gateway_clearing' : 'desk_cash';
}

/** Nets lines per account (one line per account fits the request unique key); drops zeros. */
export function netLines(lines: JournalLine[]): JournalLine[] {
  const byAccount = new Map<Account, number>();
  for (const l of lines) {
    const signed = l.side === 'debit' ? l.amountPaise : -l.amountPaise;
    byAccount.set(l.account, (byAccount.get(l.account) ?? 0) + signed);
  }
  return [...byAccount]
    .filter(([, n]) => n !== 0)
    .map(([account, n]) => ({
      account,
      side: n > 0 ? 'debit' : 'credit',
      amountPaise: Math.abs(n),
    }));
}

/** True when debits equal credits and every amount is a positive whole paise. */
export function isBalanced(lines: JournalLine[]): boolean {
  if (!lines.length) return false;
  let net = 0;
  for (const l of lines) {
    if (!Number.isSafeInteger(l.amountPaise) || l.amountPaise <= 0)
      return false;
    net += l.side === 'debit' ? l.amountPaise : -l.amountPaise;
  }
  return net === 0;
}

export type FeeAccount =
  | 'convenience_fee'
  | 'platform_commission'
  | 'gst_on_platform_fees'
  | 'pg_fee'
  | 'route_fee'
  | 'clinic_output_gst';

/** One fee of an online payment and who funds it. */
export interface FeePart {
  account: FeeAccount;
  amountPaise: number;
  paidBy: 'patient' | 'clinic';
}

/** Credits each fee; debits Razorpay for the patient's share, clinic_fees for the clinic's. */
export function feeJournalLines(parts: FeePart[]): JournalLine[] {
  return netLines(
    parts
      .filter((p) => p.amountPaise > 0)
      .flatMap((p): JournalLine[] => [
        { account: p.account, side: 'credit', amountPaise: p.amountPaise },
        {
          account: p.paidBy === 'patient' ? 'gateway_clearing' : 'clinic_fees',
          side: 'debit',
          amountPaise: p.amountPaise,
        },
      ])
  );
}

/** Zero-padded so receipts sort as text. */
export const formatReceiptNo = (year: number, n: number) =>
  `R-${year}-${String(n).padStart(6, '0')}`;

/** Lab series: an L prefix so a lab receipt never reads as a clinic one. */
export const formatLabReceiptNo = (year: number, n: number) =>
  `L-${year}-${String(n).padStart(6, '0')}`;

/** Rounds half away from zero; rejects non-numbers. */
export function toPaise(rupees: string | number): number {
  const n = Number(rupees);
  if (!Number.isFinite(n)) throw new Error(`Not a money amount: ${rupees}`);
  return Math.sign(n) * Math.round(Math.abs(n) * 100);
}

export const fromPaise = (paise: number) => (paise / 100).toFixed(2);
