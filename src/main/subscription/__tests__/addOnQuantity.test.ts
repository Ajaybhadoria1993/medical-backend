import { addOnRenewalQuantity } from '../utils/addOnQuantity.utils';

describe('addOnRenewalQuantity', () => {
  it('keeps current entitlement but subtracts a scheduled partial reduction from renewal', () => {
    const addOn = {
      quantity: 3,
      scheduledReductionBy: 2,
      cancelAtPeriodEnd: false,
    };

    expect(addOn.quantity).toBe(3);
    expect(addOnRenewalQuantity(addOn)).toBe(1);
  });

  it('returns zero when the whole add-on is scheduled for cancellation', () => {
    expect(
      addOnRenewalQuantity({
        quantity: 3,
        scheduledReductionBy: 0,
        cancelAtPeriodEnd: true,
      })
    ).toBe(0);
  });

  it('never returns a negative renewal quantity', () => {
    expect(
      addOnRenewalQuantity({
        quantity: 1,
        scheduledReductionBy: 2,
        cancelAtPeriodEnd: false,
      })
    ).toBe(0);
  });
});
