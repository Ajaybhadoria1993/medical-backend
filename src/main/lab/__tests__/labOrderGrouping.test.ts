import { LabOrderService } from '../services/labOrder.service';

type Row = Record<string, unknown> & {
  labOrderId: string;
  createdAt: Date;
};

type TestResponse = {
  labOrderId: string;
  orderType: string;
  version: number;
};

type GroupResponse = {
  labOrderGroupId: string | null;
  createdAt: string;
  orderType: string;
  orderTypes: string[];
  packageId: string | null;
  totalPrice: number;
  totalPriceAfterDiscount?: number;
  remainingAmount?: number;
  refundedAmount: number;
  overallStatus: string;
  tests: TestResponse[];
};

type GroupingInternals = {
  groupRows: (
    rows: Row[],
    matchingTests: unknown[],
    homeSamplesByOrderId?: Map<string, unknown[]>,
    splitMixedWorkflowGroups?: boolean,
    paymentsByOrderId?: Map<string, unknown[]>,
    versionByOrderId?: Map<string, number>
  ) => GroupResponse[];
  getTestVersions: (
    trx: unknown,
    lab: unknown,
    rows: Row[]
  ) => Promise<Map<string, number>>;
};

const service = LabOrderService as unknown as GroupingInternals;
const lab = {
  id: 'lab-1',
  clinicId: 'clinic-1',
  name: 'Lab',
  address: '',
  contactNo: '',
};
const GROUP_ID = '22222222-2222-4222-8222-222222222222';
const FIRST_BATCH = new Date('2026-10-28T05:00:00.000Z');
const SECOND_BATCH = new Date('2026-10-28T07:00:00.000Z');

const row = (overrides: Partial<Row> & { labOrderId: string }): Row => ({
  labOrderGroupId: null,
  testId: null,
  labUpdatedTestId: 'lab-test-1',
  labUpdatedTestPackageId: null,
  isIndependent: true,
  patientId: '11111111-1111-4111-8111-111111111111',
  patientName: 'Ramesh Kumar',
  patientMob: '9876543210',
  patientAddress: null,
  patientCity: null,
  patientState: null,
  patientAge: 45,
  patientGender: 'Male',
  doctorId: null,
  referringDoctorName: null,
  prescribedTestName: null,
  labUpdatedTestName: 'CBC',
  labUpdatedTestCode: 'CBC',
  labUpdatedSampleType: 'Blood',
  labUpdatedTestPrice: 300,
  packageName: null,
  packageCode: null,
  packagePrice: null,
  discountPercent: '0',
  price: 300,
  paymentType: 'test',
  paymentMode: null,
  paymentNotes: null,
  reportStatus: 'Initiated',
  paymentStatus: 'pending',
  workflowStatus: 'INITIATED',
  sampleStatus: 'NOT_STARTED',
  sampleCode: null,
  reportPdf: null,
  createdAt: FIRST_BATCH,
  updatedAt: null,
  ...overrides,
});

const versionOf = (group: GroupResponse, labOrderId: string) =>
  group.tests.find((test) => test.labOrderId === labOrderId)?.version;

