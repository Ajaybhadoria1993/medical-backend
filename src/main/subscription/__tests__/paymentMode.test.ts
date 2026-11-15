import {
  normalizeSubscriptionPaymentMode,
  resolveRazorpayPaymentMode,
} from '../utils/paymentMode.utils';
import { razorpayInstance } from '../../../utils/razorpay';

jest.mock('../../../utils/razorpay', () => ({
  razorpayInstance: {
    payments: {
      fetch: jest.fn(),
    },
  },
}));

describe('PaymentMode Utils', () => {
  describe('normalizeSubscriptionPaymentMode', () => {
    it('normalizes coupon and credit modes', () => {
      expect(normalizeSubscriptionPaymentMode('coupon')).toBe('Coupon');
      expect(normalizeSubscriptionPaymentMode('Coupon')).toBe('Coupon');
      expect(normalizeSubscriptionPaymentMode('COUPON')).toBe('Coupon');
      expect(normalizeSubscriptionPaymentMode('credit')).toBe('Credit');
      expect(normalizeSubscriptionPaymentMode('Credit')).toBe('Credit');
      expect(normalizeSubscriptionPaymentMode('free')).toBe('Free');
      expect(normalizeSubscriptionPaymentMode('Free')).toBe('Free');
      expect(normalizeSubscriptionPaymentMode('-')).toBe('-');
    });

    it('normalizes Razorpay payment rails', () => {
      expect(normalizeSubscriptionPaymentMode('upi')).toBe('UPI');
      expect(normalizeSubscriptionPaymentMode('UPI')).toBe('UPI');
      expect(normalizeSubscriptionPaymentMode('card')).toBe('Card');
      expect(normalizeSubscriptionPaymentMode('credit_card')).toBe('Card');
      expect(normalizeSubscriptionPaymentMode('debit_card')).toBe('Card');
      expect(normalizeSubscriptionPaymentMode('netbanking')).toBe(
        'Net Banking'
      );
      expect(normalizeSubscriptionPaymentMode('net_banking')).toBe(
        'Net Banking'
      );
      expect(normalizeSubscriptionPaymentMode('wallet')).toBe('Wallet');
      expect(normalizeSubscriptionPaymentMode('emi')).toBe('EMI');
      expect(normalizeSubscriptionPaymentMode('bank_transfer')).toBe(
        'Bank Transfer'
      );
      expect(normalizeSubscriptionPaymentMode('nach')).toBe('NACH');
      expect(normalizeSubscriptionPaymentMode('emandate')).toBe('NACH');
      expect(normalizeSubscriptionPaymentMode('qr')).toBe('QR');
      expect(normalizeSubscriptionPaymentMode('autopay')).toBe('AutoPay');
    });

    it('normalizes generic or fallback gateway terms', () => {
      expect(normalizeSubscriptionPaymentMode('razorpay')).toBe('Online');
      expect(normalizeSubscriptionPaymentMode('online')).toBe('Online');
      expect(normalizeSubscriptionPaymentMode('gateway')).toBe('Online');
      expect(normalizeSubscriptionPaymentMode(null)).toBe('Online');
      expect(normalizeSubscriptionPaymentMode(undefined)).toBe('Online');
    });
  });

  describe('resolveRazorpayPaymentMode', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('returns Online if paymentId is empty or not a Razorpay payment id', async () => {
      expect(await resolveRazorpayPaymentMode(null)).toBe('Online');
      expect(await resolveRazorpayPaymentMode('txn_12345')).toBe('Online');
    });

    it('fetches payment method from Razorpay and normalizes it', async () => {
      (razorpayInstance.payments.fetch as jest.Mock).mockResolvedValueOnce({
        method: 'upi',
      });

      const mode = await resolveRazorpayPaymentMode('pay_test_upi_123');
      expect(mode).toBe('UPI');
      expect(razorpayInstance.payments.fetch).toHaveBeenCalledWith(
        'pay_test_upi_123'
      );
    });

    it('falls back to Online if Razorpay fetch throws an error', async () => {
      (razorpayInstance.payments.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      const mode = await resolveRazorpayPaymentMode('pay_test_err');
      expect(mode).toBe('Online');
    });
  });
});
