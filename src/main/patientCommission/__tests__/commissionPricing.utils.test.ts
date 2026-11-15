import type {
  CommissionTier,
  PricingVersionRow,
} from '../types/patientCommission.types';
import {
  DEFAULT_COMMISSION_PRICING,
  latestVersionAt,
  nextTierAfter,
  rateForPatients,
  resolvePricing,
  sortedTiers,
} from '../utils/commissionPricing.utils';

const tiers: CommissionTier[] = [
  { fromPatients: 0, ratePaise: 1000 },
  { fromPatients: 500, ratePaise: 800 },
  { fromPatients: 1000, ratePaise: 600 },
];

describe('DEFAULT_COMMISSION_PRICING', () => {
  it('is monthly: ₹10 below 500 patients, ₹8 from 500, ₹6 from 1000', () => {
    expect(DEFAULT_COMMISSION_PRICING.periodKind).toBe('monthly');
    expect(DEFAULT_COMMISSION_PRICING.tiers).toEqual(tiers);
  });
});

describe('rateForPatients', () => {
  it.each([
    [0, 1000],
    [1, 1000],
    [499, 1000],
    [500, 800],
    [999, 800],
    [1000, 600],
    [25000, 600],
  ])('%i patients cost %i paise each', (patients, expected) => {
    expect(rateForPatients(tiers, patients)).toBe(expected);
  });

  it('prices every patient at the tier reached, not only the ones above it', () => {
    expect(rateForPatients(tiers, 500) * 500).toBe(400000);
  });

  it('works when the tiers arrive out of order', () => {
    expect(rateForPatients([...tiers].reverse(), 700)).toBe(800);
  });

  it('is 0 when there are no tiers', () => {
    expect(rateForPatients([], 10)).toBe(0);
  });
});

describe('nextTierAfter', () => {
  it('says how many more patients reach the next rate', () => {
    expect(nextTierAfter(tiers, 480)).toEqual({
      atPatients: 500,
      ratePaise: 800,
      remaining: 20,
    });
    expect(nextTierAfter(tiers, 500)).toEqual({
      atPatients: 1000,
      ratePaise: 600,
      remaining: 500,
    });
  });

  it('is null on the last tier', () => {
    expect(nextTierAfter(tiers, 1000)).toBeNull();
    expect(nextTierAfter(tiers, 5000)).toBeNull();
  });
});

describe('sortedTiers', () => {
  it('returns a sorted copy and leaves the input alone', () => {
    const input = [...tiers].reverse();
    expect(sortedTiers(input)).toEqual(tiers);
    expect(input[0].fromPatients).toBe(1000);
  });
});

const row = (
  effectiveFrom: string,
  over: Partial<PricingVersionRow> = {}
): PricingVersionRow => ({
  clinicId: null,
  periodKind: 'monthly',
  tiers,
  effectiveFrom: new Date(effectiveFrom),
  ...over,
});

describe('latestVersionAt', () => {
  const rows = [row('2026-01-01T00:00:00Z'), row('2026-06-01T00:00:00Z')];

  it('picks the newest version already in force', () => {
    expect(
      latestVersionAt(rows, new Date('2026-07-01T00:00:00Z'))?.effectiveFrom
    ).toEqual(new Date('2026-06-01T00:00:00Z'));
  });

  it('ignores a version that has not started yet', () => {
    expect(
      latestVersionAt(rows, new Date('2026-03-01T00:00:00Z'))?.effectiveFrom
    ).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it('starts exactly at effectiveFrom', () => {
    expect(
      latestVersionAt(rows, new Date('2026-06-01T00:00:00Z'))?.effectiveFrom
    ).toEqual(new Date('2026-06-01T00:00:00Z'));
  });

  it('is null before the first version', () => {
    expect(latestVersionAt(rows, new Date('2025-01-01T00:00:00Z'))).toBeNull();
  });
});

describe('resolvePricing', () => {
  const at = new Date('2026-11-14T00:00:00Z');
  const platform = row('2026-01-01T00:00:00Z', {
    tiers: [{ fromPatients: 0, ratePaise: 900 }],
  });
  const own = row('2026-05-01T00:00:00Z', {
    clinicId: 'clinic-1',
    periodKind: 'half_monthly',
    tiers: [{ fromPatients: 0, ratePaise: 700 }],
  });

  it('falls back to the built-in default when nothing is stored', () => {
    expect(resolvePricing([], [], at)).toEqual({
      pricing: DEFAULT_COMMISSION_PRICING,
      source: 'default',
    });
  });

  it('uses the saved platform default over the built-in one', () => {
    const { pricing, source } = resolvePricing([], [platform], at);
    expect(source).toBe('default');
    expect(pricing.tiers).toEqual([{ fromPatients: 0, ratePaise: 900 }]);
  });

  it("uses the clinic's own pricing, including its period kind", () => {
    const { pricing, source } = resolvePricing([own], [platform], at);
    expect(source).toBe('clinic');
    expect(pricing.periodKind).toBe('half_monthly');
    expect(pricing.tiers[0].ratePaise).toBe(700);
  });

  it('goes back to the platform default when the newest clinic row follows it', () => {
    const reset = row('2026-09-01T00:00:00Z', {
      clinicId: 'clinic-1',
      periodKind: null,
      tiers: null,
    });
    expect(resolvePricing([own, reset], [platform], at).source).toBe('default');
  });

  it('keeps the old pricing until a scheduled change starts', () => {
    const scheduled = row('2026-12-01T00:00:00Z', {
      clinicId: 'clinic-1',
      tiers: [{ fromPatients: 0, ratePaise: 500 }],
    });
    expect(
      resolvePricing([own, scheduled], [platform], at).pricing.tiers[0]
        .ratePaise
    ).toBe(700);
    expect(
      resolvePricing([own, scheduled], [platform], new Date('2026-12-01T00:00:00Z'))
        .pricing.tiers[0].ratePaise
    ).toBe(500);
  });
});
