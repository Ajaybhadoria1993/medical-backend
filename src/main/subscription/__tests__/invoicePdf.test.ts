import { SubscriptionService } from '../services/subscription.service';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';

jest.mock('../../../configurations/dbConnection');
jest.mock('../../../utils/logger');
jest.mock('../../../utils/browserPdf', () => ({
  htmlToPdfBuffer: jest.fn().mockResolvedValue(Buffer.from('PDF_TEST_CONTENT')),
}));

describe('Subscription Invoice PDF Generation', () => {
  const createChain = (finalValue: unknown) => {
    const chain: Record<
      string,
      jest.Mock | ((resolve: (val: unknown) => void) => void)
    > = {};
    const methods = [
      'from',
      'leftJoin',
      'innerJoin',
      'where',
      'limit',
      'offset',
    ];
    methods.forEach((method) => {
      chain[method] = jest.fn().mockImplementation(() => chain);
    });
    chain.then = (resolve: (val: unknown) => void) => resolve(finalValue);
    return chain;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws 404 HttpError when invoice ID is non-existent in subscriptions and add-ons', async () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    const clinicId = '00000000-0000-0000-0000-000000000001';

    (database.select as jest.Mock)
      .mockReturnValueOnce(createChain([])) // subscription query empty
      .mockReturnValueOnce(createChain([])); // add-on query empty

    await expect(
      SubscriptionService.generateInvoicePdf(clinicId, nonExistentId)
    ).rejects.toThrow(HttpError);
  });

  it('generates PDF buffer for a valid subscription invoice', async () => {
    const validId = 'sub-uuid-1234';
    const clinicId = 'clinic-uuid-5678';

    const mockSubData = [
      {
        id: validId,
        currency: 'INR',
        startsAt: new Date('2026-09-01'),
        expiresAt: new Date('2026-10-01'),
        createdAt: new Date('2026-09-01'),
        paymentMode: 'Razorpay',
        transactionId: 'pay_123456789',
        paymentStatus: 'paid',
        price: '499.00',
        discount: '50.00',
        planName: 'Carehub Monthly Plan',
        planDescription: 'Access to all features',
        clinicName: 'Alpha Clinic',
        clinicAddress: '123 Health St',
        clinicPhone: '9876543210',
        clinicState: 'MH',
        clinicCity: 'Mumbai',
        zipCode: '400001',
        adminName: 'Dr. John',
        adminEmail: 'john@alphaclinic.com',
        adminMobile: '9876543210',
      },
    ];

    (database.select as jest.Mock).mockReturnValueOnce(
      createChain(mockSubData)
    );

    const result = await SubscriptionService.generateInvoicePdf(
      clinicId,
      validId,
      'subscription'
    );

    expect(result).toHaveProperty('pdfBuffer');
    expect(result).toHaveProperty('fileName', 'SUB-UUID-123.pdf');
    expect(result.pdfBuffer.toString()).toBe('PDF_TEST_CONTENT');
  });
});
