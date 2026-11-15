import { HttpError } from '../../../middlewear/errorHandler';
import { PayoutAccountSetupService as Setup } from '../services/payoutAccount/payoutAccountSetup.service';
import { PayoutAccountStatusService as Status } from '../services/payoutAccount/payoutAccountStatus.service';
import { PayoutAccountSubmitService as Submit } from '../services/payoutAccount/payoutAccountSubmit.service';
import { payoutCard, plainBankReason } from '../utils/payoutAccountCard.utils';

jest.mock('../services/payoutAccount/payoutAccountSetup.service', () => ({
  PayoutAccountSetupService: {
    onboardRouteAccount: jest.fn(),
    uploadKYCDocuments: jest.fn(),
    activateRouteAccount: jest.fn(),
  },
}));
jest.mock('../services/payoutAccount/payoutAccountStatus.service', () => ({
  PayoutAccountStatusService: {
    getOnboardingStatus: jest.fn(),
    getActiveBankDetails: jest.fn(),
  },
}));
jest.mock('../utils/payoutAccount.utils', () => ({
  getRequiredDocumentsForBusinessType: () => [
    { documentType: 'personal_pan', label: 'Personal PAN', required: true },
    {
      documentType: 'gst_certificate',
      label: 'GST Certificate',
      required: false,
    },
  ],
  CANCELLED_CHEQUE_DOCUMENT: {
    documentType: 'cancelled_cheque',
    label: 'Cancelled Cheque',
    required: true,
  },
}));

// Stored onboarding status the service reads; uploaded document types are listed.
const status = (
  routeStatus: string,
  uploaded: string[] = [],
  accountId: string | null = 'acc_1'
) => ({
  accountId,
  routeStatus,
  rejectionReason: null,
  requiredDocuments: [],
  uploadedDocuments: uploaded.map((documentType) => ({
    documentType,
    status: 'uploaded',
  })),
});
const s = Status as unknown as {
  getOnboardingStatus: jest.Mock;
  getActiveBankDetails: jest.Mock;
};
const u = Setup as unknown as Record<string, jest.Mock>;
const pan = {
  fieldname: 'personal_pan',
  originalname: 'pan.pdf',
  mimetype: 'application/pdf',
  buffer: Buffer.from('x'),
};
const run = (files = [pan]) =>
  Submit.submit(
    'clinic',
    { businessType: 'individual' } as never,
    files,
    '1.1.1.1'
  );

beforeEach(() => {
  jest.clearAllMocks();
  s.getActiveBankDetails.mockResolvedValue(null);
});

describe('PayoutAccountSubmitService.submit', () => {
  it('runs account, documents, activation in order and returns the card', async () => {
    s.getOnboardingStatus.mockResolvedValue(status('INACTIVE', [], null));
    const order: string[] = [];
    u.onboardRouteAccount.mockImplementation(async () => order.push('account'));
    u.uploadKYCDocuments.mockImplementation(async () =>
      order.push('documents')
    );
    u.activateRouteAccount.mockImplementation(async () => {
      order.push('activation');
      s.getOnboardingStatus.mockResolvedValue(
        status('PENDING', ['personal_pan'])
      );
    });
    const card = await run();
    expect(order).toEqual(['account', 'documents', 'activation']);
    expect(card.state).toBe('verifying');
  });

  it('a Razorpay refusal returns the action-needed card with its stage', async () => {
    s.getOnboardingStatus.mockResolvedValue(status('DRAFT'));
    u.uploadKYCDocuments.mockRejectedValue(
      new HttpError(409, 'Razorpay rejected the file')
    );
    const card = await run();
    expect(card).toMatchObject({
      state: 'action_needed',
      failedStage: 'documents',
      reason: 'Razorpay rejected the file',
    });
    expect(u.activateRouteAccount).not.toHaveBeenCalled();
  });

  it('a refusal naming a form field goes back to the form, not the card', async () => {
    s.getOnboardingStatus.mockResolvedValue(status('INACTIVE', [], null));
    u.onboardRouteAccount.mockRejectedValue(
      new HttpError(422, 'This email is already used', { field: 'email' })
    );
    await expect(run()).rejects.toMatchObject({
      status: 422,
      details: { field: 'email' },
    });
  });

  it('details alone are enough: no documents still creates the account and activates', async () => {
    s.getOnboardingStatus.mockResolvedValue(status('INACTIVE', [], null));
    await run([]);
    expect(u.onboardRouteAccount).toHaveBeenCalled();
    expect(u.uploadKYCDocuments).not.toHaveBeenCalled();
    expect(u.activateRouteAccount).toHaveBeenCalled();
  });

  it('a cancelled cheque Razorpay asked for is accepted', async () => {
    s.getOnboardingStatus.mockResolvedValue(status('DRAFT'));
    await run([{ ...pan, fieldname: 'cancelled_cheque' }]);
    expect(u.uploadKYCDocuments).toHaveBeenCalledWith(
      'clinic',
      'cancelled_cheque',
      expect.anything(),
      'pan.pdf',
      'application/pdf'
    );
  });

  it('an unknown document field is a 422', async () => {
    s.getOnboardingStatus.mockResolvedValue(status('INACTIVE', [], null));
    await expect(run([{ ...pan, fieldname: 'selfie' }])).rejects.toMatchObject({
      status: 422,
    });
  });

  it('a clinic already verifying or ready is not run again', async () => {
    s.getOnboardingStatus.mockResolvedValue(status('ACTIVE'));
    expect((await run()).state).toBe('ready');
    expect(u.onboardRouteAccount).not.toHaveBeenCalled();
  });

  it('a non-HTTP error is a bug and surfaces', async () => {
    s.getOnboardingStatus.mockResolvedValue(status('INACTIVE', [], null));
    u.onboardRouteAccount.mockRejectedValue(new TypeError('boom'));
    await expect(run()).rejects.toThrow('boom');
  });
});

