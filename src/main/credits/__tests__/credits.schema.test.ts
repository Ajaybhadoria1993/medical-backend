// Request validation: settings ranges, reasons, credit amounts, report dates.
import {
  costReportQuerySchema,
  creditChangeSchema,
  settingsChangeSchema,
} from '../schemas/credits.schema';

const settings = {
  expiryDays: 365,
  reminderDays: 7,
  warnPercent: 80,
  unitCostInr: '0.1150',
  taxPercent: '18.00',
  reason: 'Meta rate change 1 Jan 2027',
};

describe('settingsChangeSchema', () => {
  it('accepts a valid change, with or without a start time', () => {
    expect(settingsChangeSchema.safeParse(settings).success).toBe(true);
    expect(
      settingsChangeSchema.safeParse({
        ...settings,
        effectiveFrom: '2027-01-01T00:00:00+05:30',
      }).success
    ).toBe(true);
  });

  it('needs the reminder to come before expiry', () => {
    expect(
      settingsChangeSchema.safeParse({ ...settings, reminderDays: 365 }).success
    ).toBe(false);
  });

  it('keeps money exact: at most 4 decimals for the rate, tax at most 100%', () => {
    expect(
      settingsChangeSchema.safeParse({ ...settings, unitCostInr: '0.11505' })
        .success
    ).toBe(false);
    expect(
      settingsChangeSchema.safeParse({ ...settings, taxPercent: '101' }).success
    ).toBe(false);
    expect(
      settingsChangeSchema.safeParse({ ...settings, unitCostInr: 0.115 })
        .success
    ).toBe(false);
  });

  it('requires a real reason and a warning point between 1 and 99', () => {
    expect(
      settingsChangeSchema.safeParse({ ...settings, reason: ' ok ' }).success
    ).toBe(false);
    expect(
      settingsChangeSchema.safeParse({ ...settings, warnPercent: 100 }).success
    ).toBe(false);
  });
});

describe('creditChangeSchema', () => {
  it('defaults to whatsapp and needs whole, positive credits', () => {
    const ok = creditChangeSchema.parse({
      credits: 500,
      reason: 'Goodwill credit',
    });
    expect(ok.creditType).toBe('whatsapp');
    expect(
      creditChangeSchema.safeParse({ credits: 0, reason: 'Goodwill credit' })
        .success
    ).toBe(false);
    expect(
      creditChangeSchema.safeParse({ credits: 1.5, reason: 'Goodwill credit' })
        .success
    ).toBe(false);
  });

  it('rejects an unknown credit type', () => {
    expect(
      creditChangeSchema.safeParse({
        creditType: 'sms',
        credits: 5,
        reason: 'Goodwill credit',
      }).success
    ).toBe(false);
  });
});

describe('costReportQuerySchema', () => {
  it('needs IST dates with from not after to', () => {
    expect(
      costReportQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-30' })
        .success
    ).toBe(true);
    expect(
      costReportQuerySchema.safeParse({ from: '2026-12-01', to: '2026-11-30' })
        .success
    ).toBe(false);
    expect(
      costReportQuerySchema.safeParse({ from: '01-11-2026', to: '2026-11-30' })
        .success
    ).toBe(false);
  });

  it('caps the page size at 100', () => {
    expect(
      costReportQuerySchema.safeParse({
        from: '2026-11-01',
        to: '2026-11-30',
        pageSize: 500,
      }).success
    ).toBe(false);
  });
});