describe('LabOrderService grouping', () => {
  it('keeps walk-in batches without a group id as separate groups', () => {
    const groups = service.groupRows(
      [
        row({ labOrderId: 'later', createdAt: SECOND_BATCH }),
        row({ labOrderId: 'earlier', createdAt: FIRST_BATCH }),
      ],
      []
    );

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.labOrderGroupId)).toEqual([null, null]);
    expect(groups.map((group) => group.orderTypes)).toEqual([
      ['walkin_test'],
      ['walkin_test'],
    ]);
  });

  it('merges batches that share a group id and describes the group by its first batch', () => {
    const groups = service.groupRows(
      [
        row({
          labOrderId: 'added-later',
          labOrderGroupId: GROUP_ID,
          createdAt: SECOND_BATCH,
        }),
        row({
          labOrderId: 'first',
          labOrderGroupId: GROUP_ID,
          createdAt: FIRST_BATCH,
        }),
      ],
      [],
      new Map(),
      true,
      new Map(),
      new Map([
        ['first', 1],
        ['added-later', 2],
      ])
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].labOrderGroupId).toBe(GROUP_ID);
    expect(groups[0].createdAt).toBe(FIRST_BATCH.toISOString());
    expect(versionOf(groups[0], 'first')).toBe(1);
    expect(versionOf(groups[0], 'added-later')).toBe(2);
  });

  it('charges a package once and adds a later loose test on top', () => {
    const packageRow = {
      labOrderGroupId: GROUP_ID,
      labUpdatedTestPackageId: 'package-1',
      packageName: 'Full Body',
      packagePrice: 1000,
      discountPercent: '10',
      price: null,
      createdAt: FIRST_BATCH,
    };
    const groups = service.groupRows(
      [
        row({ labOrderId: 'pkg-a', ...packageRow }),
        row({ labOrderId: 'pkg-b', ...packageRow }),
        row({
          labOrderId: 'loose',
          labOrderGroupId: GROUP_ID,
          createdAt: SECOND_BATCH,
        }),
      ],
      [],
      new Map(),
      true,
      new Map(),
      new Map([
        ['pkg-a', 1],
        ['pkg-b', 1],
        ['loose', 2],
      ])
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].orderType).toBe('walkin_package');
    expect(groups[0].orderTypes).toEqual(['walkin_package', 'walkin_test']);
    expect(groups[0].packageId).toBe('package-1');
    expect(groups[0].totalPrice).toBe(1300);
    expect(groups[0].totalPriceAfterDiscount).toBe(1200);
    expect(groups[0].remainingAmount).toBe(1200);
  });

  it('leaves a single-package group priced exactly as before', () => {
    const packageRow = {
      labUpdatedTestPackageId: 'package-1',
      packagePrice: 1000,
      discountPercent: '10',
      price: null,
    };
    const groups = service.groupRows(
      [
        row({ labOrderId: 'pkg-a', ...packageRow }),
        row({ labOrderId: 'pkg-b', ...packageRow }),
      ],
      []
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].totalPrice).toBe(1000);
    expect(groups[0].totalPriceAfterDiscount).toBe(900);
  });

  it('keeps a prescribed group prescribed after a walk-in test joins it', () => {
    const groups = service.groupRows(
      [
        row({
          labOrderId: 'walk-in',
          labOrderGroupId: GROUP_ID,
          createdAt: SECOND_BATCH,
        }),
        row({
          labOrderId: 'prescribed',
          labOrderGroupId: GROUP_ID,
          testId: 'catalog-test-1',
          labUpdatedTestId: null,
          labUpdatedTestPrice: null,
          doctorId: 'doctor-1',
          isIndependent: false,
          prescribedTestName: 'CBC',
          createdAt: FIRST_BATCH,
        }),
      ],
      [],
      new Map(),
      true,
      new Map(),
      new Map([
        ['prescribed', 1],
        ['walk-in', 2],
      ])
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].orderType).toBe('prescribed');
    expect(groups[0].orderTypes).toEqual(['prescribed', 'walkin_test']);
    expect(
      groups[0].tests.map((test) => [test.labOrderId, test.orderType])
    ).toEqual([
      ['walk-in', 'walkin_test'],
      ['prescribed', 'prescribed'],
    ]);
  });
});

describe('LabOrderService test versions', () => {
  it('numbers same-day prescribed batches without a group id by created time', async () => {
    const prescribed = {
      testId: 'catalog-test-1',
      doctorId: 'doctor-1',
      labUpdatedTestId: null,
    };
    const versions = await service.getTestVersions(undefined, lab, [
      row({ labOrderId: 'second', ...prescribed, createdAt: SECOND_BATCH }),
      row({ labOrderId: 'first', ...prescribed, createdAt: FIRST_BATCH }),
    ]);

    expect(versions.get('first')).toBe(1);
    expect(versions.get('second')).toBe(2);
  });

  it('orders grouped batches by their aligned instant, not raw created_at', async () => {
    // An /assign batch stored as IST wall time reads 5h30m ahead of a UTC walk-in.
    const assignStoredAt = new Date('2026-10-28T10:30:00.000Z');
    const walkinStoredAt = new Date('2026-10-28T06:00:00.000Z');
    const batches = [
      {
        labOrderGroupId: GROUP_ID,
        createdAt: assignStoredAt,
        orderedAt: assignStoredAt.getTime() - 5.5 * 60 * 60 * 1000,
      },
      {
        labOrderGroupId: GROUP_ID,
        createdAt: walkinStoredAt,
        orderedAt: walkinStoredAt.getTime(),
      },
    ];
    const query = {
      from: () => query,
      leftJoin: () => query,
      where: () => query,
      groupBy: () => Promise.resolve(batches),
    };
    const trx = { select: () => query };

    const versions = await service.getTestVersions(trx, lab, [
      row({
        labOrderId: 'walk-in',
        labOrderGroupId: GROUP_ID,
        createdAt: walkinStoredAt,
      }),
      row({
        labOrderId: 'assigned',
        labOrderGroupId: GROUP_ID,
        testId: 'catalog-test-1',
        createdAt: assignStoredAt,
      }),
    ]);

    expect(versions.get('assigned')).toBe(1);
    expect(versions.get('walk-in')).toBe(2);
  });
});

