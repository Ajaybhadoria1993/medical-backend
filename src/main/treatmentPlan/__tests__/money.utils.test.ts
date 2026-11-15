import { planBalance, stepChargePaise } from '../utils/money.utils';

/** Charges one step after another with the same rule the ledger uses. */
const chargeAll = (totalPaise: number, fees: number[]) => {
  const out: number[] = [];
  let charged = 0;
  fees.forEach((fee, i) => {
    const rest = fees.slice(i);
    const c = stepChargePaise({
      totalPaise,
      chargedPaise: charged,
      feePaise: fee,
      unchargedFeesPaise: rest.reduce((a, b) => a + b, 0),
      unchargedCount: rest.length,
    });
    out.push(c);
    charged += c;
  });
  return out;
};

describe('stepChargePaise (DEV_PLAN §6, Q18)', () => {
  it('no discount: each step is charged its own fee', () => {
    expect(chargeAll(250000, [50000, 50000, 50000, 50000, 50000])).toEqual([
      50000, 50000, 50000, 50000, 50000,
    ]);
  });

  it('fees ₹11,000 agreed at ₹10,000: shares rounded down, the last closes the total exactly', () => {
    const c = chargeAll(1000000, [200000, 300000, 100000, 500000]);
    expect(c[0]).toBe(181818);
    expect(c.reduce((a, b) => a + b, 0)).toBe(1000000);
  });

  it('package 6 sessions at ₹15,000 with no step fees: ₹2,500 each', () => {
    expect(chargeAll(1500000, [0, 0, 0, 0, 0, 0])).toEqual([
      250000, 250000, 250000, 250000, 250000, 250000,
    ]);
  });

  it('never goes below zero when already charged in full', () => {
    expect(
      stepChargePaise({
        totalPaise: 1000,
        chargedPaise: 1200,
        feePaise: 500,
        unchargedFeesPaise: 500,
        unchargedCount: 1,
      })
    ).toBe(0);
  });
});

describe('planBalance', () => {
  it('advance and payments against charges', () => {
    const b = planBalance(250000, {
      advance: 20000,
      charge: 100000,
      payment: 30000,
    });
    expect(b).toMatchObject({
      charged: 100000,
      paid: 50000,
      due: 50000,
      toCome: 150000,
    });
  });

  it('a refund and a write-off', () => {
    const b = planBalance(100000, {
      charge: 100000,
      payment: 120000,
      refund: 10000,
      write_off: 0,
    });
    expect(b.due).toBe(-10000);
  });
});
