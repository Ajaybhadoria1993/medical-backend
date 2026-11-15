import { and, asc, desc, eq, gte, lt, or, SQL, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { getISTDateString, startOfDayIST } from '../../../utils/istDateTime';
import { APPOINTMENT_TEST_WORKFLOW_STATUS } from '../../test/constants/appointmentTest.constants';
import {
  IndependentPatientModel,
  LabOrderModel,
} from '../../test/models/labOrder.model';
import { LabTestCatalogModel } from '../../test/models/labTestCatalog.model';
import { TestCatalogModel } from '../../test/models/testCatalog.model';
import { LabsModel, UserLabAssignmentsModel } from '../models/lab.model';
import {
  LabUpdatedTestModel,
  LabUpdatedTestPackageModel,
  LabUpdatedOrderHomeCollectionModel,
} from '../models/labUpdated.model';
import { labOrderPaymentColumns } from '../utils/labOrderPayment';
import { LabMoneyService } from '../../money';
import type {
  LabDashboardQueryInput,
  LabOrderCountTrendQueryInput,
} from '../schemas/labDashboard.schemas';

type DbTransaction = Parameters<Parameters<typeof database.transaction>[0]>[0];

export type LabDashboardContext = {
  labId: string;
  userId: string;
  userRole: string;
};

type LabScope = {
  id: string;
  clinicId: string;
};

export type LabDashboardOrderRow = {
  labOrderId: string;
  patientId: string | null;
  independentPatientMobile: string | null;
  labUpdatedTestPackageId: string | null;
  packagePrice: number | null;
  price: number | null;
  paymentMode: string | null;
  workflowStatus: string;
  sampleStatus?: string | null;
  createdAt: Date;
  /** Money given back on this test. */
  refunds?: LabDashboardRefund[];
};

export type LabDashboardRefund = { amount: number; paymentMode: string | null };

type DashboardTotals = {
  testRequestOnHold: number;
  labOrderInitiated: number;
  processingOrders: number;
  completedOrders: number;
  revenue: number;
};

type DashboardBillingAmounts = {
  totalAmount: number;
  cashAmount: number;
  upiAmount: number;
  cardAmount: number;
  otherAmount: number;
};

type HomeCollectionBillingRow = {
  homeCollectionPrice: number;
  labOrderIds: string[];
  refunds?: LabDashboardRefund[];
};

type OrderStatusCounts = {
  onHold: number;
  initiated: number;
  processing: number;
  completed: number;
  rejected: number;
  noShow: number;
  testNotAvailable: number;
};

const MILLISECONDS_PER_DAY = 86_400_000;
const BILLING_EXCLUDED_WORKFLOW_STATUSES = new Set([
  APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD,
  APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED,
  APPOINTMENT_TEST_WORKFLOW_STATUS.NO_SHOW,
  'TEST_NOT_AVAILABLE',
]);
const NOT_REQUIRED_SAMPLE_STATUS = 'not_required';

const refundTotal = (refunds: LabDashboardRefund[] | undefined) =>
  (refunds ?? []).reduce((total, refund) => total + refund.amount, 0);

const groupRefunds = (
  refunds: { sourceId: string; amount: number; paymentMode: string | null }[]
) => {
  const bySource = new Map<string, LabDashboardRefund[]>();
  for (const { sourceId, ...refund } of refunds) {
    const list = bySource.get(sourceId) ?? [];
    list.push(refund);
    bySource.set(sourceId, list);
  }
  return bySource;
};

const isNotRequiredSampleStatus = (sampleStatus: string | null | undefined) =>
  String(sampleStatus ?? '')
    .trim()
    .toLowerCase() === NOT_REQUIRED_SAMPLE_STATUS;

const addDays = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const getInclusiveDayCount = (from: string, to: string) =>
  Math.round(
    (new Date(`${to}T00:00:00.000Z`).getTime() -
      new Date(`${from}T00:00:00.000Z`).getTime()) /
      MILLISECONDS_PER_DAY
  ) + 1;

const getRange = (from: string, to: string) => ({
  from,
  to,
  start: startOfDayIST(from),
  endExclusive: startOfDayIST(addDays(to, 1)),
});

export const summarizeLabDashboardRows = (
  rows: LabDashboardOrderRow[]
): DashboardTotals => {
  const totals: DashboardTotals = {
    testRequestOnHold: 0,
    labOrderInitiated: 0,
    processingOrders: 0,
    completedOrders: 0,
    revenue: 0,
  };
  const countedPackages = new Set<string>();

  for (const row of rows) {
    if (isNotRequiredSampleStatus(row.sampleStatus)) continue;

    const workflowStatus = String(row.workflowStatus).toUpperCase();

    if (workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD) {
      totals.testRequestOnHold += 1;
    } else if (workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED) {
      totals.labOrderInitiated += 1;
    } else if (
      workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.IN_PROGRESS
    ) {
      totals.processingOrders += 1;
    } else if (workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED) {
      totals.completedOrders += 1;
    }

    // Billing History's "All Payments" excludes On-Hold/Rejected/Unavailable
    // groups. For included package rows it shows the package price once;
    // otherwise it shows the sum of the individual test prices.
    if (BILLING_EXCLUDED_WORKFLOW_STATUSES.has(workflowStatus)) continue;

    // Money given back on a billable test leaves revenue; a test off the bill counts 0 either way.
    totals.revenue -= refundTotal(row.refunds);

    if (row.labUpdatedTestPackageId && row.packagePrice !== null) {
      const patientKey =
        row.patientId ?? `unknown:${row.independentPatientMobile ?? ''}`;
      const packageOrderKey = [
        patientKey,
        row.labUpdatedTestPackageId,
        row.createdAt.toISOString(),
      ].join(':');

      if (!countedPackages.has(packageOrderKey)) {
        totals.revenue += row.packagePrice;
        countedPackages.add(packageOrderKey);
      }
      continue;
    }

    totals.revenue += row.price ?? 0;
  }

  return totals;
};

const getPaymentModeKey = (paymentMode: string | null) => {
  const normalized = String(paymentMode ?? '')
    .trim()
    .toLowerCase();

  if (normalized.includes('cash')) return 'cash' as const;
  if (normalized.includes('upi')) return 'upi' as const;
  if (normalized.includes('card')) return 'card' as const;
  return 'other' as const;
};

const addByMode = (
  amounts: DashboardBillingAmounts,
  paymentMode: string | null,
  amount: number
) => {
  amounts.totalAmount += amount;
  const mode = getPaymentModeKey(paymentMode);
  if (mode === 'cash') amounts.cashAmount += amount;
  else if (mode === 'upi') amounts.upiAmount += amount;
  else if (mode === 'card') amounts.cardAmount += amount;
  else amounts.otherAmount += amount;
};

/** Each refund leaves the mode it was given back in (the row's own mode if none was recorded). */
const subtractRefunds = (
  amounts: DashboardBillingAmounts,
  refunds: LabDashboardRefund[] | undefined,
  fallbackMode: string | null
) => {
  for (const refund of refunds ?? []) {
    addByMode(amounts, refund.paymentMode ?? fallbackMode, -refund.amount);
  }
};

export const summarizeLabBillingAmounts = (rows: LabDashboardOrderRow[]) => {
  const amounts = {
    totalAmount: 0,
    cashAmount: 0,
    upiAmount: 0,
    cardAmount: 0,
    otherAmount: 0,
  };
  const countedPackages = new Set<string>();

  for (const row of rows) {
    if (isNotRequiredSampleStatus(row.sampleStatus)) continue;

    const workflowStatus = String(row.workflowStatus).toUpperCase();
    if (BILLING_EXCLUDED_WORKFLOW_STATUSES.has(workflowStatus)) continue;

    subtractRefunds(amounts, row.refunds, row.paymentMode);

    let amount: number;

    if (row.labUpdatedTestPackageId && row.packagePrice !== null) {
      const patientKey =
        row.patientId ?? `unknown:${row.independentPatientMobile ?? ''}`;
      const packageOrderKey = [
        patientKey,
        row.labUpdatedTestPackageId,
        row.createdAt.toISOString(),
      ].join(':');

      if (countedPackages.has(packageOrderKey)) continue;

      amount = row.packagePrice;
      countedPackages.add(packageOrderKey);
    } else {
      amount = row.price ?? 0;
    }

    amounts.totalAmount += amount;

    const paymentMode = getPaymentModeKey(row.paymentMode);
    if (paymentMode === 'cash') amounts.cashAmount += amount;
    else if (paymentMode === 'upi') amounts.upiAmount += amount;
    else if (paymentMode === 'card') amounts.cardAmount += amount;
    else amounts.otherAmount += amount;
  }

  return amounts;
};

const addHomeCollectionBillingAmounts = (
  amounts: DashboardBillingAmounts,
  homeCollections: HomeCollectionBillingRow[],
  rows: LabDashboardOrderRow[]
) => {
  const rowsByOrderId = new Map(
    rows.map((row) => [row.labOrderId, row] as const)
  );

  for (const homeCollection of homeCollections) {
    const billableOrder = homeCollection.labOrderIds
      .map((labOrderId) => rowsByOrderId.get(labOrderId))
      .find(
        (row) =>
          row &&
          !isNotRequiredSampleStatus(row.sampleStatus) &&
          !BILLING_EXCLUDED_WORKFLOW_STATUSES.has(
            String(row.workflowStatus).toUpperCase()
          )
      );

    if (!billableOrder) continue;

    const amount = homeCollection.homeCollectionPrice;
    amounts.totalAmount += amount;

    const paymentMode = getPaymentModeKey(billableOrder.paymentMode);
    if (paymentMode === 'cash') amounts.cashAmount += amount;
    else if (paymentMode === 'upi') amounts.upiAmount += amount;
    else if (paymentMode === 'card') amounts.cardAmount += amount;
    else amounts.otherAmount += amount;

    subtractRefunds(amounts, homeCollection.refunds, billableOrder.paymentMode);
  }
};

export const buildLabDashboardMetric = (current: number, previous: number) => {
  const change = current - previous;
  const hikePercent =
    previous === 0
      ? current > 0
        ? 100
        : 0
      : Number(((change / previous) * 100).toFixed(2));
  const roundedPercent = Math.round(hikePercent);
  const formattedPercent =
    roundedPercent > 0 ? `+${roundedPercent}` : String(roundedPercent);

  return {
    value: current,
    previousValue: previous,
    change,
    hikePercent,
    // Retained for consumers that already follow the clinic dashboard shape.
    hikePersent: `${formattedPercent} (${previous})`,
    percentage: hikePercent,
    direction:
      change > 0
        ? ('up' as const)
        : change < 0
          ? ('down' as const)
          : ('neutral' as const),
  };
};

export const summarizeLabOrderStatusDistribution = (
  rows: LabDashboardOrderRow[]
) => {
  const counts: OrderStatusCounts = {
    onHold: 0,
    initiated: 0,
    processing: 0,
    completed: 0,
    rejected: 0,
    noShow: 0,
    testNotAvailable: 0,
  };

  for (const row of rows) {
    if (isNotRequiredSampleStatus(row.sampleStatus)) continue;

    const workflowStatus = String(row.workflowStatus).toUpperCase();

    if (workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD) {
      counts.onHold += 1;
    } else if (workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED) {
      counts.initiated += 1;
    } else if (
      workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.IN_PROGRESS
    ) {
      counts.processing += 1;
    } else if (workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED) {
      counts.completed += 1;
    } else if (workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED) {
      counts.rejected += 1;
    } else if (workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.NO_SHOW) {
      counts.noShow += 1;
    } else if (workflowStatus === 'TEST_NOT_AVAILABLE') {
      counts.testNotAvailable += 1;
    }
  }

  const distributionTotal = Object.values(counts).reduce(
    (total, count) => total + count,
    0
  );
  const percentage = (count: number) =>
    distributionTotal === 0
      ? 0
      : Number(((count / distributionTotal) * 100).toFixed(2));

  const includedRows = rows.filter(
    (row) => !isNotRequiredSampleStatus(row.sampleStatus)
  );

  return {
    totalOrders: includedRows.length,
    distributionTotal,
    excludedFromDistribution: includedRows.length - distributionTotal,
    statuses: {
      onHold: {
        workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD,
        count: counts.onHold,
        percentage: percentage(counts.onHold),
      },
      initiated: {
        workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED,
        count: counts.initiated,
        percentage: percentage(counts.initiated),
      },
      processing: {
        workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.IN_PROGRESS,
        count: counts.processing,
        percentage: percentage(counts.processing),
      },
      completed: {
        workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED,
        count: counts.completed,
        percentage: percentage(counts.completed),
      },
      rejected: {
        workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED,
        count: counts.rejected,
        percentage: percentage(counts.rejected),
      },
      noShow: {
        workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.NO_SHOW,
        count: counts.noShow,
        percentage: percentage(counts.noShow),
      },
      testNotAvailable: {
        workflowStatus: 'TEST_NOT_AVAILABLE',
        count: counts.testNotAvailable,
        percentage: percentage(counts.testNotAvailable),
      },
    },
  };
};

export const getLabOrderCountTrendRange = (
  filter: LabOrderCountTrendQueryInput['filter'],
  today: string = getISTDateString()
) => {
  if (filter === 'This Week') {
    const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
    const mondayOffset = (weekday + 6) % 7;
    const startDate = addDays(today, -mondayOffset);
    return { startDate, endDate: addDays(startDate, 6) };
  }

  const [year, month] = today.split('-').map(Number);
  return {
    startDate: `${today.slice(0, 7)}-01`,
    endDate: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
};

export const summarizeLabOrderCountsByDay = (
  rows: LabDashboardOrderRow[],
  dateKeys: string[]
) => {
  const countsByDate = new Map<
    string,
    { initiated: number; processing: number; completed: number }
  >();

  for (const dateKey of dateKeys) {
    countsByDate.set(dateKey, { initiated: 0, processing: 0, completed: 0 });
  }

  for (const row of rows) {
    if (isNotRequiredSampleStatus(row.sampleStatus)) continue;

    const dateKey = getISTDateString(row.createdAt);
    const counts = countsByDate.get(dateKey);
    if (!counts) continue;

    const workflowStatus = String(row.workflowStatus).toUpperCase();
    if (workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED) {
      counts.initiated += 1;
    } else if (
      workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.IN_PROGRESS
    ) {
      counts.processing += 1;
    } else if (workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED) {
      counts.completed += 1;
    }
  }

  return dateKeys.map((date) => {
    const counts = countsByDate.get(date)!;
    const dateObject = new Date(`${date}T00:00:00.000Z`);

    return {
      date,
      day: new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        timeZone: 'UTC',
      }).format(dateObject),
      dateMonth: new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        timeZone: 'UTC',
      }).format(dateObject),
      ...counts,
      totalOrders: counts.initiated + counts.processing + counts.completed,
    };
  });
};

