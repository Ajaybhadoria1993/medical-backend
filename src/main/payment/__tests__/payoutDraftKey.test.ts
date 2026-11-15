import {
  parseRouteDraft,
  serializeRouteDraft,
} from '../utils/payoutAccount.utils';

jest.mock('../../../utils/razorpay', () => ({
  normalizeRazorpayDocumentType: jest.fn(),
}));

const MFA = 'a'.repeat(64);
const PAYOUT = 'b'.repeat(64);
const draft = { stakeholder: { pan: 'ABCPS1234K' } };

describe('payout draft encryption key', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('uses PAYOUT_ENCRYPTION_KEY, so a broken MFA key does not block payouts', () => {
    process.env.PAYOUT_ENCRYPTION_KEY = PAYOUT;
    process.env.MFA_ENCRYPTION_KEY = 'not-a-key';
    expect(parseRouteDraft(serializeRouteDraft(draft))).toEqual(draft);
  });

  it('falls back to the MFA key when no payout key is set', () => {
    delete process.env.PAYOUT_ENCRYPTION_KEY;
    process.env.MFA_ENCRYPTION_KEY = MFA;
    expect(parseRouteDraft(serializeRouteDraft(draft))).toEqual(draft);
  });

  it('still reads a draft sealed with the MFA key after a payout key is added', () => {
    delete process.env.PAYOUT_ENCRYPTION_KEY;
    process.env.MFA_ENCRYPTION_KEY = MFA;
    const old = serializeRouteDraft(draft);
    process.env.PAYOUT_ENCRYPTION_KEY = PAYOUT;
    expect(parseRouteDraft(old)).toEqual(draft);
  });

  it('names the payout key in the error when it is malformed', () => {
    process.env.PAYOUT_ENCRYPTION_KEY = 'x'.repeat(65);
    expect(() => serializeRouteDraft(draft)).toThrow(/PAYOUT_ENCRYPTION_KEY/);
  });
});
