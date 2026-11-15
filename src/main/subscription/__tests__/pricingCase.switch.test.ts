import { pricingCase } from '../utils/planPricing.utils';

const careHub = {
  paid: true,
  planId: 'carehub',
  cycle: 'monthly' as const,
  pricePaise: 99900,
};

describe('pricingCase in the grace days', () => {
  const due = { ...careHub, downgradeScheduled: false, renewalDue: true };
  it('allows only the renewal', () => {
    expect(
      pricingCase(due, {
        planId: 'carehub',
        cycle: 'monthly',
        pricePaise: 99900,
      })
    ).toEqual({ case: 'renewal' });
    expect(
      pricingCase(due, { planId: 'pro', cycle: 'monthly', pricePaise: 199900 })
    ).toEqual({ refuse: 'renew_first' });
    expect(
      pricingCase(due, {
        planId: 'carehub',
        cycle: 'yearly',
        pricePaise: 959000,
      })
    ).toEqual({ refuse: 'renew_first' });
  });
});

describe('pricingCase with a scheduled switch', () => {
  const current = {
    ...careHub,
    downgradeScheduled: true,
    scheduled: { planId: 'clinic', cycle: 'monthly' as const },
  };

  it('lets the clinic pay the next month on the scheduled plan', () => {
    expect(
      pricingCase(current, {
        planId: 'clinic',
        cycle: 'monthly',
        pricePaise: 49900,
      })
    ).toEqual({ case: 'renewal' });
  });

  it('still asks to undo the change for any other plan or cycle', () => {
    expect(
      pricingCase(current, {
        planId: 'carehub',
        cycle: 'monthly',
        pricePaise: 99900,
      })
    ).toEqual({ refuse: 'undo_downgrade' });
    expect(
      pricingCase(current, {
        planId: 'clinic',
        cycle: 'yearly',
        pricePaise: 479000,
      })
    ).toEqual({ refuse: 'undo_downgrade' });
  });
});
