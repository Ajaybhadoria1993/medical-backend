import { database } from '../../../configurations/dbConnection';
import type {
  SubscriptionInvoice,
  SubscriptionPayment,
} from '../models/subscriptionPayment.model';
import { InvoiceService } from '../services/billing/invoice.service';
import { toHistoryItem } from '../utils/billingHistory.utils';

jest.mock('../../../configurations/dbConnection', () => ({
  database: { select: jest.fn() },
}));
jest.mock('../../../configurations/s3/client', () => ({
  getBufferFromS3: jest.fn(),
  uploadBufferToS3: jest.fn(),
}));
jest.mock('../../../utils/browserPdf', () => ({ htmlToPdfBuffer: jest.fn() }));
jest.mock('../../../utils/logger');

const payment = {
  id: 'pay-row-1',
  kind: 'plan_purchase',
  status: 'captured',
  amountPaise: 49900,
  discountPaise: 0,
  currency: 'INR',
  provider: 'razorpay',
  providerPaymentId: 'pay_ABC',
  paymentMethod: 'upi',
  periodStart: new Date('2026-11-04T00:00:00Z'),
  periodEnd: new Date('2026-12-04T00:00:00Z'),
  paidAt: new Date('2026-11-04T00:00:00Z'),
  createdAt: new Date('2026-11-04T00:00:00Z'),
  lines: {
    version: 1,
    items: [
      {
        kind: 'plan',
        description: 'Clinic (monthly)',
        amountPaise: 49900,
        billingCycle: 'monthly',
      },
    ],
  },
} as unknown as SubscriptionPayment;
const invoice = {
  id: 'inv-1',
  invoiceNumber: 'MS/2026-27/0001',
  billTo: { name: 'Sharma Clinic', state: 'Madhya Pradesh', city: 'Indore' },
  taxablePaise: 42288,
  cgstPaise: 3806,
  sgstPaise: 3806,
  igstPaise: 0,
} as unknown as SubscriptionInvoice;

describe('toHistoryItem', () => {
  it('maps a paid plan to the row the Subscription page reads', () => {
    const item = toHistoryItem(payment, invoice);
    expect(item).toMatchObject({
      id: 'inv-1',
      invoiceNumber: 'MS/2026-27/0001',
      planName: 'Clinic',
      billingCycle: 'monthly',
      price: 499,
      paymentMode: 'upi',
      paymentStatus: 'success',
      transactionId: 'pay_ABC',
    });
    // The bill-to and tax figures live on the invoice PDF, not the table row.
    expect(item).not.toHaveProperty('clinicName');
    expect(item).not.toHaveProperty('cgst');
  });

  it('shows a ₹0 sale without an invoice as free, keyed by its payment', () => {
    const free = {
      ...payment,
      amountPaise: 0,
      paymentMethod: null,
    } as SubscriptionPayment;
    const item = toHistoryItem(free, null);
    expect(item).toMatchObject({
      paymentMode: 'free',
      id: 'pay-row-1',
      invoiceNumber: null,
    });
  });
});

describe('InvoiceService.pdfFor', () => {
  // A query builder that resolves to `rows` however it is chained.
  const rowsOf = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'limit']) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(ok, ko);
    return q;
  };

  beforeEach(() => jest.resetAllMocks());

  it('answers 404 for an id that is not a UUID, without a query', async () => {
    await expect(
      InvoiceService.pdfFor('clinic-1', 'pay_ABC')
    ).rejects.toMatchObject({ status: 404 });
    expect(database.select).not.toHaveBeenCalled();
  });

  it("answers 404 for another clinic's invoice", async () => {
    (database.select as jest.Mock).mockReturnValue(rowsOf([]));
    await expect(
      InvoiceService.pdfFor('clinic-1', '6f1c2d3e-4b5a-4c6d-8e7f-001122334455')
    ).rejects.toMatchObject({ status: 404 });
  });
});
