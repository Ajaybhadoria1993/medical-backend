import {
  buildSettlementCsv,
  buildSettlementPdf,
} from '../utils/settlementStatement.utils';

const settlement = {
  providerSettlementId: 'setl_123',
  paymentProvider: 'razorpay',
  cycleStart: '2026-09-01',
  cycleEnd: '2026-09-15',
  settledAt: '2026-09-16',
  amount: '1000.00',
};

const items = [
  {
    appointmentId: 'appointment-1',
    providerTransferId: 'transfer-1',
    clinicAmount: '1000.00',
    reversedAmount: '100.00',
    status: 'COMPLETED',
  },
];

describe('settlement statement builders', () => {
  it('builds a CSV containing the settlement and net item amount', () => {
    const csv = buildSettlementCsv(settlement, items).toString('utf8');

    expect(csv).toContain('setl_123');
    expect(csv).toContain('appointment-1');
    expect(csv).toContain('900');
  });

  it('builds a valid PDF document', async () => {
    const pdf = await buildSettlementPdf(settlement, items);

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
