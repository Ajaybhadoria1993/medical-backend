import {
  scheduleCancelAddOnSchema,
  reduceAddOnQuantitySchema,
  cancellationPreviewQuerySchema,
} from '../schemas/addon.schemas';

describe('AddOn Cancellation & Reduction Schemas', () => {
  describe('scheduleCancelAddOnSchema', () => {
    it('accepts an empty payload (no reason, default empty deactivateUserIds)', () => {
      const parsed = scheduleCancelAddOnSchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.deactivateUserIds).toEqual([]);
      }
    });

    it('accepts reason and valid UUIDs in deactivateUserIds', () => {
      const validUuid = 'a1b2c3d4-e5f6-4890-a123-456789abcdef';
      const parsed = scheduleCancelAddOnSchema.safeParse({
        reason: 'Staff member resigned',
        deactivateUserIds: [validUuid],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.reason).toBe('Staff member resigned');
        expect(parsed.data.deactivateUserIds).toEqual([validUuid]);
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

  describe('cancellationPreviewQuerySchema', () => {
    it('coerces string query param reduceBy to number', () => {
      const parsed = cancellationPreviewQuerySchema.safeParse({
        reduceBy: '2',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.reduceBy).toBe(2);
      }
    });

    it('accepts empty query param', () => {
      const parsed = cancellationPreviewQuerySchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.reduceBy).toBeUndefined();
      }
    });
  });
});