export class LabDashboardService {
  private static async getLabScope(
    trx: DbTransaction,
    context: LabDashboardContext
  ): Promise<LabScope> {
    const [lab] = await trx
      .select({ id: LabsModel.id, clinicId: LabsModel.clinicId })
      .from(LabsModel)
      .where(eq(LabsModel.id, context.labId))
      .limit(1);

    if (!lab) throw new HttpError(404, 'Lab not found');

    if (
      context.userRole !== 'Admin' &&
      context.userRole !== 'Super_Admin' &&
      context.userRole !== 'Receptionist'
    ) {
      const [assignment] = await trx
        .select({ id: UserLabAssignmentsModel.id })
        .from(UserLabAssignmentsModel)
        .where(
          and(
            eq(UserLabAssignmentsModel.labId, context.labId),
            eq(UserLabAssignmentsModel.userId, context.userId),
            eq(UserLabAssignmentsModel.clinicId, lab.clinicId)
          )
        )
        .limit(1);

      if (!assignment) {
        throw new HttpError(403, 'User is not assigned to this lab');
      }
    }

    return lab;
  }

  private static getLabOrderScopeCondition(lab: LabScope) {
    return or(
      eq(LabOrderModel.clinicId, lab.clinicId),
      eq(LabUpdatedTestModel.labId, lab.id),
      eq(LabUpdatedTestPackageModel.labId, lab.id)
    ) as SQL;
  }

