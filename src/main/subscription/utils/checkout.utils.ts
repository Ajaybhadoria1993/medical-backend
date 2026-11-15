import type { PaymentLine } from '../types/subscriptionPayment.types';

export type Cycle = 'monthly' | 'yearly';

const key = (l: PaymentLine) =>
  [
    l.kind,
    l.planVersionId ?? '',
    l.addOnId ?? '',
    l.billingCycle ?? '',
    l.quantity ?? 1,
    l.amountPaise,
  ].join('|');

/** Compared field by field: jsonb does not keep key order, so raw JSON would differ. */
export const sameLines = (a: PaymentLine[], b: PaymentLine[]) =>
  a.length === b.length && a.every((line, i) => key(line) === key(b[i]));
