import {
  labDashboardQuerySchema,
  labOrderCountTrendQuerySchema,
} from '../schemas/labDashboard.schemas';
import {
  buildLabDashboardMetric,
  getLabOrderCountTrendRange,
  LabDashboardOrderRow,
  summarizeLabOrderCountsByDay,
  summarizeLabBillingAmounts,
  summarizeLabDashboardRows,
  summarizeLabOrderStatusDistribution,
} from '../services/labDashboard.service';

const row = (
  overrides: Partial<LabDashboardOrderRow> = {}
): LabDashboardOrderRow => ({
  labOrderId: crypto.randomUUID(),
  patientId: '11111111-1111-4111-8111-111111111111',
  independentPatientMobile: null,
  labUpdatedTestPackageId: null,
  packagePrice: null,
  price: 100,
  paymentMode: 'Cash',
  workflowStatus: 'INITIATED',
  createdAt: new Date('2026-10-13T04:30:00.000Z'),
  ...overrides,
});

describe('labDashboardQuerySchema', () => {
  it('accepts and normalizes the requested dateRange filters', () => {
    expect(
      labDashboardQuerySchema.parse({
        dateRangeFrom: '2026-10-01',
        dateRangeTo: '2026-10-13',
      })
    ).toEqual({
      dateRangeFrom: '2026-10-01',
      dateRangeTo: '2026-10-13',
    });
  });

  it('supports clinic-dashboard date aliases', () => {
    expect(
      labDashboardQuerySchema.parse({
        startDate: '2026-10-13',
        endDate: '2026-10-13',
        dateRangeStartCount: '2026-10-13',
        dateRangeEndCount: '2026-10-13',
      })
    ).toEqual({
      dateRangeFrom: '2026-10-13',
      dateRangeTo: '2026-10-13',
    });
  });

  it('rejects incomplete, reversed, and invalid calendar ranges', () => {
    expect(
      labDashboardQuerySchema.safeParse({ dateRangeFrom: '2026-10-13' }).success
    ).toBe(false);
    expect(
      labDashboardQuerySchema.safeParse({
        dateRangeFrom: '2026-10-14',
        dateRangeTo: '2026-10-13',
      }).success
    ).toBe(false);
    expect(
      labDashboardQuerySchema.safeParse({
        dateRangeFrom: '2026-02-30',
        dateRangeTo: '2026-03-01',
      }).success
    ).toBe(false);
  });
});

describe('labOrderCountTrendQuerySchema', () => {
  it('accepts only the supported week and month filters', () => {
    expect(
      labOrderCountTrendQuerySchema.parse({ filter: 'This Week' })
    ).toEqual({ filter: 'This Week' });
    expect(
      labOrderCountTrendQuerySchema.parse({ filter: 'This Month' })
    ).toEqual({ filter: 'This Month' });
    expect(
      labOrderCountTrendQuerySchema.safeParse({ filter: 'Last Month' }).success
    ).toBe(false);
  });
});

