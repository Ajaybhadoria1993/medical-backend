import {
  isSubscriptionValid,
  subscriptionGraceEnd,
} from '../subscriptionExpiry';

describe('subscriptionExpiry', () => {
  describe('isSubscriptionValid', () => {
    it('treats a null expiry as never expiring (Free plan)', () => {
      expect(isSubscriptionValid(null)).toBe(true);
      expect(isSubscriptionValid(undefined)).toBe(true);
    });

    it('stays valid for the rest of the expiry day in IST', () => {
      // The real case that broke: expiry at 11:19 UTC on 14 Aug, checked at
      // 13:00 UTC (18:30 IST) the same day. Raw-timestamp comparison called
      // this expired; end-of-day does not.
      const expiresAt = '2026-08-14T11:19:47.688Z';
      const sameDayEvening = new Date('2026-08-14T13:00:00.000Z');

      expect(isSubscriptionValid(expiresAt, sameDayEvening)).toBe(true);
    });

    it('expires once the IST day is over', () => {
      const expiresAt = '2026-08-14T11:19:47.688Z';
      // 2026-08-14T18:30:00Z is 00:00 IST on the 15th — past the grace end.
      const nextIstDay = new Date('2026-08-14T18:30:00.001Z');

      expect(isSubscriptionValid(expiresAt, nextIstDay)).toBe(false);
    });

    it('is valid at the exact final millisecond of the IST day', () => {
      const expiresAt = '2026-08-14T11:19:47.688Z';
      const graceEnd = subscriptionGraceEnd(expiresAt) as Date;

      expect(isSubscriptionValid(expiresAt, graceEnd)).toBe(true);
      expect(
        isSubscriptionValid(expiresAt, new Date(graceEnd.getTime() + 1))
      ).toBe(false);
    });

    it('accepts a Date as well as a string', () => {
      const expiresAt = new Date('2026-08-14T11:19:47.688Z');
      const sameDay = new Date('2026-08-14T13:00:00.000Z');

      expect(isSubscriptionValid(expiresAt, sameDay)).toBe(true);
    });

    it('treats an unparseable expiry as expired, not as never-expiring', () => {
      expect(isSubscriptionValid('not-a-date')).toBe(false);
    });
  });

  describe('subscriptionGraceEnd', () => {
    it('returns the last millisecond of the expiry day in IST', () => {
      // 14 Aug 23:59:59.999 IST === 14 Aug 18:29:59.999 UTC
      expect(
        subscriptionGraceEnd('2026-08-14T11:19:47.688Z')?.toISOString()
      ).toBe('2026-08-14T18:29:59.999Z');
    });

    it('uses the IST calendar day, not the UTC one', () => {
      // 20:00 UTC on the 14th is already 01:30 IST on the 15th, so the grace
      // window must run to the end of the 15th in IST.
      expect(
        subscriptionGraceEnd('2026-08-14T20:00:00.000Z')?.toISOString()
      ).toBe('2026-08-15T18:29:59.999Z');
    });

    it('returns null for missing or invalid input', () => {
      expect(subscriptionGraceEnd(null)).toBeNull();
      expect(subscriptionGraceEnd('nonsense')).toBeNull();
    });
  });
});
