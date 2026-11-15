import { AutoPayLimitService } from '../services/billing/autoPayLimit.service';

describe('AutoPay limit', () => {
  it('is one fixed ₹15,000 for every plan', () => {
    expect(AutoPayLimitService.forRenewal(139500)).toEqual({
      limitPaise: 15_000_00,
      lines: [],
      uncapped: [],
    });
  });

  it('is never below the current renewal', () => {
    expect(AutoPayLimitService.forRenewal(20_000_00).limitPaise).toBe(
      20_000_00
    );
  });
});
