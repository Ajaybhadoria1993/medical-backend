import { renewalCaptureFields } from '../utils/renewalCapture.utils';

const chargedAt = new Date('2026-12-04T09:00:00Z');
const periodEnd = new Date('2027-01-05T00:00:00Z');
const base = {
  cancelAtPeriodEnd: false,
  cancelledAt: null,
  scheduledPlanId: null,
  switching: false,
  chargedAt,
  periodEnd,
};

describe('renewalCaptureFields', () => {
  it('keeps a cancel made after the renewal was charged, so the new period is the last', () => {
    const out = renewalCaptureFields({
      ...base,
      cancelAtPeriodEnd: true,
      cancelledAt: new Date('2026-12-04T15:00:00Z'),
    });
    expect(out).not.toHaveProperty('cancelAtPeriodEnd');
  });

  it('withdraws a cancel made before the charge, as paying the renewal always did', () => {
    const out = renewalCaptureFields({
      ...base,
      cancelAtPeriodEnd: true,
      cancelledAt: new Date('2026-12-01T10:00:00Z'),
    });
    expect(out).toMatchObject({ cancelAtPeriodEnd: false, cancelledAt: null });
  });

  it('moves a downgrade this renewal did not pay for to the end of the new period', () => {
    const out = renewalCaptureFields({
      ...base,
      scheduledPlanId: 'plan-clinic',
    });
    expect(out).toMatchObject({ scheduledChangeAt: periodEnd });
  });

  it('leaves the switch alone when the renewal paid for the scheduled plan', () => {
    const out = renewalCaptureFields({
      ...base,
      scheduledPlanId: 'plan-clinic',
      switching: true,
    });
    expect(out).not.toHaveProperty('scheduledChangeAt');
  });
});