  private static async getRowsForRange(
    trx: DbTransaction,
    lab: LabScope,
    start: Date,
    endExclusive: Date
  ): Promise<LabDashboardOrderRow[]> {
    const rows = await trx
      .select({
        labOrderId: LabOrderModel.id,
        patientId: LabOrderModel.patientId,
        independentPatientMobile: IndependentPatientModel.mobile,
        labUpdatedTestPackageId: LabOrderModel.labUpdatedTestPackageId,
        packagePrice: LabUpdatedTestPackageModel.packagePrice,
        price: labOrderPaymentColumns.price,
        paymentMode: labOrderPaymentColumns.paymentMode,
        workflowStatus: LabOrderModel.workflowStatus,
        sampleStatus: LabOrderModel.sampleStatus,
        createdAt: LabOrderModel.createdAt,
      })
      .from(LabOrderModel)
      .leftJoin(
        LabUpdatedTestModel,
        eq(LabOrderModel.labUpdatedTestId, LabUpdatedTestModel.id)
      )
      .leftJoin(
        LabUpdatedTestPackageModel,
        eq(LabOrderModel.labUpdatedTestPackageId, LabUpdatedTestPackageModel.id)
      )
      .leftJoin(
        IndependentPatientModel,
        eq(LabOrderModel.independentPatientId, IndependentPatientModel.id)
      )
      .where(
        and(
          this.getLabOrderScopeCondition(lab),
          gte(LabOrderModel.createdAt, start),
          lt(LabOrderModel.createdAt, endExclusive),
          sql`lower(coalesce(${LabOrderModel.sampleStatus}, '')) <> ${NOT_REQUIRED_SAMPLE_STATUS}`
        )
      );
    const refunds = groupRefunds(
      await LabMoneyService.refunds(
        trx,
        'lab_test',
        rows.map((row) => row.labOrderId)
      )
    );
    return rows.map((row) => ({
      ...row,
      refunds: refunds.get(row.labOrderId) ?? [],
    }));
  }

