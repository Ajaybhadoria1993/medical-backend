import { PayoutAccountStatusService } from '../services/payoutAccount/payoutAccountStatus.service';

jest.mock('../../../configurations/dbConnection', () => ({ database: {} }));
jest.mock('../../../utils/razorpay', () => ({}));
jest.mock('../../../utils/logger');

// Private by design (one caller); reached here to pin what the browser may see.
const mask = (d: Record<string, any>) =>
  (PayoutAccountStatusService as any).maskDetails(d);

describe('payout details sent to the browser', () => {
  it('never carries a full PAN, account number or date of birth', () => {
    const out = mask({
      legalBusinessName: 'Naya Clinic',
      businessPan: 'AAFCN1234K',
      stakeholder: { name: 'Anita Rao', pan: 'ABCPS1234K', dob: '1980-01-01' },
      bankDetails: { accountNumber: '123456789012', ifscCode: 'HDFC0000123' },
    });
    expect(out.businessPan).toBe('AAFCN••••K');
    expect(out.stakeholder).toMatchObject({
      name: 'Anita Rao',
      pan: 'ABCPS••••K',
      dob: undefined,
    });
    expect(out.bankDetails).toMatchObject({
      accountNumber: '••••9012',
      ifscCode: 'HDFC0000123',
    });
    expect(JSON.stringify(out)).not.toMatch(/1234K|123456789012/);
  });

  it('copes with a UPI-only form (no bank, no business PAN)', () => {
    const out = mask({
      stakeholder: { pan: 'ABCPS1234K' },
      upi: { vpa: 'dr@okhdfc' },
    });
    expect(out.businessPan).toBeUndefined();
    expect(out.bankDetails).toBeUndefined();
    expect(out.upi.vpa).toBe('dr@okhdfc');
  });
});
