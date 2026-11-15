import {
  generateReferralCode,
  normalizeReferralCode,
} from '../utils/referralCode.utils';

describe('generateReferralCode', () => {
  it('is MEDI- plus 6 characters with no look-alike 0/O/1/I/L', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateReferralCode()).toMatch(/^MEDI-[A-HJKMNP-Z2-9]{6}$/);
    }
  });
});

describe('normalizeReferralCode', () => {
  it('matches a pasted lowercase code with spaces to its stored form', () => {
    expect(normalizeReferralCode('  medi-7kq2xb ')).toBe('MEDI-7KQ2XB');
  });
});
