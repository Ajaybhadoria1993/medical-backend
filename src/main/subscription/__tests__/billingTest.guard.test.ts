const mockEnv: { NODE_ENV: string; RAZORPAY_KEY_ID: string } = {
  NODE_ENV: 'staging',
  RAZORPAY_KEY_ID: 'rzp_test_abc',
};
jest.mock('../../../utils/envConfig', () => ({ envConfig: mockEnv }));
jest.mock('../../../configurations/dbConnection', () => ({ database: {} }));
jest.mock('../../../configurations/redisConfig', () => ({
  __esModule: true,
  default: {},
}));

import { BillingTestService } from '../services/billing/billingTest.service';

describe('Billing test tool guard', () => {
  it('is on only in dev or staging with a Razorpay test key', () => {
    mockEnv.NODE_ENV = 'staging';
    mockEnv.RAZORPAY_KEY_ID = 'rzp_test_abc';
    expect(BillingTestService.enabled()).toBe(true);
    mockEnv.NODE_ENV = 'development';
    expect(BillingTestService.enabled()).toBe(true);
  });

  it('is never on in production, even with a test key', () => {
    mockEnv.NODE_ENV = 'production';
    mockEnv.RAZORPAY_KEY_ID = 'rzp_test_abc';
    expect(BillingTestService.enabled()).toBe(false);
  });

  it('is off with a live Razorpay key, even on staging', () => {
    mockEnv.NODE_ENV = 'staging';
    mockEnv.RAZORPAY_KEY_ID = 'rzp_live_abc';
    expect(BillingTestService.enabled()).toBe(false);
  });

  it('refuses to run when off, as if the route did not exist', async () => {
    mockEnv.NODE_ENV = 'production';
    await expect(BillingTestService.status('c-1')).rejects.toMatchObject({
      status: 404,
    });
  });
});
