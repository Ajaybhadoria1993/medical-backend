import type { PaymentLine } from '../types/subscriptionPayment.types';
import { sameLines } from '../utils/checkout.utils';

const plan: PaymentLine = {
  kind: 'plan',
  description: 'Clinic (monthly)',
  amountPaise: 99900,
  planVersionId: 'v1',
  billingCycle: 'monthly',
  quantity: 1,
};

describe('sameLines', () => {
  it('matches the same checkout even when stored keys come back in another order', () => {
    const fromDb = JSON.parse(
      '[{"quantity":1,"kind":"plan","billingCycle":"monthly","amountPaise":99900,"planVersionId":"v1","description":"Clinic (monthly)"}]'
    );
    expect(sameLines([plan], fromDb)).toBe(true);
  });

  it('treats another cycle, version or amount as a different checkout', () => {
    expect(sameLines([plan], [{ ...plan, billingCycle: 'yearly' }])).toBe(
      false
    );
    expect(sameLines([plan], [{ ...plan, planVersionId: 'v2' }])).toBe(false);
    expect(sameLines([plan], [{ ...plan, amountPaise: 89900 }])).toBe(false);
  });

  it('treats an added coupon line as a different checkout', () => {
    const coupon: PaymentLine = {
      kind: 'coupon',
      description: 'Coupon X',
      amountPaise: -500,
    };
    expect(sameLines([plan], [plan, coupon])).toBe(false);
  });
});
