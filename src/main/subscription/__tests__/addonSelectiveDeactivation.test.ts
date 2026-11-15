import {
  scheduleCancelAddOnSchema,
  reduceAddOnQuantitySchema,
} from '../schemas/addon.schemas';

describe('AddOn Cancellation & Reduction Schemas', () => {
  describe('scheduleCancelAddOnSchema', () => {
    it('accepts an empty payload (default empty deactivateUserIds)', () => {
      const parsed = scheduleCancelAddOnSchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.deactivateUserIds).toEqual([]);
      }
    });

    it('accepts valid UUIDs, and drops a reason an older client still sends', () => {
      const validUuid = 'a1b2c3d4-e5f6-4890-a123-456789abcdef';
      const parsed = scheduleCancelAddOnSchema.safeParse({
        reason: 'Staff member resigned',
        deactivateUserIds: [validUuid],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toEqual({ deactivateUserIds: [validUuid] });
      }
    });

    it('rejects invalid UUID in deactivateUserIds', () => {
      const parsed = scheduleCancelAddOnSchema.safeParse({
        deactivateUserIds: ['not-a-uuid'],
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe('reduceAddOnQuantitySchema', () => {
    it('defaults reduceBy to 1 when omitted', () => {
      const parsed = reduceAddOnQuantitySchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.reduceBy).toBe(1);
        expect(parsed.data.deactivateUserIds).toEqual([]);
      }
    });

    it('accepts valid reduceBy and deactivateUserIds', () => {
      const validUuid = 'a1b2c3d4-e5f6-4890-a123-456789abcdef';
      const parsed = reduceAddOnQuantitySchema.safeParse({
        reduceBy: 2,
        deactivateUserIds: [validUuid],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.reduceBy).toBe(2);
        expect(parsed.data.deactivateUserIds).toEqual([validUuid]);
      }
    });

    it('rejects negative or zero reduceBy', () => {
      expect(reduceAddOnQuantitySchema.safeParse({ reduceBy: 0 }).success).toBe(
        false
      );
      expect(
        reduceAddOnQuantitySchema.safeParse({ reduceBy: -1 }).success
      ).toBe(false);
    });
  });

  describe('AddOnService.calculateProRatedPrice', () => {
    it('accurately calculates 7-day pro-rata for multi-quantity add-ons without premature unit rounding', () => {
      const { AddOnService } = require('../services/addon.service');
      // Create fixed expiration date 7 days from now
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 - 1000);

      // 6 Doctors @ ₹499/month (Total ₹2,994)
      const docProRata = AddOnService.calculateProRatedPrice(
        499,
        expiresAt,
        'monthly',
        6
      );
      // 6 Staff @ ₹99/month (Total ₹594)
      const staffProRata = AddOnService.calculateProRatedPrice(
        99,
        expiresAt,
        'monthly',
        6
      );
      // 2 GB Storage @ ₹199/month (Total ₹398)
      const storageProRata = AddOnService.calculateProRatedPrice(
        199,
        expiresAt,
        'monthly',
        2
      );

      expect(docProRata.proRatedPrice).toBe(698.6);
      expect(staffProRata.proRatedPrice).toBe(138.6);
      expect(storageProRata.proRatedPrice).toBe(92.87);

      const total = Number(
        (
          docProRata.proRatedPrice +
          staffProRata.proRatedPrice +
          storageProRata.proRatedPrice
        ).toFixed(2)
      );

      expect(total).toBe(930.07);
    });
  });
});
