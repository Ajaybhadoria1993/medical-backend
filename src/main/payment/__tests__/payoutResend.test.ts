import {
  BANK_CHECKS_LOCKED,
  destinationFingerprint,
  isPayoutDestinationReason,
  maskAccountNumber,
} from '../utils/payoutAccount.utils';

jest.mock('../../../utils/razorpay', () => ({
  normalizeRazorpayDocumentType: jest.fn(),
}));

const bank = (accountNumber: string, ifscCode = 'HDFC0000123') => ({
  bankDetails: { accountNumber, ifscCode },
});

describe('spotting a resend of the same payout details', () => {
  it('same bank details give the same fingerprint, ignoring spaces and IFSC case', () => {
    expect(destinationFingerprint(bank('1234 5678 90', 'hdfc0000123'))).toBe(
      destinationFingerprint(bank('1234567890'))
    );
  });

  it('a different account, IFSC or a UPI ID gives a different fingerprint', () => {
    const base = destinationFingerprint(bank('1234567890'));
    expect(destinationFingerprint(bank('1234567891'))).not.toBe(base);
    expect(destinationFingerprint(bank('1234567890', 'SBIN0000001'))).not.toBe(
      base
    );
    expect(destinationFingerprint({ upi: { vpa: 'dr@okhdfc' } })).not.toBe(
      base
    );
  });

  it('never contains the account number itself, and is null with no destination', () => {
    expect(destinationFingerprint(bank('1234567890'))).not.toContain(
      '1234567890'
    );
    expect(destinationFingerprint({})).toBeNull();
  });
});

describe('which Razorpay reasons are about the payout destination', () => {
  it('bank, IFSC, holder name, UPI and the lock message count', () => {
    for (const r of [
      'bank IFSC code: invalid',
      'bank account holder name mismatch',
      'UPI ID inactive',
      BANK_CHECKS_LOCKED,
    ])
      expect(isPayoutDestinationReason(r)).toBe(true);
  });

  it('KYC or business reasons do not', () => {
    expect(
      isPayoutDestinationReason('Business PAN does not match the name')
    ).toBe(false);
    expect(isPayoutDestinationReason(null)).toBe(false);
  });
});

describe('stored account numbers', () => {
  it('keeps only the last 4 digits, whatever Razorpay returns', () => {
    expect(maskAccountNumber('891610110008050')).toBe('XXXX8050');
    expect(maskAccountNumber('XXXXXX1234')).toBe('XXXX1234');
    expect(maskAccountNumber(null)).toBeNull();
  });
});