  private static async getHomeCollectionRowsForRange(
    trx: DbTransaction,
    lab: LabScope,
    start: Date,
    endExclusive: Date
  ): Promise<HomeCollectionBillingRow[]> {
    const rows = await trx
      .select({
        id: LabUpdatedOrderHomeCollectionModel.id,
        homeCollectionPrice:
          LabUpdatedOrderHomeCollectionModel.homeCollectionPrice,
        labOrderIds: LabUpdatedOrderHomeCollectionModel.labOrderIds,
      })
      .from(LabUpdatedOrderHomeCollectionModel)
      .where(
        and(
          eq(LabUpdatedOrderHomeCollectionModel.labId, lab.id),
          gte(LabUpdatedOrderHomeCollectionModel.createdAt, start),
          lt(LabUpdatedOrderHomeCollectionModel.createdAt, endExclusive)
        )
      );
    const refunds = groupRefunds(
      await LabMoneyService.refunds(
        trx,
        'lab_home_collection',
        rows.map((row) => row.id)
      )
    );
    return rows.map(({ id, ...row }) => ({
      ...row,
      refunds: refunds.get(id) ?? [],
    }));
  }

  private static async getHomeCollectionRevenueForRange(
    trx: DbTransaction,
    lab: LabScope,
    start: Date,
    endExclusive: Date
  ) {
    const homeCollections = await this.getHomeCollectionRowsForRange(
      trx,
      lab,
      start,
      endExclusive
    );

    return homeCollections.reduce(
      (total, homeCollection) =>
        total +
        homeCollection.homeCollectionPrice -
        refundTotal(homeCollection.refunds),
      0
    );
  }