describe('payoutCard', () => {
  const card = (routeStatus: string, extra = {}) =>
    payoutCard(
      { ...status(routeStatus), rejectionReason: 'IFSC invalid', ...extra },
      {
        beneficiaryName: 'Dr Rao',
        bankName: 'HDFC',
        maskedAccountNumber: 'XXXXXX1234',
        ifscCode: 'HDFC0001',
      }
    );

  it.each([
    ['INACTIVE', 'not_set_up', 'Not Set Up'],
    ['DRAFT', 'action_needed', 'Action Needed'],
    ['PENDING', 'verifying', 'Verifying Bank'],
    ['ACTIVE', 'ready', 'Ready To Receive Payments'],
    ['NEEDS_CLARIFICATION', 'action_needed', 'Action Needed'],
    ['REJECTED', 'action_needed', 'Action Needed'],
    ['SUSPENDED', 'suspended', 'Suspended'],
  ])('%s → %s', (routeStatus, state, label) => {
    expect(card(routeStatus)).toMatchObject({ state, label });
  });

  it('no account yet is Not Set Up', () => {
    expect(card('DRAFT', { accountId: null }).state).toBe('not_set_up');
  });

  it('ready on UPI shows the UPI ID, no bank, and can still switch destination', () => {
    expect(
      card('ACTIVE', { submittedDetails: { upi: { vpa: 'drrao@okhdfcbank' } } })
    ).toMatchObject({
      upiId: 'drrao@okhdfcbank',
      bank: null,
      canChangeBank: true,
    });
  });

  it('ready on UPI after the form is erased reads the masked UPI ID from bank history', () => {
    const out = payoutCard(
      { ...status('ACTIVE'), submittedDetails: null },
      {
        beneficiaryName: 'Dr Rao',
        bankName: 'UPI',
        maskedAccountNumber: 'dr••@okhdfc',
        ifscCode: null,
      }
    );
    expect(out).toMatchObject({
      upiId: 'dr••@okhdfc',
      bank: null,
      canChangeBank: true,
    });
  });

  it('ready shows the bank with the last 4 digits only', () => {
    expect(card('ACTIVE')).toMatchObject({
      bank: { holder: 'Dr Rao', ifsc: 'HDFC0001', last4: '1234' },
      canChangeBank: true,
    });
  });

  it('an unfinished setup carries the saved form and uploaded files for a retry', () => {
    const c = payoutCard(
      {
        ...status('DRAFT', ['personal_pan']),
        submittedDetails: { legalBusinessName: 'Rao Clinic' },
      },
      null
    );
    expect(c.form).toEqual({
      details: { legalBusinessName: 'Rao Clinic' },
      uploadedDocuments: [{ documentType: 'personal_pan', fileName: null }],
    });
  });

  it('verifying and ready hide the form', () => {
    expect(card('PENDING').form).toBeNull();
    expect(card('ACTIVE').form).toBeNull();
  });

  it("action needed carries Razorpay's reason; other states hide the bank", () => {
    expect(card('REJECTED')).toMatchObject({
      reason: expect.stringMatching(/IFSC code isn't valid/),
      bank: null,
      canChangeBank: false,
    });
  });
});

describe('plainBankReason', () => {
  it('turns common bank refusals into plain words and leaves others alone', () => {
    expect(plainBankReason('Beneficiary name mismatch')).toMatch(
      /doesn't match your bank's records/
    );
    expect(plainBankReason('Invalid IFSC code provided')).toMatch(/Find IFSC/);
    expect(plainBankReason('Account number is invalid')).toMatch(
      /couldn't reach this bank account/
    );
    expect(plainBankReason('Business PAN is invalid')).toBe(
      'Business PAN is invalid'
    );
  });
});
