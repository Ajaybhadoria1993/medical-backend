import { onboardRouteSchema } from '../schemas/clinic.schemas';
import { PayoutAccountSetupService } from '../../payment/services/payoutAccount/payoutAccountSetup.service';
import { database } from '../../../configurations/dbConnection';
import * as razorpayUtils from '../../../utils/razorpay';
import { HttpError } from '../../../middlewear/errorHandler';

jest.mock('../../../configurations/dbConnection');
jest.mock('../../../utils/logger');
jest.mock('sharp', () => () => ({
  metadata: jest.fn().mockResolvedValue({ format: 'jpeg' }),
  stats: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../utils/razorpay', () => {
  const actual = jest.requireActual('../../../utils/razorpay');
  return {
    ...actual,
    createRazorpayRouteAccount: jest.fn(),
    createRazorpayStakeholder: jest.fn(),
  };
});
jest.mock('../../../utils/mfaCrypto', () => ({
  encrypt: jest.fn(() => 'encrypted-draft-data'),
  decrypt: jest.fn(() => JSON.stringify({ mock: true })),
}));
jest.mock('../../../configurations/redisConfig', () => ({
  __esModule: true,
  default: { get: jest.fn(), setex: jest.fn(), del: jest.fn() },
}));
jest.mock('../../realtime/services/realtimeBus.service', () => ({
  realtimeBus: {
    attach: jest.fn(),
    notifySessionInvalidated: jest.fn(),
    notify: jest.fn(),
  },
}));

type Chain = { [method: string]: unknown };

const createChain = (finalValue: unknown, onSet?: jest.Mock): Chain => {
  const chain: Chain = {};
  [
    'from',
    'where',
    'limit',
    'select',
    'returning',
    'values',
    'onConflictDoUpdate',
    'leftJoin',
    'innerJoin',
    'orderBy',
    'insert',
    'update',
  ].forEach((m) => {
    chain[m] = jest.fn(() => chain);
  });
  chain.set = jest.fn((payload: unknown) => {
    onSet?.(payload);
    return chain;
  });
  chain.then = (resolve: (value: unknown) => void) => resolve(finalValue);
  return chain;
};

describe('Clinic Route Onboarding Error Handling', () => {
  // ABCPD1234P has 'P' as the 4th character (index 3), which represents an Individual PAN
  const validIndividualPayload = {
    legalBusinessName: 'Sharma Clinic',
    businessType: 'individual',
    businessPan: 'ABCPD1234P',
    address: {
      street1: '392 North Ave',
      street2: 'Vijay Nagar',
      city: 'Indore',
      state: 'Madhya Pradesh',
      postalCode: 452010,
    },
    stakeholder: {
      name: 'Amit Verma',
      email: 'amitverma@example.com',
      phone: '9966553322',
      pan: 'ABCPD1234P',
      relationship: {
        director: false,
        executive: true,
      },
    },
    bankDetails: {
      beneficiaryName: 'Sharma Clinic',
      accountNumber: '1234567890',
      ifscCode: 'BKID0008916',
      accountType: 'savings',
    },
    tncAccepted: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('onboardRouteSchema validations', () => {
    it('accepts a valid individual onboarding payload', () => {
      const result = onboardRouteSchema.safeParse(validIndividualPayload);
      expect(result.success).toBe(true);
    });

    it('rejects when stakeholder PAN is not an individual PAN (4th char not P)', () => {
      const invalid = {
        ...validIndividualPayload,
        stakeholder: {
          ...validIndividualPayload.stakeholder,
          pan: 'ABCCD1234P', // 4th char is 'C' (Company PAN) instead of 'P'
        },
      };
      const result = onboardRouteSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        const panIssue = result.error.issues.find(
          (issue) => issue.path.join('.') === 'stakeholder.pan'
        );
        expect(panIssue?.message).toContain(
          'Stakeholder PAN must be a personal PAN (4th character P)'
        );
      }
    });

    it('rejects when businessType is private_limited but businessPan 4th char is not C', () => {
      const invalid = {
        ...validIndividualPayload,
        businessType: 'private_limited',
        businessPan: 'ABCFD1234P', // 4th char is 'F' (Firm PAN) instead of 'C' (Company)
      };
      const result = onboardRouteSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        const panIssue = result.error.issues.find(
          (issue) => issue.path.join('.') === 'businessPan'
        );
        expect(panIssue?.message).toContain(
          'PAN status character does not match'
        );
      }
    });

    it('rejects when GSTIN does not match the PAN', () => {
      const invalid = {
        ...validIndividualPayload,
        gstin: '23XYZAB1234P1Z5', // Different PAN in middle
      };
      const result = onboardRouteSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        const gstinIssue = result.error.issues.find(
          (issue) => issue.path.join('.') === 'gstin'
        );
        expect(gstinIssue?.message).toContain('GSTIN PAN must match');
      }
    });
  });

  describe('PayoutAccountSetupService.uploadKYCDocuments', () => {
    it('throws actionable error when razorpayAccountId is null', async () => {
      const mockClinicRow = {
        id: 'acc-1',
        razorpayAccountId: null,
        razorpayStakeholderId: null,
        razorpayProductId: null,
        routeStatus: 'DRAFT',
      };

      (database.select as jest.Mock).mockReturnValueOnce(
        createChain([mockClinicRow])
      );

      // JPEG magic bytes: 0xFF, 0xD8, 0xFF
      const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

      await expect(
        PayoutAccountSetupService.uploadKYCDocuments(
          'clinic-1',
          'personal_pan',
          validJpegBuffer,
          'pan.jpg',
          'image/jpeg'
        )
      ).rejects.toThrow(
        'Razorpay linked account has not been created yet. Please complete and submit the business details step first.'
      );
    });
  });

  describe('PayoutAccountSetupService.onboardRouteAccount failure handling', () => {
    it('records provider error in routeOnboardingRejectionReason when createRazorpayRouteAccount fails', async () => {
      const mockClinic = {
        id: 'clinic-1',
        clinicName: 'Sharma Clinic',
        userId: 'user-1',
        razorpayAccountId: null,
        routeReferenceId: 'ref_1234567890',
        razorpayStakeholderId: null,
        routeStatus: 'INACTIVE',
      };

      (database.select as jest.Mock).mockReturnValue(createChain([mockClinic]));
      (database.insert as jest.Mock).mockReturnValue(
        createChain([{ id: 'acc-1', routeReferenceId: 'ref_1234567890' }])
      );

      (
        razorpayUtils.createRazorpayRouteAccount as jest.Mock
      ).mockRejectedValueOnce(
        new HttpError(
          400,
          'Razorpay route account creation failed: Route feature not enabled'
        )
      );

      let updatedSetPayload: Record<string, unknown> | null = null;
      (database.update as jest.Mock).mockImplementation(() =>
        createChain(
          [],
          jest.fn((payload) => {
            updatedSetPayload = payload as Record<string, unknown>;
          })
        )
      );

      await expect(
        PayoutAccountSetupService.onboardRouteAccount(
          'clinic-1',
          validIndividualPayload as any,
          '127.0.0.1'
        )
      ).rejects.toThrow(
        'We could not create your linked account. Check your details and try again.'
      );

      // The clinic sees a plain reason, never Razorpay's raw error.
      expect(updatedSetPayload).not.toBeNull();
      expect(updatedSetPayload).toMatchObject({
        routeOnboardingRejectionReason:
          'We could not create your linked account. Please review the business details and try again.',
      });
    });
  });
});
