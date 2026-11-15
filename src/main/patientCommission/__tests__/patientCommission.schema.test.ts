import {
  clinicPricingChangeSchema,
  defaultPricingChangeSchema,
  doctorAppointmentsQuerySchema,
  periodQuerySchema,
} from '../schemas/patientCommission.schema';

const reason = 'Volume pricing agreed with the clinic';
const tiers = [
  { fromPatients: 0, ratePerPatient: 10 },
  { fromPatients: 500, ratePerPatient: 8 },
  { fromPatients: 1000, ratePerPatient: 6 },
];

describe('defaultPricingChangeSchema', () => {
  it('accepts the standard three tiers', () => {
    expect(
      defaultPricingChangeSchema.safeParse({ periodKind: 'monthly', tiers, reason })
        .success
    ).toBe(true);
  });

  it('accepts a half-monthly period', () => {
    expect(
      defaultPricingChangeSchema.safeParse({
        periodKind: 'half_monthly',
        tiers,
        reason,
      }).success
    ).toBe(true);
  });

  it('needs the first tier to start at 0', () => {
    const bad = [{ fromPatients: 10, ratePerPatient: 10 }];
    expect(
      defaultPricingChangeSchema.safeParse({ periodKind: 'monthly', tiers: bad, reason })
        .success
    ).toBe(false);
  });

  it('needs tiers to start at more patients each time', () => {
    const bad = [
      { fromPatients: 0, ratePerPatient: 10 },
      { fromPatients: 500, ratePerPatient: 8 },
      { fromPatients: 500, ratePerPatient: 6 },
    ];
    expect(
      defaultPricingChangeSchema.safeParse({ periodKind: 'monthly', tiers: bad, reason })
        .success
    ).toBe(false);
  });

  it('rejects more than two decimal places, negative rates and rates over ₹1000', () => {
    for (const rate of [7.555, -1, 1000.5]) {
      expect(
        defaultPricingChangeSchema.safeParse({
          periodKind: 'monthly',
          tiers: [{ fromPatients: 0, ratePerPatient: rate }],
          reason,
        }).success
      ).toBe(false);
    }
  });

  it('accepts a rate with paise', () => {
    expect(
      defaultPricingChangeSchema.safeParse({
        periodKind: 'monthly',
        tiers: [{ fromPatients: 0, ratePerPatient: 7.5 }],
        reason,
      }).success
    ).toBe(true);
  });

  it('rejects an unknown period kind, no tiers and more than ten tiers', () => {
    expect(
      defaultPricingChangeSchema.safeParse({ periodKind: 'weekly', tiers, reason })
        .success
    ).toBe(false);
    expect(
      defaultPricingChangeSchema.safeParse({ periodKind: 'monthly', tiers: [], reason })
        .success
    ).toBe(false);
    const many = Array.from({ length: 11 }, (_, i) => ({
      fromPatients: i * 10,
      ratePerPatient: 5,
    }));
    expect(
      defaultPricingChangeSchema.safeParse({ periodKind: 'monthly', tiers: many, reason })
        .success
    ).toBe(false);
  });

  it('needs a reason of at least five words', () => {
    expect(
      defaultPricingChangeSchema.safeParse({
        periodKind: 'monthly',
        tiers,
        reason: 'too short',
      }).success
    ).toBe(false);
  });
});

describe('clinicPricingChangeSchema', () => {
  it('accepts going back to the platform default', () => {
    expect(
      clinicPricingChangeSchema.safeParse({ useDefault: true, reason }).success
    ).toBe(true);
  });

  it("accepts the clinic's own pricing", () => {
    expect(
      clinicPricingChangeSchema.safeParse({
        useDefault: false,
        periodKind: 'monthly',
        tiers,
        reason,
      }).success
    ).toBe(true);
  });

  it('rejects its own pricing without tiers', () => {
    expect(
      clinicPricingChangeSchema.safeParse({
        useDefault: false,
        periodKind: 'monthly',
        reason,
      }).success
    ).toBe(false);
  });
});

describe('query schemas', () => {
  it('accepts a real YYYY-MM-DD date and no date', () => {
    expect(periodQuerySchema.safeParse({ date: '2026-11-14' }).success).toBe(true);
    expect(periodQuerySchema.safeParse({}).success).toBe(true);
  });

  it('rejects a malformed or impossible date', () => {
    expect(periodQuerySchema.safeParse({ date: '14-11-2026' }).success).toBe(false);
    expect(periodQuerySchema.safeParse({ date: '2026-13-45' }).success).toBe(false);
  });

  it('pages with sensible defaults and a cap', () => {
    expect(doctorAppointmentsQuerySchema.parse({})).toEqual({
      pageNumber: 1,
      pageSize: 25,
    });
    expect(
      doctorAppointmentsQuerySchema.safeParse({ pageSize: 500 }).success
    ).toBe(false);
  });
});
