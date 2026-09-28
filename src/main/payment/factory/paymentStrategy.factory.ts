import { IPaymentAdapter } from '../interfaces/IPaymentAdapter';
import { RazorpayAdapter } from '../adapters/razorpay.adapter';
import { CashfreeAdapter } from '../adapters/cashfree.adapter';
import logger from '../../../utils/logger';

export class PaymentStrategyFactory {
  private static strategies: Map<string, IPaymentAdapter> = new Map();
  private static initialized = false;

  public static initializeStrategies(): void {
    if (this.initialized) return;

    const enabledGateways = (process.env.ENABLED_PAYMENT_GATEWAYS || 'razorpay')
      .split(',')
      .map((g) => g.trim().toLowerCase());

    if (enabledGateways.includes('razorpay')) {
      this.strategies.set('razorpay', new RazorpayAdapter());
      logger.info('Initialized Payment Gateway Adapter: Razorpay');
    }

    if (enabledGateways.includes('cashfree')) {
      this.strategies.set('cashfree', new CashfreeAdapter());
      logger.info('Initialized Payment Gateway Adapter: Cashfree');
    }

    this.initialized = true;
  }

  /**
   * Returns the requested gateway adapter or falls back to the default platform gateway from env.
   */
  public static getStrategy(provider?: string): IPaymentAdapter {
    if (!this.initialized) {
      this.initializeStrategies();
    }

    const defaultGateway = process.env.DEFAULT_PLATFORM_GATEWAY || 'razorpay';
    const target = (provider || defaultGateway).toLowerCase();
    const strategy = this.strategies.get(target);

    if (!strategy) {
      // If requested isn't enabled but razorpay is available as safe fallback
      const fallback = this.strategies.get('razorpay');
      if (fallback) {
        logger.warn(
          `Requested gateway provider '${target}' is not enabled. Falling back to Razorpay.`
        );
        return fallback;
      }
      throw new Error(
        `Payment gateway provider '${target}' is not enabled or registered in ENABLED_PAYMENT_GATEWAYS.`
      );
    }

    return strategy;
  }

  /**
   * Register a custom or mock strategy for testing.
   */
  public static registerStrategy(
    name: string,
    strategy: IPaymentAdapter
  ): void {
    this.strategies.set(name.toLowerCase(), strategy);
  }
}