describe('LabOrderService home collection payment', () => {
  const buildRows = () => [
    row({
      labOrderId: 'test1',
      labUpdatedTestPrice: 100,
      price: 90,
      discountPercent: '10',
    }),
    row({
      labOrderId: 'test2',
      labUpdatedTestPrice: 200,
      price: 180,
      discountPercent: '10',
    }),
  ];

  const paymentsByOrderId = new Map([
    ['test1', [{ price: 90, paymentStatus: 'paid' }]],
    ['test2', [{ price: 180, paymentStatus: 'paid' }]],
  ]);

  const homeSample = (overrides: Record<string, unknown>) => ({
    id: 'home-1',
    rateId: 'rate-1',
    homeCollectionPrice: 500,
    distance: 10,
    unit: 'km',
    labOrderIds: ['test1', 'test2'],
    createdAt: FIRST_BATCH,
    updatedAt: FIRST_BATCH,
    ...overrides,
  });

  it('nets remainingAmount to 0 once the home collection fee is marked paid', () => {
    const paid = homeSample({
      paidAmount: 500,
      paymentStatus: 'paid',
      paymentMode: 'CASH',
      paymentNotes: null,
    });
    const homeSamplesByOrderId = new Map([
      ['test1', [paid]],
      ['test2', [paid]],
    ]);

    const groups = service.groupRows(
      buildRows(),
      [],
      homeSamplesByOrderId,
      true,
      paymentsByOrderId
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].totalPrice).toBe(770);
    expect(groups[0].totalPriceAfterDiscount).toBe(770);
    expect(groups[0].remainingAmount).toBe(0);
  });

  it('still shows the home fee as due when it has not been marked paid', () => {
    const pending = homeSample({
      paidAmount: null,
      paymentStatus: 'pending',
      paymentMode: null,
      paymentNotes: null,
    });
    const homeSamplesByOrderId = new Map([
      ['test1', [pending]],
      ['test2', [pending]],
    ]);

    const groups = service.groupRows(
      buildRows(),
      [],
      homeSamplesByOrderId,
      true,
      paymentsByOrderId
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].totalPrice).toBe(770);
    expect(groups[0].totalPriceAfterDiscount).toBe(770);
    expect(groups[0].remainingAmount).toBe(500);
  });
});

describe('LabOrderService NO_SHOW status', () => {
  it('reports No Show as the overall status when every test is marked NO_SHOW', () => {
    const groups = service.groupRows(
      [
        row({ labOrderId: 'a', workflowStatus: 'NO_SHOW' }),
        row({ labOrderId: 'b', workflowStatus: 'NO_SHOW' }),
      ],
      []
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].overallStatus).toBe('No Show');
  });

  it('splits NO_SHOW tests into their own group, same as Rejected', () => {
    const groups = service.groupRows(
      [
        row({
          labOrderId: 'no-show',
          labOrderGroupId: GROUP_ID,
          workflowStatus: 'NO_SHOW',
        }),
        row({
          labOrderId: 'completed',
          labOrderGroupId: GROUP_ID,
          workflowStatus: 'COMPLETED',
        }),
      ],
      [],
      new Map(),
      true
    );

    expect(groups).toHaveLength(2);
    const statuses = groups.map((group) => group.overallStatus).sort();
    expect(statuses).toEqual(['Completed', 'No Show']);
  });
});

describe('LabOrderService refunds', () => {
  const tests = (test1Status = 'INITIATED') => [
    row({
      labOrderId: 'test1',
      labUpdatedTestPrice: 100,
      price: 90,
      discountPercent: '10',
      workflowStatus: test1Status,
    }),
    row({
      labOrderId: 'test2',
      labUpdatedTestPrice: 200,
      price: 180,
      discountPercent: '10',
    }),
  ];
  const payments = (test1Refund: number) =>
    new Map([
      [
        'test1',
        [
          { price: 90, paymentStatus: 'paid' },
          ...(test1Refund
            ? [{ price: test1Refund, paymentStatus: 'refunded' }]
            : []),
        ],
      ],
      ['test2', [{ price: 180, paymentStatus: 'paid' }]],
    ]);

  it('reopens what is owed when an active test is refunded', () => {
    const groups = service.groupRows(
      tests(),
      [],
      new Map(),
      true,
      payments(90)
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].remainingAmount).toBe(90);
    expect(groups[0].refundedAmount).toBe(90);
  });

  it('owes nothing more when a rejected test is refunded', () => {
    const groups = service.groupRows(
      tests('REJECTED'),
      [],
      new Map(),
      true,
      payments(90)
    );

    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((group) => group.remainingAmount === 0)).toBe(true);
    expect(groups.every((group) => group.refundedAmount === 90)).toBe(true);
  });

  it('shows no refund when nothing was given back', () => {
    const groups = service.groupRows(tests(), [], new Map(), true, payments(0));

    expect(groups[0].remainingAmount).toBe(0);
    expect(groups[0].refundedAmount).toBe(0);
  });
});
