import { activationOutcome } from '../utils/activation.utils';

const open = { status: 'created', providerPaymentId: null };

describe('activationOutcome', () => {
  it('applies an open checkout for an owner on Free or a trial', () => {
    expect(activationOutcome(open, 'pay_1', false)).toBe('apply');
  });

  it('applies an abandoned checkout that was paid later', () => {
    expect(
      activationOutcome(
        { status: 'abandoned', providerPaymentId: null },
        'pay_1',
        false
      )
    ).toBe('apply');
  });

  it('treats paying while already on a paid plan as a duplicate', () => {
    expect(activationOutcome(open, 'pay_1', true)).toBe('duplicate');
  });

  it('returns the earlier result when the same payment is reported again', () => {
    expect(
      activationOutcome(
        { status: 'captured', providerPaymentId: 'pay_1' },
        'pay_1',
        true
      )
    ).toBe('already_applied');
  });

  it('treats a second payment on an already paid order as a duplicate', () => {
    expect(
      activationOutcome(
        { status: 'captured', providerPaymentId: 'pay_1' },
        'pay_2',
        true
      )
    ).toBe('duplicate');
  });

  it('refuses a checkout that failed before an order existed', () => {
    expect(
      activationOutcome(
        { status: 'failed', providerPaymentId: null },
        'pay_1',
        false
      )
    ).toBe('not_open');
  });
});