  static async getCards(
    context: LabDashboardContext,
    query: LabDashboardQueryInput
  ) {
    const dateRangeFrom = query.dateRangeFrom ?? getISTDateString();
    const dateRangeTo = query.dateRangeTo ?? dateRangeFrom;
    const dayCount = getInclusiveDayCount(dateRangeFrom, dateRangeTo);
    const comparisonTo = addDays(dateRangeFrom, -1);
    const comparisonFrom = addDays(dateRangeFrom, -dayCount);
    const currentRange = getRange(dateRangeFrom, dateRangeTo);
    const previousRange = getRange(comparisonFrom, comparisonTo);

    return await database.transaction(async (trx) => {
      const lab = await this.getLabScope(trx, context);
      const currentRows = await this.getRowsForRange(
        trx,
        lab,
        currentRange.start,
        currentRange.endExclusive
      );
      const previousRows = await this.getRowsForRange(
        trx,
        lab,
        previousRange.start,
        previousRange.endExclusive
      );
      const current = summarizeLabDashboardRows(currentRows);
      const previous = summarizeLabDashboardRows(previousRows);
      current.revenue += await this.getHomeCollectionRevenueForRange(
        trx,
        lab,
        currentRange.start,
        currentRange.endExclusive
      );
      previous.revenue += await this.getHomeCollectionRevenueForRange(
        trx,
        lab,
        previousRange.start,
        previousRange.endExclusive
      );

      const testRequestOnHold = buildLabDashboardMetric(
        current.testRequestOnHold,
        previous.testRequestOnHold
      );
      const labOrderInitiated = buildLabDashboardMetric(
        current.labOrderInitiated,
        previous.labOrderInitiated
      );
      const processingOrders = buildLabDashboardMetric(
        current.processingOrders,
        previous.processingOrders
      );
      const completedOrders = buildLabDashboardMetric(
        current.completedOrders,
        previous.completedOrders
      );
      const revenue = buildLabDashboardMetric(
        current.revenue,
        previous.revenue
      );

      return {
        labId: lab.id,
        filters: { dateRangeFrom, dateRangeTo },
        comparison: {
          dateRangeFrom: comparisonFrom,
          dateRangeTo: comparisonTo,
          label:
            dayCount === 1 ? 'vs previous day' : `vs previous ${dayCount} days`,
        },
        summary: current,
        cards: {
          testRequestOnHold: {
            ...testRequestOnHold,
            count: testRequestOnHold.value,
            previousCount: testRequestOnHold.previousValue,
          },
          labOrderInitiated: {
            ...labOrderInitiated,
            count: labOrderInitiated.value,
            previousCount: labOrderInitiated.previousValue,
          },
          processingOrders: {
            ...processingOrders,
            count: processingOrders.value,
            previousCount: processingOrders.previousValue,
          },
          completedOrders: {
            ...completedOrders,
            count: completedOrders.value,
            previousCount: completedOrders.previousValue,
          },
          revenue: {
            ...revenue,
            amount: revenue.value,
            previousAmount: revenue.previousValue,
            currency: 'INR',
          },
        },
      };
    });
  }

