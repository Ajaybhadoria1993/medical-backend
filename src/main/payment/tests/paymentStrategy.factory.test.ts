import { PaymentStrategyFactory } from '../factory/paymentStrategy.factory';
import { IPaymentAdapter } from '../interfaces/IPaymentAdapter';

describe('PaymentStrategyFactory Unit Tests', () => {
  beforeAll(() => {
    process.env.ENABLED_PAYMENT_GATEWAYS = 'razorpay,cashfree';
    process.env.DEFAULT_PLATFORM_GATEWAY = 'razorpay';
    PaymentStrategyFactory.initializeStrategies();
  });

  it('should return RazorpayAdapter when requested', () => {
    const strategy = PaymentStrategyFactory.getStrategy('razorpay');
    expect(strategy).toBeDefined();
    expect(strategy.providerName).toBe('razorpay');
  });

  it('should return CashfreeAdapter when requested', () => {
    const strategy = PaymentStrategyFactory.getStrategy('cashfree');
    expect(strategy).toBeDefined();
    expect(strategy.providerName).toBe('cashfree');
  });

  it('should fall back to default platform gateway when no provider is specified', () => {
    const strategy = PaymentStrategyFactory.getStrategy();
    expect(strategy).toBeDefined();
    expect(strategy.providerName).toBe('razorpay');
  });

  it('should allow registering a custom mock strategy for tests', () => {
    const mockAdapter: IPaymentAdapter = {
      providerName: 'mock_test_gateway',
      createOrder: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
      normalizeWebhookEvent: jest.fn(),
      processRefund: jest.fn(),
      getReconciliationReport: jest.fn().mockResolvedValue([]),
    };

    PaymentStrategyFactory.registerStrategy('mock_test_gateway', mockAdapter);
    const resolved = PaymentStrategyFactory.getStrategy('mock_test_gateway');

    expect(resolved).toBe(mockAdapter);
    expect(resolved.providerName).toBe('mock_test_gateway');
  });
});
