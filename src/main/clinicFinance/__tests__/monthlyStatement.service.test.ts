import { MonthlyStatementService as Statement } from '../services/monthlyStatement.service';
import { ClinicFinanceService } from '../services/clinicFinance.service';
import { SettlementService } from '../services/settlement.service';
import { renderTemplateToPdf } from '../../../utils/pdf.utils';

jest.mock('../services/clinicFinance.service', () => ({
  ClinicFinanceService: { getSummary: jest.fn() },
}));
jest.mock('../services/settlement.service', () => ({
  SettlementService: { list: jest.fn() },
}));
jest.mock('../../../utils/pdf.utils', () => ({
  renderTemplateToPdf: jest.fn(async () => Buffer.from('pdf')),
}));
jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            {
              name: 'Rao Clinic',
              address: '1 MG Road',
              city: 'Pune',
              state: 'MH',
              zip: 411001,
            },
          ],
        }),
      }),
    }),
  },
}));
jest.mock('../../../utils/istDateTime', () => ({
  getISTDateString: () => '2026-11-12',
}));

const summary = jest.mocked(ClinicFinanceService.getSummary);
const list = jest.mocked(SettlementService.list);
const printed = () =>
  jest.mocked(renderTemplateToPdf).mock.calls[0][1] as Record<string, any>;

beforeEach(() => {
  jest.clearAllMocks();
  summary.mockResolvedValue({
    grossRevenue: 10000,
    netRevenue: 9500,
    refundsIssued: 500,
    refundCount: 1,
    platformFeeChargedToPatients: 400,
    pendingPayout: 1200,
    channelBreakdown: {
      online: { grossRevenue: 6000 },
      offline: { grossRevenue: 4000 },
    },
  } as never);
  list.mockResolvedValue({
    data: [
      {
        status: 'completed',
        settlementDate: '2026-10-05',
        utr: 'UTR1',
        amount: 3000,
      },
      {
        status: 'processing',
        settlementDate: '2026-10-30',
        utr: null,
        amount: 1200,
      },
    ],
  } as never);
});

describe('MonthlyStatementService.build', () => {
  it('prints the figures Finance shows for the whole month', async () => {
    const { filename } = await Statement.build('clinic', '2026-10');
    expect(summary).toHaveBeenCalledWith('clinic', {
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
    expect(filename).toBe('statement-2026-10.pdf');
    expect(printed()).toMatchObject({
      monthLabel: 'October 2026',
      received: { online: '₹6,000.00', desk: '₹4,000.00', total: '₹10,000.00' },
      refunds: { total: '₹500.00', count: 1 },
      net: '₹9,500.00',
      fees: '₹400.00',
      pending: '₹1,200.00',
    });
  });

  it('lists only payouts that reached the bank', async () => {
    await Statement.build('clinic', '2026-10');
    expect(printed().payouts).toEqual([
      { date: '5 Oct 2026', utr: 'UTR1', amount: '₹3,000.00' },
    ]);
    expect(printed().paidTotal).toBe('₹3,000.00');
  });

  it('ends February on its last day', async () => {
    await Statement.build('clinic', '2024-02');
    expect(summary).toHaveBeenCalledWith('clinic', {
      startDate: '2024-02-01',
      endDate: '2024-02-29',
    });
  });

  it('refuses a month that has not started', async () => {
    await expect(Statement.build('clinic', '2026-12')).rejects.toMatchObject({
      status: 422,
    });
  });

  it('an empty month still prints, with zeros', async () => {
    summary.mockResolvedValue({} as never);
    list.mockResolvedValue({ data: [] } as never);
    await Statement.build('clinic', '2026-11');
    expect(printed()).toMatchObject({
      net: '₹0.00',
      paidTotal: '₹0.00',
      payouts: [],
    });
  });
});
