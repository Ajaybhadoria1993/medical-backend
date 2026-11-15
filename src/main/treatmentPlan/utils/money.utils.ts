/** Decimal string ("1500.50") → whole paise; all plan money maths runs in paise. */
export const toPaise = (amount: string | number): number =>
  Math.round(Number(amount) * 100);

/** Whole paise → decimal string with 2 places, as stored in decimal(12,2). */
export const fromPaise = (paise: number): string => (paise / 100).toFixed(2);

/** One step's charge (DEV_PLAN §6, Q18), all in paise. The step takes its fee's share of what is
 *  left of the agreed total, rounded down; the last uncharged step takes exactly what is left, so
 *  charges always add up to the total. Steps with no fees split the rest evenly. */
export function stepChargePaise(input: {
  totalPaise: number;
  chargedPaise: number;
  feePaise: number;
  /** Fees of every step not charged yet, this one included. */
  unchargedFeesPaise: number;
  /** Steps not charged yet (skipped ones excluded), this one included. */
  unchargedCount: number;
}): number {
  const left = Math.max(0, input.totalPaise - input.chargedPaise);
  if (input.unchargedCount <= 1) return left;
  if (input.unchargedFeesPaise > 0)
    return Math.floor((left * input.feePaise) / input.unchargedFeesPaise);
  return Math.floor(left / input.unchargedCount);
}

/** Where a plan's money stands, from its ledger sums (paise). */
export function planBalance(
  total: number,
  sums: Partial<Record<string, number>>
) {
  const s = (k: string) => sums[k] ?? 0;
  const charged = s('charge') - s('credit_note');
  const paid = s('advance') + s('payment') + s('paid_at_visit') - s('refund');
  const writtenOff = s('write_off');
  return {
    charged,
    paid,
    writtenOff,
    refunded: s('refund'),
    /** Owed now for visits already completed; negative = the patient is in credit. */
    due: charged - paid - writtenOff,
    toCome: Math.max(0, total - charged),
    /** What the patient still has to pay for the whole plan; a payment is never more than this. */
    leftToPay: Math.max(0, total - paid - writtenOff),
  };
}

/** What to collect now for a step about to be booked or done (paise): its share, plus what is already owed,
 *  less unused advance; never more than is left on the plan. The one rule every screen shows. */
export function collectNow(
  balance: { due: number; leftToPay: number },
  sharePaise: number
) {
  const credit = Math.max(0, -balance.due);
  return {
    sharePaise,
    priorDuePaise: Math.max(0, balance.due),
    fromAdvancePaise: Math.min(credit, sharePaise),
    toCollectPaise: Math.min(
      balance.leftToPay,
      Math.max(0, balance.due + sharePaise)
    ),
  };
}
