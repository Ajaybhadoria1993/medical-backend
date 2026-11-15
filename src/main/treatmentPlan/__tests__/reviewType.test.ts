import { templateBodySchema } from '../schemas/template.schema';
import { planCreateSchema } from '../schemas/plan.schema';
import { buildPreview } from '../utils/templatePreview.utils';
import { earliestDates, packageGaps } from '../utils/timing.utils';

const reviewTemplate = {
  name: 'Diabetes review',
  specialty: 'General Physician',
  planType: 'review',
  pricingMode: 'per_step',
  sessionCount: 4,
  intervalDays: 84,
  steps: [{ name: 'Diabetes review', gapDays: 0, fee: '500' }],
};

const messages = (r: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) => (r.success ? [] : r.error!.issues.map((i) => i.message));

describe('Review template rules (Q28)', () => {
  it('accepts one review step with a count and a gap', () => {
    expect(templateBodySchema.safeParse(reviewTemplate).success).toBe(true);
  });

  it('needs exactly one review step', () => {
    const none = templateBodySchema.safeParse({ ...reviewTemplate, steps: [] });
    expect(messages(none)).toContain(
      'A review plan has one review step with its fee'
    );
  });

  it('needs the number of reviews and the days between them', () => {
    const r = templateBodySchema.safeParse({
      ...reviewTemplate,
      sessionCount: null,
      intervalDays: null,
    });
    expect(messages(r)).toEqual(
      expect.arrayContaining([
        'Enter the number of reviews',
        'Enter the days between reviews',
      ])
    );
  });

  it('refuses package pricing, package fields and instalments', () => {
    const r = templateBodySchema.safeParse({
      ...reviewTemplate,
      pricingMode: 'package',
      packagePrice: '2000',
      packageExpiryDays: 365,
      instalmentsAllowed: true,
    });
    expect(messages(r)).toEqual(
      expect.arrayContaining([
        'Reviews are paid per visit',
        'Package price and valid-for days are only for packages',
        'Instalments are only for packages',
      ])
    );
  });
});

describe('Review preview', () => {
  it('names Review 1…4, spaces them by the gap and totals fee × count', () => {
    const preview = buildPreview(
      {
        planType: 'review',
        pricingMode: 'per_step',
        sessionCount: 4,
        intervalDays: 84,
        steps: [{ gapDays: 0, fee: '500' }],
      },
      '2026-10-24'
    );
    expect(preview.dates).toEqual([
      { seq: 1, name: 'Review 1', date: '2026-10-24' },
      { seq: 2, name: 'Review 2', date: '2027-01-16' },
      { seq: 3, name: 'Review 3', date: '2027-04-10' },
      { seq: 4, name: 'Review 4', date: '2027-07-03' },
    ]);
    expect(preview.totalAmount).toBe('2000.00');
    expect(preview.feesMissing).toBe(0);
  });

  it('reports the fee as missing while it is blank', () => {
    const preview = buildPreview(
      {
        planType: 'review',
        pricingMode: 'per_step',
        sessionCount: 4,
        intervalDays: 84,
        steps: [{ gapDays: 0, fee: null }],
      },
      '2026-10-24'
    );
    expect(preview.totalAmount).toBeNull();
    expect(preview.feesMissing).toBe(1);
  });
});

describe('Review dates on a plan', () => {
  it('counts the next review from the day the last one was done', () => {
    const gaps = packageGaps(3, 84);
    const dates = earliestDates(
      '2026-10-24',
      gaps.map((gapDays, i) => ({
        gapDays,
        status: i === 0 ? 'done' : 'pending',
        // Review 1 happened 10 days late; review 2 moves with it.
        doneOn: i === 0 ? '2026-11-03' : null,
        bookedOn: null,
      }))
    );
    expect(dates).toEqual(['2026-10-24', '2027-01-26', null]);
  });
});

describe('Review plan body', () => {
  const plan = {
    patientId: '00000000-0000-4000-8000-000000000001',
    title: 'Diabetes review',
    diagnosis: 'Type 2 diabetes',
    planType: 'review',
    pricingMode: 'per_step',
    steps: [{ name: 'Diabetes review 1', gapDays: 0, fee: '500' }],
  };

  it('is paid per visit', () => {
    const r = planCreateSchema.safeParse({ ...plan, pricingMode: 'package' });
    expect(messages(r)).toContain('Reviews are paid per visit');
  });

  it('has no package price or valid-for days', () => {
    const r = planCreateSchema.safeParse({ ...plan, packagePrice: '2000' });
    expect(messages(r)).toContain(
      'Package price and valid-for days are only for packages'
    );
  });
});
