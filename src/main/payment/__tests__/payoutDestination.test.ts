import { payoutAccountBankSchema } from '../schemas/payoutAccount.schemas';
import { PayoutAccountStatusService } from '../services/payoutAccount/payoutAccountStatus.service';

jest.mock('../../../configurations/dbConnection', () => ({ database: {} }));
jest.mock('../../../utils/razorpay', () => ({}));
jest.mock('../../../utils/logger');

const bank = {
  beneficiaryName: 'Anita Rao',
  accountNumber: '1234 5678 9012',
  ifscCode: 'hdfc0000123',
  accountType: 'savings',
};

describe('change where payouts go: request body', () => {
  it('accepts a UPI ID', () => {
    const out = payoutAccountBankSchema.parse({
      method: 'upi',
      upi: { vpa: 'Dr.Rao@OKHDFC', beneficiaryName: 'Anita Rao' },
    });
    expect(out).toEqual({
      method: 'upi',
      upi: { vpa: 'dr.rao@okhdfc', beneficiaryName: 'Anita Rao' },
    });
  });

  it('accepts a bank account', () => {
    const out = payoutAccountBankSchema.parse({ method: 'bank', bank });
    expect(out).toMatchObject({
      method: 'bank',
      bank: { accountNumber: '123456789012', ifscCode: 'HDFC0000123' },
    });
  });

  it('treats an old bank-only body (older apps) as a bank account', () => {
    expect(payoutAccountBankSchema.parse(bank)).toMatchObject({
      method: 'bank',
      bank: { accountNumber: '123456789012' },
    });
  });

  it('refuses a malformed UPI ID', () => {
    expect(() =>
      payoutAccountBankSchema.parse({
        method: 'upi',
        upi: { vpa: 'no-at-sign', beneficiaryName: 'Anita' },
      })
    ).toThrow();
  });
});

// Private by design (one caller); reached here to pin how Razorpay's reply becomes bank history.
const read = (config: unknown) =>
  (PayoutAccountStatusService as any).payoutDestination(config);

describe('reading the payout destination back from Razorpay', () => {
  it('a UPI destination is stored masked', () => {
    expect(
      read({
        settlement_accounts: [
          {
            method: 'upi',
            upi: {
              vpa: 'drrao@okhdfc',
              beneficiary_name: 'Anita',
              is_default: true,
            },
          },
        ],
      })
    ).toEqual({
      account: 'dr••@okhdfc',
      ifsc: null,
      name: 'Anita',
      bankName: 'UPI',
    });
  });

  it('a switched-to bank account comes from settlement_accounts', () => {
    expect(
      read({
        settlement_accounts: [
          {
            method: 'bank_account',
            bank_account: {
              account_number: 'XXXX9012',
              code: 'HDFC0000123',
              beneficiary_name: 'Anita',
              is_default: true,
            },
          },
        ],
      })
    ).toMatchObject({
      account: 'XXXX9012',
      ifsc: 'HDFC0000123',
      bankName: null,
    });
  });

  it('falls back to legacy settlements, and to nothing', () => {
    expect(
      read({
        settlements: {
          account_number: 'XXXX1111',
          ifsc_code: 'SBIN0000001',
          beneficiary_name: 'A',
        },
      })
    ).toMatchObject({ account: 'XXXX1111', ifsc: 'SBIN0000001' });
    expect(read({})).toBeNull();
  });
});