describe('lab order count trend', () => {
  it('uses Monday-Sunday weeks and full calendar months', () => {
    expect(getLabOrderCountTrendRange('This Week', '2026-10-13')).toEqual({
      startDate: '2026-10-12',
      endDate: '2026-10-18',
    });
    expect(getLabOrderCountTrendRange('This Month', '2026-10-13')).toEqual({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
  });

  it('counts only the three requested statuses and includes zero-count days', () => {
    const data = summarizeLabOrderCountsByDay(
      [
        row({ workflowStatus: 'INITIATED' }),
        row({ workflowStatus: 'IN_PROGRESS' }),
        row({ workflowStatus: 'COMPLETED' }),
        row({ workflowStatus: 'ON_HOLD' }),
      ],
      ['2026-10-13', '2026-10-14']
    );

    expect(data).toEqual([
      {
        date: '2026-10-13',
        day: 'Tuesday',
        dateMonth: '13 Oct',
        initiated: 1,
        processing: 1,
        completed: 1,
        totalOrders: 3,
      },
      {
        date: '2026-10-14',
        day: 'Wednesday',
        dateMonth: '14 Oct',
        initiated: 0,
        processing: 0,
        completed: 0,
        totalOrders: 0,
      },
    ]);
  });
});

describe('summarizeLabDashboardRows', () => {
  it('counts workflow cards and applies billing-history package pricing', () => {
    const createdAt = new Date('2026-10-13T04:30:00.000Z');
    const rows = [
      row({ workflowStatus: 'ON_HOLD', price: 50 }),
      row({ workflowStatus: 'INITIATED', price: 125 }),
      row({ workflowStatus: 'IN_PROGRESS', price: 150 }),
      row({ workflowStatus: 'COMPLETED', price: 175 }),
      row({
        workflowStatus: 'COMPLETED',
        labUpdatedTestPackageId: '22222222-2222-4222-8222-222222222222',
        packagePrice: 500,
        price: 300,
        createdAt,
      }),
      row({
        workflowStatus: 'COMPLETED',
        labUpdatedTestPackageId: '22222222-2222-4222-8222-222222222222',
        packagePrice: 500,
        price: 350,
        createdAt,
      }),
    ];

    expect(summarizeLabDashboardRows(rows)).toEqual({
      testRequestOnHold: 1,
      labOrderInitiated: 1,
      processingOrders: 1,
      completedOrders: 3,
      // On-Hold is excluded; standalone tests are summed; package is once.
      revenue: 950,
    });
  });

  it('excludes tests whose sample is not required from dashboard totals', () => {
    const included = row({ workflowStatus: 'COMPLETED', price: 100 });
    const excluded = row({
      workflowStatus: 'COMPLETED',
      sampleStatus: 'Not_Required',
      price: 999,
    });

    expect(summarizeLabDashboardRows([included, excluded])).toMatchObject({
      completedOrders: 1,
      revenue: 100,
    });
    expect(
      summarizeLabOrderStatusDistribution([included, excluded])
    ).toMatchObject({
      totalOrders: 1,
      distributionTotal: 1,
    });
    expect(summarizeLabBillingAmounts([included, excluded])).toEqual({
      totalAmount: 100,
      cashAmount: 100,
      upiAmount: 0,
      cardAmount: 0,
      otherAmount: 0,
    });
    expect(
      summarizeLabOrderCountsByDay([included, excluded], ['2026-10-13'])[0]
        .totalOrders
    ).toBe(1);
  });
});

describe('buildLabDashboardMetric', () => {
  it('calculates positive, negative, and zero-baseline changes', () => {
    expect(buildLabDashboardMetric(15, 10)).toMatchObject({
      change: 5,
      hikePercent: 50,
      direction: 'up',
    });
    expect(buildLabDashboardMetric(5, 10)).toMatchObject({
      change: -5,
      hikePercent: -50,
      direction: 'down',
    });
    expect(buildLabDashboardMetric(5, 0)).toMatchObject({
      hikePercent: 100,
      direction: 'up',
    });
  });
});

describe('summarizeLabOrderStatusDistribution', () => {
  it('returns requested status counts and percentages out of 100', () => {
    const result = summarizeLabOrderStatusDistribution([
      row({ workflowStatus: 'INITIATED' }),
      row({ workflowStatus: 'INITIATED' }),
      row({ workflowStatus: 'IN_PROGRESS' }),
      row({ workflowStatus: 'COMPLETED' }),
      row({ workflowStatus: 'REJECTED' }),
      row({ workflowStatus: 'NO_SHOW' }),
      row({ workflowStatus: 'TEST_NOT_AVAILABLE' }),
      row({ workflowStatus: 'ON_HOLD' }),
    ]);

    expect(result).toEqual({
      totalOrders: 8,
      distributionTotal: 8,
      excludedFromDistribution: 0,
      statuses: {
        onHold: {
          workflowStatus: 'ON_HOLD',
          count: 1,
          percentage: 12.5,
        },
        initiated: {
          workflowStatus: 'INITIATED',
          count: 2,
          percentage: 25,
        },
        processing: {
          workflowStatus: 'IN_PROGRESS',
          count: 1,
          percentage: 12.5,
        },
        completed: {
          workflowStatus: 'COMPLETED',
          count: 1,
          percentage: 12.5,
        },
        rejected: {
          workflowStatus: 'REJECTED',
          count: 1,
          percentage: 12.5,
        },
        noShow: {
          workflowStatus: 'NO_SHOW',
          count: 1,
          percentage: 12.5,
        },
        testNotAvailable: {
          workflowStatus: 'TEST_NOT_AVAILABLE',
          count: 1,
          percentage: 12.5,
        },
      },
    });
  });

  it('returns zero percentages when the selected range has no matching orders', () => {
    const result = summarizeLabOrderStatusDistribution([]);

    expect(result.distributionTotal).toBe(0);
    expect(
      Object.values(result.statuses).every(
        (status) => status.count === 0 && status.percentage === 0
      )
    ).toBe(true);
  });
});

describe('summarizeLabBillingAmounts', () => {
  it('uses package price once and otherwise sums tests by payment mode', () => {
    const packageCreatedAt = new Date('2026-10-13T05:00:00.000Z');
    const packageId = '22222222-2222-4222-8222-222222222222';

    const result = summarizeLabBillingAmounts([
      row({ paymentMode: 'Cash', price: 100 }),
      row({
        paymentMode: 'Cash',
        labUpdatedTestPackageId: packageId,
        packagePrice: 500,
        price: 250,
        createdAt: packageCreatedAt,
      }),
      row({
        paymentMode: 'Cash',
        labUpdatedTestPackageId: packageId,
        packagePrice: 500,
        price: 300,
        createdAt: packageCreatedAt,
      }),
      row({ paymentMode: 'UPI', price: 200 }),
      row({ paymentMode: 'Credit Card', price: 300 }),
      row({ paymentMode: 'Bank Transfer', price: 50 }),
      row({ workflowStatus: 'ON_HOLD', paymentMode: 'Cash', price: 999 }),
    ]);

    expect(result).toEqual({
      totalAmount: 1150,
      cashAmount: 600,
      upiAmount: 200,
      cardAmount: 300,
      otherAmount: 50,
    });
  });

  it('nets a refund off the total and the mode it was given back in', () => {
    const result = summarizeLabBillingAmounts([
      row({
        paymentMode: 'Cash',
        price: 300,
        refunds: [{ amount: 100, paymentMode: 'UPI' }],
      }),
      row({ paymentMode: 'Cash', price: 200 }),
    ]);

    expect(result).toEqual({
      totalAmount: 400,
      cashAmount: 500,
      upiAmount: -100,
      cardAmount: 0,
      otherAmount: 0,
    });
  });

  it('ignores a refund on a test left off the bill', () => {
    const result = summarizeLabBillingAmounts([
      row({ paymentMode: 'Cash', price: 200 }),
      row({
        workflowStatus: 'REJECTED',
        paymentMode: 'Cash',
        price: 300,
        refunds: [{ amount: 300, paymentMode: 'Cash' }],
      }),
    ]);

    expect(result.totalAmount).toBe(200);
    expect(result.cashAmount).toBe(200);
  });
});

describe('revenue after refunds', () => {
  it('subtracts a refund on a billable test, including a package test', () => {
    const packageId = '33333333-3333-4333-8333-333333333333';
    const createdAt = new Date('2026-10-13T05:00:00.000Z');
    const totals = summarizeLabDashboardRows([
      row({ price: 300, refunds: [{ amount: 100, paymentMode: 'Cash' }] }),
      row({
        labUpdatedTestPackageId: packageId,
        packagePrice: 800,
        createdAt,
        refunds: [{ amount: 50, paymentMode: 'Cash' }],
      }),
      row({
        labUpdatedTestPackageId: packageId,
        packagePrice: 800,
        createdAt,
        refunds: [{ amount: 50, paymentMode: 'Cash' }],
      }),
    ]);

    expect(totals.revenue).toBe(300 - 100 + 800 - 50 - 50);
  });

  it('never subtracts a refund twice for a rejected or no-show test', () => {
    const totals = summarizeLabDashboardRows([
      row({ price: 200 }),
      row({
        workflowStatus: 'NO_SHOW',
        price: 300,
        refunds: [{ amount: 300, paymentMode: 'Cash' }],
      }),
    ]);

    expect(totals.revenue).toBe(200);
  });
});
