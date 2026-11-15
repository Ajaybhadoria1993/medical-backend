import { buildPreview } from '../utils/templatePreview.utils';

describe('buildPreview', () => {
  it('root canal: dates, fee total in paise and 15 days (T12)', () => {
    const fees = ['2000', '2000', '1500', '2500', '3000'];
    const preview = buildPreview(
      {
        planType: 'staged',
        pricingMode: 'per_step',
        steps: [0, 2, 3, 3, 7].map((gapDays, i) => ({
          name: `Step ${i + 1}`,
          gapDays,
          fee: fees[i],
        })),
      },
      '2026-10-12'
    );
    expect(preview.dates.map((d) => d.date)).toEqual([
      '2026-10-12',
      '2026-10-14',
      '2026-10-17',
      '2026-10-20',
      '2026-10-27',
    ]);
    expect(preview.totalAmount).toBe('11000.00');
    expect(preview.durationDays).toBe(15);
  });

  it('adds paise exactly (0.10 + 0.20)', () => {
    const preview = buildPreview(
      {
        planType: 'staged',
        pricingMode: 'per_step',
        steps: [
          { gapDays: 0, fee: '0.10' },
          { gapDays: 1, fee: '0.20' },
        ],
      },
      '2026-10-12'
    );
    expect(preview.totalAmount).toBe('0.30');
  });

  it('keeps a running total and counts the steps still without a fee', () => {
    const preview = buildPreview(
      {
        planType: 'staged',
        pricingMode: 'per_step',
        steps: [{ gapDays: 0, fee: '500' }, { gapDays: 2 }],
      },
      '2026-10-12'
    );
    expect(preview.totalAmount).toBe('500.00');
    expect(preview.feesMissing).toBe(1);
  });

  it('package: sessions named in order, priced as the package', () => {
    const preview = buildPreview(
      {
        planType: 'package',
        pricingMode: 'package',
        packagePrice: '15000',
        sessionCount: 6,
        intervalDays: 28,
        steps: [],
      },
      '2026-10-12'
    );
    expect(preview.dates).toHaveLength(6);
    expect(preview.dates[5]).toEqual({
      seq: 6,
      name: 'Session 6',
      date: '2027-03-01',
    });
    expect(preview.totalAmount).toBe('15000');
    expect(preview.durationDays).toBe(140);
  });
});
