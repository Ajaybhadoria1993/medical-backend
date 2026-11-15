import {
  daysInPeriod,
  daysLeft,
  prorate,
  pricingCase,
  trialRenews,
  type PricingCurrent,
} from '../utils/planPricing.utils';

const clinicMonthly: PricingCurrent = {
  paid: true,
  planId: 'clinic',
  cycle: 'monthly',
  pricePaise: 99900,
  downgradeScheduled: false,
};
const target = (
  planId: string,
  cycle: 'monthly' | 'yearly',
  pricePaise: number
) => ({
  planId,
  cycle,
  pricePaise,
});

describe('pricingCase', () => {
  it('buys from Free or a trial', () => {
    expect(pricingCase(null, target('clinic', 'monthly', 99900))).toEqual({
      case: 'purchase',
    });
    expect(
      pricingCase(
        { ...clinicMonthly, paid: false },
        target('clinic', 'monthly', 99900)
      )
    ).toEqual({ case: 'purchase' });
  });

  it('renews the same plan and cycle', () => {
    expect(
      pricingCase(clinicMonthly, target('clinic', 'monthly', 99900))
    ).toEqual({
      case: 'renewal',
    });
  });

  it('refuses a renewal more than 7 days before the period ends', () => {
    const same = target('clinic', 'monthly', 99900);
    expect(pricingCase({ ...clinicMonthly, daysLeft: 29 }, same)).toEqual({
      refuse: 'too_early',
    });
    expect(pricingCase({ ...clinicMonthly, daysLeft: 7 }, same)).toEqual({
      case: 'renewal',
    });
    expect(
      pricingCase({ ...clinicMonthly, daysLeft: 29, renewalDue: true }, same)
    ).toEqual({ case: 'renewal' });
  });

  it('upgrades to a pricier plan in the same cycle', () => {
    expect(
      pricingCase(clinicMonthly, target('carehub', 'monthly', 199900))
    ).toEqual({
      case: 'upgrade',
    });
  });

  it('refuses a cheaper or equal plan: that is a scheduled downgrade', () => {
    expect(
      pricingCase(clinicMonthly, target('solo-paid', 'monthly', 49900))
    ).toEqual({
      refuse: 'not_higher',
    });
  });

  it('switches monthly to yearly on any plan', () => {
    expect(
      pricingCase(clinicMonthly, target('clinic', 'yearly', 959000))
    ).toEqual({
      case: 'to_yearly',
    });
  });

  it('refuses yearly to monthly: that waits for the end of the year', () => {
    expect(
      pricingCase(
        { ...clinicMonthly, cycle: 'yearly' },
        target('clinic', 'monthly', 99900)
      )
    ).toEqual({ refuse: 'yearly_to_monthly' });
  });

  it('refuses renewing or upgrading while a downgrade is scheduled', () => {
    expect(
      pricingCase(
        { ...clinicMonthly, downgradeScheduled: true },
        target('clinic', 'monthly', 99900)
      )
    ).toEqual({ refuse: 'undo_downgrade' });
  });
});

describe('proration', () => {
  const ist = (s: string) => new Date(`${s}+05:30`);

  it('pays the difference for the days left: ₹999 → ₹1,999 with 15 of 30 days left is ₹500', () => {
    expect(prorate(199900, 15, 30) - prorate(99900, 15, 30)).toBe(50000);
  });

  it('counts a started day as left and a period in calendar days', () => {
    expect(
      daysLeft(ist('2026-11-20T10:00:00'), ist('2026-12-15T09:00:00'))
    ).toBe(25);
    expect(
      daysInPeriod(ist('2026-11-15T09:00:00'), ist('2026-12-15T09:00:00'))
    ).toBe(30);
    expect(
      daysInPeriod(ist('2027-01-31T09:00:00'), ist('2027-02-28T09:00:00'))
    ).toBe(28);
  });

  it('never credits more than the whole price', () => {
    expect(prorate(99900, 40, 30)).toBe(99900);
    expect(prorate(99900, 0, 30)).toBe(0);
  });

  it('rounds half up to the paisa', () => {
    expect(prorate(99900, 1, 30)).toBe(3330);
    expect(prorate(10001, 1, 2)).toBe(5001);
  });
});

describe('trialRenews', () => {
  it('renews a trial into the same plan monthly inside the 7-day window only', () => {
    const t = { samePlan: true, cycle: 'monthly' as const, daysLeft: 3 };
    expect(trialRenews(t)).toBe(true);
    expect(trialRenews({ ...t, daysLeft: 20 })).toBe(false);
    expect(trialRenews({ ...t, samePlan: false })).toBe(false);
    expect(trialRenews({ ...t, cycle: 'yearly' })).toBe(false);
  });
});
