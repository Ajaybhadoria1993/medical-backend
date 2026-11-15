import { ClinicFinanceService } from '../services/clinicFinance.service';
import { database } from '../../../configurations/dbConnection';
import { MoneyReadService } from '../../money';

jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    execute: jest.fn(),
  },
}));

// Money figures come from the ledger reader since the money cutover; the rest is still raw SQL.
jest.mock('../../money', () => ({
  MoneyReadService: {
    totals: jest.fn(),
    outstanding: jest.fn(),
  },
}));

describe('ClinicFinanceService.getSummary', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('pays out online money only, net of refunds; offline cash stays in revenue', async () => {
    // ₹4,600 received (₹3,000 online, ₹1,600 desk); ₹102.36 refunded online. Paise, as the reader returns.
    (MoneyReadService.totals as jest.Mock).mockResolvedValueOnce({
      grossPaise: 460000,
      netPaise: 449764,
      refundsPaise: 10236,
      payments: 5,
      refundsCount: 2,
      byModePaise: {},
      bySourcePaise: {},
      grossBySourcePaise: {},
      byChannel: {
        online: { grossPaise: 300000, netPaise: 289764 },
        desk: { grossPaise: 160000, netPaise: 160000 },
      },
    });
    (MoneyReadService.outstanding as jest.Mock).mockResolvedValueOnce({
      duePaise: 0,
      visits: 0,
      planDuePaise: 0,
    });
    (database.execute as jest.Mock)
      .mockResolvedValueOnce([
        {
          gross_revenue: '4600.00',
          online_gross_revenue: '3000.00',
          offline_gross_revenue: '1600.00',
          net_revenue: '4497.64',
          online_net_revenue: '2897.64',
          offline_net_revenue: '1600.00',
          completed_appointment_count: 5,
          platform_fee: '113.04',
        },
      ])
      .mockResolvedValueOnce([
        {
          rate: '10.00',
          fee_payer: 'PATIENT',
          effective_from: new Date(),
        },
      ])
      .mockResolvedValueOnce([
        {
          account_id: 'acc_123',
          route_status: 'ACTIVE',
          rejection_reason: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          already_received: '0.00',
          next_settlement_date: '2026-10-16T00:00:00.000Z',
          next_settlement_ref: 'setl_S390',
        },
      ])
      .mockResolvedValueOnce([
        {
          settled_to_bank: '1500.00',
        },
      ])
      .mockResolvedValueOnce([
        {
          dispute_held: '500.00',
        },
      ])
      .mockResolvedValueOnce([
        {
          settlement_held: '0.00',
        },
      ])
      .mockResolvedValueOnce([{ transfer_held: '0.00' }]);

    const result = await ClinicFinanceService.getSummary('clinic-123', {
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });

    expect(result.grossRevenue).toBe(4600);
    expect(result.grossCollected).toBe(4600);
    expect(result.refundsIssued).toBe(102.36);
    expect(result.refundCount).toBe(2);
    expect(result.netPayable).toBe(2897.64);
    expect(result.alreadyReceived).toBe(0);
    expect(result.settledToBank).toBe(1500);
    // Money on hold (₹500 dispute) is not expected in the next payout.
    expect(result.pendingPayout).toBe(2397.64);
    expect(result.nextSettlementRef).toBe('setl_S390');
    expect(result.onHold).toBe(500);
    expect(result.onHoldReason).toBe('Contact support to release');
    expect(result.channelBreakdown.online.refundsIssued).toBe(102.36);
    expect(result.channelBreakdown.offline.netPayable).toBe(1600);
  });
});