  static async getOrderStatusDistribution(
    context: LabDashboardContext,
    query: LabDashboardQueryInput
  ) {
    const startDate = query.dateRangeFrom ?? getISTDateString();
    const endDate = query.dateRangeTo ?? startDate;
    const selectedRange = getRange(startDate, endDate);

    return await database.transaction(async (trx) => {
      const lab = await this.getLabScope(trx, context);
      const rows = await this.getRowsForRange(
        trx,
        lab,
        selectedRange.start,
        selectedRange.endExclusive
      );

      return {
        labId: lab.id,
        filters: { startDate, endDate },
        ...summarizeLabOrderStatusDistribution(rows),
      };
    });
  }

  static async getMostUsedTests(
    context: LabDashboardContext,
    query: LabDashboardQueryInput
  ) {
    const startDate = query.dateRangeFrom ?? getISTDateString();
    const endDate = query.dateRangeTo ?? startDate;
    const selectedRange = getRange(startDate, endDate);

    return await database.transaction(async (trx) => {
      const lab = await this.getLabScope(trx, context);
      const scopeCondition = this.getLabOrderScopeCondition(lab);
      const dateCondition = and(
        gte(LabOrderModel.createdAt, selectedRange.start),
        lt(LabOrderModel.createdAt, selectedRange.endExclusive)
      );
      const workflowCondition = or(
        eq(
          LabOrderModel.workflowStatus,
          APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED
        ),
        eq(
          LabOrderModel.workflowStatus,
          APPOINTMENT_TEST_WORKFLOW_STATUS.IN_PROGRESS
        ),
        and(
          eq(
            LabOrderModel.workflowStatus,
            APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED
          ),
          eq(LabOrderModel.reportStatus, 'Completed')
        )
      );
      const where = and(scopeCondition, dateCondition, workflowCondition);

      const [{ totalCount }] = await trx
        .select({
          totalCount: sql<number>`COUNT(DISTINCT ${LabOrderModel.id})::int`,
        })
        .from(LabOrderModel)
        .leftJoin(
          LabUpdatedTestModel,
          eq(LabOrderModel.labUpdatedTestId, LabUpdatedTestModel.id)
        )
        .leftJoin(
          LabUpdatedTestPackageModel,
          eq(
            LabOrderModel.labUpdatedTestPackageId,
            LabUpdatedTestPackageModel.id
          )
        )
        .where(where);

      const testNameExpression = sql<string | null>`COALESCE(
        ${LabUpdatedTestModel.testName},
        ${TestCatalogModel.name}
      )`;
      const testCodeExpression = sql<string | null>`COALESCE(
        ${LabUpdatedTestModel.testCode},
        ${LabTestCatalogModel.testCode}
      )`;

      const topTests = await trx
        .select({
          testName: testNameExpression,
          testCode: testCodeExpression,
          totalCount: sql<number>`COUNT(DISTINCT ${LabOrderModel.id})::int`,
        })
        .from(LabOrderModel)
        .leftJoin(
          LabUpdatedTestModel,
          eq(LabOrderModel.labUpdatedTestId, LabUpdatedTestModel.id)
        )
        .leftJoin(
          LabUpdatedTestPackageModel,
          eq(
            LabOrderModel.labUpdatedTestPackageId,
            LabUpdatedTestPackageModel.id
          )
        )
        .leftJoin(
          TestCatalogModel,
          eq(LabOrderModel.testId, TestCatalogModel.id)
        )
        .leftJoin(
          LabTestCatalogModel,
          eq(TestCatalogModel.labTestId, LabTestCatalogModel.id)
        )
        .where(and(where, sql`${testNameExpression} IS NOT NULL`))
        .groupBy(
          LabUpdatedTestModel.testName,
          LabUpdatedTestModel.testCode,
          TestCatalogModel.name,
          LabTestCatalogModel.testCode
        )
        .orderBy(
          desc(sql`COUNT(DISTINCT ${LabOrderModel.id})`),
          asc(testNameExpression)
        )
        .limit(5);

      const total = Number(totalCount ?? 0);

      return {
        labId: lab.id,
        filters: { startDate, endDate },
        totalCount: total,
        tests: topTests.map((test) => {
          const count = Number(test.totalCount ?? 0);
          return {
            testName: test.testName,
            testCode: test.testCode,
            totalCount: count,
            percentageOutOfTotal:
              total > 0 ? Number(((count / total) * 100).toFixed(2)) : 0,
          };
        }),
      };
    });
  }

