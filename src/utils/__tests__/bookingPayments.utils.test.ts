import { envConfig } from '../envConfig';
import { bookingPaymentOptions } from '../bookingPayments.utils';

describe('bookingPaymentOptions', () => {
  const original = envConfig.ENABLE_ONLINE_APPOINTMENT_PAYMENTS;
  afterEach(() => {
    envConfig.ENABLE_ONLINE_APPOINTMENT_PAYMENTS = original;
  });

  describe('online appointment payments switched off', () => {
    beforeEach(() => {
      envConfig.ENABLE_ONLINE_APPOINTMENT_PAYMENTS = false;
    });

    it('hides online payment even when the clinic had it on', () => {
      expect(
        bookingPaymentOptions({
          payOnlineEnabled: true,
          payAtClinicEnabled: true,
        }).payOnlineEnabled
      ).toBe(false);
    });

    it('always allows pay at clinic, even when the clinic setting is off or missing', () => {
      expect(
        bookingPaymentOptions({
          payOnlineEnabled: true,
          payAtClinicEnabled: false,
        }).payAtClinicEnabled
      ).toBe(true);
      expect(bookingPaymentOptions({}).payAtClinicEnabled).toBe(true);
    });
  });

  describe('online appointment payments switched on (original behaviour)', () => {
    beforeEach(() => {
      envConfig.ENABLE_ONLINE_APPOINTMENT_PAYMENTS = true;
    });

    it('returns the clinic settings unchanged', () => {
      expect(
        bookingPaymentOptions({
          payOnlineEnabled: true,
          payAtClinicEnabled: false,
        })
      ).toEqual({ payOnlineEnabled: true, payAtClinicEnabled: false });
      expect(
        bookingPaymentOptions({
          payOnlineEnabled: false,
          payAtClinicEnabled: true,
        })
      ).toEqual({ payOnlineEnabled: false, payAtClinicEnabled: true });
    });

    it('treats missing or null settings as off', () => {
      expect(
        bookingPaymentOptions({ payOnlineEnabled: null, payAtClinicEnabled: null })
      ).toEqual({ payOnlineEnabled: false, payAtClinicEnabled: false });
      expect(bookingPaymentOptions({})).toEqual({
        payOnlineEnabled: false,
        payAtClinicEnabled: false,
      });
    });
  });
});
