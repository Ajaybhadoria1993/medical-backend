/**
 * Unit tests for the upper bound on configured token capacity.
 *
 * The bug these exist for: capacity was `positive()` with no ceiling, so a
 * mistyped "1000000" in the Working Shifts editor was accepted and stored. The
 * schedule it produced could never run — token numbers are themselves capped at
 * MAX_TOKEN_NUMBER, so every token past 999 was unissuable, and the day-total
 * shown to staff was nonsense.
 */

import {
  MAX_TOKEN_NUMBER,
  MAX_TOKENS_PER_SHIFT,
} from '../../appointments/schemas/appointment.schemas';
import { setSlotConfigSchema } from '../schemas/slotConfig.schemas';
import { updateDoctorScheamas } from '../../doctor/schemas/doctor.schemas';

describe('token capacity bound', () => {
  it('caps capacity at the token-number ceiling, so every configured token can be issued', () => {
    expect(MAX_TOKENS_PER_SHIFT).toBe(MAX_TOKEN_NUMBER);
  });

  describe('slot config (per-date override)', () => {
    const base = { forDate: '2026-08-14' };

    it('accepts a capacity at the bound', () => {
      const result = setSlotConfigSchema.safeParse({
        ...base,
        noOfPatients: MAX_TOKENS_PER_SHIFT,
      });
      expect(result.success).toBe(true);
    });

    it('rejects the mistyped six-digit capacity from the shifts editor', () => {
      const result = setSlotConfigSchema.safeParse({
        ...base,
        noOfPatients: 1000000,
      });
      expect(result.success).toBe(false);
    });

    it('still rejects zero and negatives', () => {
      expect(
        setSlotConfigSchema.safeParse({ ...base, noOfPatients: 0 }).success
      ).toBe(false);
      expect(
        setSlotConfigSchema.safeParse({ ...base, noOfPatients: -5 }).success
      ).toBe(false);
    });
  });

  describe('doctor weekly availability', () => {
    const availability = (overrides: Record<string, unknown>) => ({
      aivblity: [
        {
          dayOfWeek: 'Monday',
          startTime: '09:00',
          endTime: '17:00',
          isAvailable: true,
          notes: '',
          slotMinutes: 15,
          stepMinutes: 15,
          aivblityBreak: [],
          ...overrides,
        },
      ],
    });

    it('accepts a day-wide capacity at the bound', () => {
      const result = updateDoctorScheamas.safeParse(
        availability({ noOfPatients: MAX_TOKENS_PER_SHIFT })
      );
      expect(result.success).toBe(true);
    });

    it('rejects a day-wide capacity above the bound', () => {
      const result = updateDoctorScheamas.safeParse(
        availability({ noOfPatients: MAX_TOKENS_PER_SHIFT + 1 })
      );
      expect(result.success).toBe(false);
    });

    it('rejects an over-bound per-shift capacity, the field the editor writes', () => {
      const result = updateDoctorScheamas.safeParse(
        availability({
          shiftCapacities: [
            { sessionIndex: 1, noOfPatients: 20 },
            { sessionIndex: 2, noOfPatients: 1000000 },
          ],
        })
      );
      expect(result.success).toBe(false);
    });

    it('accepts differing per-shift capacities within the bound', () => {
      const result = updateDoctorScheamas.safeParse(
        availability({
          shiftCapacities: [
            { sessionIndex: 1, noOfPatients: 20 },
            { sessionIndex: 2, noOfPatients: 30 },
          ],
        })
      );
      expect(result.success).toBe(true);
    });
  });
});