  static async getBillingSummary(
    context: LabDashboardContext,
    query: LabDashboardQueryInput
  ) {
    const startDate = query.dateRangeFrom ?? getISTDateString();
    const endDate = query.dateRangeTo ?? startDate;
    const selectedRange = getRange(startDate, endDate);

    return await database.transaction(async (trx) => {
      const lab = await this.getLabScope(trx, context);
      const rows = await this.getRowsForRange(
        trx,
        lab,
        selectedRange.start,
        selectedRange.endExclusive
      );
      const billing = summarizeLabBillingAmounts(rows);
      const homeCollections = await this.getHomeCollectionRowsForRange(
        trx,
        lab,
        selectedRange.start,
        selectedRange.endExclusive
      );
      addHomeCollectionBillingAmounts(billing, homeCollections, rows);

      return {
        labId: lab.id,
        filters: { startDate, endDate },
        billing,
      };
    });
  }

  static async getOrderCountTrend(
    context: LabDashboardContext,
    filter: LabOrderCountTrendQueryInput['filter']
  ) {
    const { startDate, endDate } = getLabOrderCountTrendRange(filter);
    const selectedRange = getRange(startDate, endDate);
    const dateKeys = Array.from(
      { length: getInclusiveDayCount(startDate, endDate) },
      (_, index) => addDays(startDate, index)
    );

    return await database.transaction(async (trx) => {
      const lab = await this.getLabScope(trx, context);
      const rows = await this.getRowsForRange(
        trx,
        lab,
        selectedRange.start,
        selectedRange.endExclusive
      );
      const data = summarizeLabOrderCountsByDay(rows, dateKeys);

      return {
        labId: lab.id,
        filters: { filter, startDate, endDate },
        totalOrders: data.reduce((total, day) => total + day.totalOrders, 0),
        statuses: {
          initiated: data.reduce((total, day) => total + day.initiated, 0),
          processing: data.reduce((total, day) => total + day.processing, 0),
          completed: data.reduce((total, day) => total + day.completed, 0),
        },
        data,
      };
    });
  }
}
