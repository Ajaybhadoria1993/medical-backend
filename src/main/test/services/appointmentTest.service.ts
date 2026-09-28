import { LabNotificationService } from '../../notifications/services/labNotification.service';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
  sql,
  SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  getUserById,
  notifyTestAssignedToLab,
  notifyTestReportUploaded,
} from '../../../utils/notificationHelpers';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import {
  LabOrderModel,
  LabOrderTrackingEventModel,
  IndependentPatientModel,
} from '../models/labOrder.model';
import { LabTestCatalogModel } from '../models/labTestCatalog.model';
import { TestCatalogModel } from '../models/testCatalog.model';

import { deleteFromS3 } from '../../../configurations/s3';
import logger from '../../../utils/logger';
import { signalLabChange } from '../../realtime';
import { AppointmentActivityHistoryService } from '../../appointments/services/appointmentActivityHistory.service';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { LabInvoiceModel } from '../../lab/models/labInvoice.model';
import { LabsModel, UserLabAssignmentsModel } from '../../lab/models/lab.model';
import { LabOrderResultsModel } from '../../lab/models/labResult.model';
import {
  LabSamplesModel,
  type LabSampleStatus,
} from '../../lab/models/labSample.model';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { UserProfessionalModel } from '../../users/models/userProfessional.model';
import {
  APPOINTMENT_TEST_LEGACY_PAYMENT_STATUS,
  APPOINTMENT_TEST_PAYMENT_STATUS,
  APPOINTMENT_TEST_SAMPLE_ACTION,
  APPOINTMENT_TEST_SAMPLE_STATUS,
  APPOINTMENT_TEST_STEP_STATUS,
  APPOINTMENT_TEST_TRACKING_EVENT,
  APPOINTMENT_TEST_WORKFLOW_STATUS,
  AppointmentTestSampleAction,
  AppointmentTestSampleStatus,
  AppointmentTestTrackingEvent,
  AppointmentTestWorkflowStatus,
} from '../constants/appointmentTest.constants';

type LabAppointmentWorkflowStatusFilter =
  AppointmentTestWorkflowStatus | 'PENDING';
type LabAppointmentPaymentMethod = 'CASH' | 'UPI';
type LabDashboardDatePreset =
  'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'custom';
type LabDashboardTrendPeriod = 'daily' | 'weekly' | 'monthly';
type LabDashboardComparisonPeriod =
  'yesterday' | 'previousDay' | 'lastWeek' | 'lastMonth' | 'previousPeriod';

type LabAppointmentTestsQuery = {
  tab?: 'all' | 'assigned' | 'my' | 'new';
  search?: string;
  category?: string;
  groupBy?: 'patient';
  patientId?: string;
  independentPatientId?: string;
  status?: LabAppointmentWorkflowStatusFilter;
  page?: number;
  limit?: number;
  pageNumber?: number;
  pageSize?: number;
  datePreset?: LabDashboardDatePreset;
  startDate?: string;
  endDate?: string;
  trendPeriod?: LabDashboardTrendPeriod;
  includeDashboard?: boolean;
};

type MarkPaymentPaidPayload = {
  amount: number;
  paymentMethod: LabAppointmentPaymentMethod;
  transactionId?: string;
};

type SetExpectedReportReadyAtPayload = {
  expectedReportReadyAt: Date;
  note?: string;
};

type BarcodeActionPayload = {
  action:
    | AppointmentTestSampleAction
    | 'MARK_PAYMENT_PAID'
    | 'SET_EXPECTED_REPORT_READY_AT';
  amount?: number;
  paymentMethod?: LabAppointmentPaymentMethod;
  transactionId?: string;
  expectedReportReadyAt?: Date;
  note?: string;
};

type AddIndependentTestsPayload = {
  testIds: string[];
  patientName: string;
  patientMobile: string;
  patientAge: number;
  patientGender: string;
  doctorName?: string;
  performerUserId: string;
  clinicId: string;
  labId: string;
};

type DbTransaction = Parameters<Parameters<typeof database.transaction>[0]>[0];

type IndependentResolvedTest = {
  inputTestId: string;
  patientTest: typeof TestCatalogModel.$inferSelect;
  displayName: string;
  price: number | null;
};

type LabDashboardRow = {
  appointmentTestId: string;
  uniqueTestId: string | null;
  patientName: string | null;
  patientMobile: string | null;
  patientAge: number | null;
  patientGender: string | null;
  doctorName: string | null;
  doctorDepartment: string | null;
  testName: string;
  category: string | null;
  price: number | null;
  testPrice: number | null;
  dateTime: Date;
  appointmentTime: string | null;
  workflowStatus: string;
  paymentStatus: string;
  sampleStatus: string | null;
  reportStatus: string;
  reportPdf: string | null;
  sampleType: string | null;
  paymentCollectedAt: Date | null;
  expectedReportReadyAt: Date | null;
  readyForReportAt: Date | null;
  labAssistantId?: string | null;
  rejectedAt?: Date | null;
  rejectionReason?: string | null;
  onHoldAt?: Date | null;
  createdAt: Date;
  updatedAt: Date | null;
};

type LabDashboardCatalogRow = {
  id: string;
  name: string;
  testCode: string | null;
  category: string | null;
  price: number | null;
  sampleType?: string | null;
};

type LabAppointmentTestListRow = {
  appointmentTestId: string;
  appointmentId: string | null;
  uniqueTestId: string | null;
  isIndependent: boolean;
  independentPatientId: string | null;
  patientName: string | null;
  patientMobile: string | null;
  patientAge: number | null;
  patientGender: string | null;
  doctorName: string | null;
  testName: string;
  category: string | null;
  price: number | null;
  testPrice: number | null;
  dateTime: Date;
  appointmentTime: string | null;
  workflowStatus: string;
  paymentStatus: string;
  sampleStatus: string | null;
  reportStatus: string;
  reportPdf: string | null;
  labAssistantId: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  expectedReportReadyAt: Date | null;
  sampleId: string | null;
  sampleBarcodeValue: string | null;
  sampleBarcodeType: string | null;
  sampleType: string | null;
  createdAt: Date;
  updatedAt: Date | null;
};

type LabAppointmentPatientGroup = {
  patientKey: string;
  patientId: string | null;
  independentPatientId: string | null;
  isIndependent: boolean;
  patientName: string | null;
  patientMobile: string | null;
  patientAge: number | null;
  patientGender: string | null;
  doctorNames: string[];
  testCount: number;
  latestDateTime: Date | null;
  statusCounts: Record<string, number>;
};

type DashboardPaymentKey = 'PAID' | 'PENDING' | 'FAILED';
type PaymentTrackingEvent = {
  eventType: string;
  metadata: unknown;
};
type LabDashboardDateRange = {
  datePreset: LabDashboardDatePreset | null;
  start: Date | null;
  end: Date | null;
  startDate: string | null;
  endDate: string | null;
  comparisonStart: Date | null;
  comparisonEnd: Date | null;
  comparisonStartDate: string | null;
  comparisonEndDate: string | null;
  comparisonPeriod: LabDashboardComparisonPeriod;
  comparisonLabel: string;
};
type LabDashboardMetricTrend = {
  value: number;
  previousValue: number;
  change: number;
  percentage: number;
  trendPercentage: number;
  direction: 'up' | 'down' | 'neutral';
  comparisonLabel: string;
  comparisonStartDate: string | null;
  comparisonEndDate: string | null;
};
type LabDashboardMetricSnapshot = {
  totalTests: number;
  newRequests: number;
  inProgressTests: number;
  completedTests: number;
  pendingReports: number;
  totalRevenue: number;
  samplesCollected: number;
  testsPerformed: number;
  reportsGenerated: number;
  criticalAlerts: number;
  turnaroundTime: number;
  reportAccuracy: number;
  sampleRejectionRate: number;
};
type LabInvoiceAnchorRecord = {
  invoice: typeof LabInvoiceModel.$inferSelect;
  appointmentTest: typeof LabOrderModel.$inferSelect;
  labName: string | null;
  labAddress: string | null;
  labContactNumber: string | null;
  patientName: string | null;
  patientMobile: string | null;
  doctorName: string | null;
};

type LabInvoiceItemDisplayRecord = {
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoicePaymentMethod: string | null;
  invoiceTotalAmount: string | null;
  invoiceCreatedAt: Date | null;
  invoiceUpdatedAt: Date | null;
  appointmentTestId: string;
  testId: string;
  testName: string | null;
  category: string | null;
  sampleType: string | null;
  barcodeValue: string | null;
  appointmentTestPrice: number | null;
  patientTestPrice: number | null;
};

const IST_OFFSET_MS = 330 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LAB_DASHBOARD_TIMEZONE = 'Asia/Kolkata';
const LAB_APPOINTMENT_PENDING_WORKFLOW_STATUS = 'PENDING';
const LAB_APPOINTMENT_SET_EXPECTED_REPORT_READY_ACTION =
  'SET_EXPECTED_REPORT_READY_AT';
const LAB_APPOINTMENT_TESTS_DEFAULT_PAGE_SIZE = 10;
const LAB_APPOINTMENT_TESTS_MAX_PAGE_SIZE = 100;
const LAB_APPOINTMENT_PAYMENT_METHODS: LabAppointmentPaymentMethod[] = [
  'CASH',
  'UPI',
];
const ALL_TAB_WORKFLOW_STATUSES: AppointmentTestWorkflowStatus[] = [
  APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED,
  APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD,
  APPOINTMENT_TEST_WORKFLOW_STATUS.IN_PROGRESS,
  APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED,
  APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED,
];
const ASSIGNED_TAB_WORKFLOW_STATUSES: AppointmentTestWorkflowStatus[] = [
  APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD,
  APPOINTMENT_TEST_WORKFLOW_STATUS.IN_PROGRESS,
  APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED,
];
const REQUEST_REVIEW_TAB_WORKFLOW_STATUSES: AppointmentTestWorkflowStatus[] = [
  APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED,
  APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD,
  APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED,
];

const STATUS_BREAKDOWN_META = [
  {
    key: 'NEW_REQUESTS',
    label: 'New Requests',
  },
  {
    key: 'IN_PROGRESS',
    label: 'In Progress',
  },
  {
    key: 'COMPLETED',
    label: 'Completed',
  },
  {
    key: 'PENDING_REPORTS',
    label: 'Pending Reports',
  },
] as const;

const PAYMENT_BREAKDOWN_META: { key: DashboardPaymentKey; label: string }[] = [
  { key: 'PAID', label: 'Paid' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'FAILED', label: 'Failed' },
];

const SAMPLE_FUNNEL_META = [
  {
    key: APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED,
    label: 'Not Started',
  },
  {
    key: APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_COLLECTION_PENDING,
    label: 'Collection Pending',
  },
  {
    key: APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_COLLECTED,
    label: 'Sample Collected',
  },
  {
    key: APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_RECEIVED_AT_LAB,
    label: 'Received At Lab',
  },
  {
    key: APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_PROCESSING,
    label: 'Processing',
  },
  {
    key: APPOINTMENT_TEST_SAMPLE_STATUS.TESTING_IN_PROGRESS,
    label: 'Testing',
  },
  {
    key: APPOINTMENT_TEST_SAMPLE_STATUS.QUALITY_CHECK,
    label: 'Quality Check',
  },
  {
    key: APPOINTMENT_TEST_SAMPLE_STATUS.COMPLETED,
    label: 'Completed',
  },
] as const;

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const SAMPLE_STEP_ORDER: {
  key: 'PAYMENT_COMPLETED' | AppointmentTestSampleStatus;
  title: string;
  description: string;
  timestampField:
    | 'paymentCollectedAt'
    | 'sampleCollectedAt'
    | 'sampleReceivedAt'
    | 'processingStartedAt'
    | 'testingStartedAt'
    | 'qualityCheckedAt'
    | 'readyForReportAt';
  expectedReportReadyField?: 'expectedReportReadyAt';
}[] = [
  {
    key: 'PAYMENT_COMPLETED',
    title: 'Payment Confirmed',
    description: 'Payment has been successfully received.',
    timestampField: 'paymentCollectedAt',
  },
  {
    key: APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_COLLECTED,
    title: 'Sample Collected',
    description:
      'Blood, urine, or another required sample has been collected from the patient.',
    timestampField: 'sampleCollectedAt',
  },
  {
    key: APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_RECEIVED_AT_LAB,
    title: 'Sample Received at Lab',
    description: 'The laboratory has received and registered the sample.',
    timestampField: 'sampleReceivedAt',
  },
  {
    key: APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_PROCESSING,
    title: 'Sample Processing',
    description:
      'The sample is being prepared for testing, such as centrifugation or separation.',
    timestampField: 'processingStartedAt',
    expectedReportReadyField: 'expectedReportReadyAt',
  },
  {
    key: APPOINTMENT_TEST_SAMPLE_STATUS.TESTING_IN_PROGRESS,
    title: 'Testing in Progress',
    description: 'The laboratory test is currently being performed.',
    timestampField: 'testingStartedAt',
  },
  {
    key: APPOINTMENT_TEST_SAMPLE_STATUS.QUALITY_CHECK,
    title: 'Result Verification',
    description:
      'Test results are being reviewed and verified by the lab technician or pathologist.',
    timestampField: 'qualityCheckedAt',
  },
  {
    key: APPOINTMENT_TEST_SAMPLE_STATUS.COMPLETED,
    title: 'Test Completed',
    description:
      'The final verified report has been generated and is available.',
    timestampField: 'readyForReportAt',
  },
];

const SAMPLE_ACTION_TRANSITIONS: Record<
  AppointmentTestSampleAction,
  {
    from: AppointmentTestSampleStatus;
    to: AppointmentTestSampleStatus;
    timestampField:
      | 'sampleCollectedAt'
      | 'sampleReceivedAt'
      | 'processingStartedAt'
      | 'testingStartedAt'
      | 'qualityCheckedAt'
      | 'readyForReportAt';
    eventType: AppointmentTestTrackingEvent;
    title: string;
  }
> = {
  [APPOINTMENT_TEST_SAMPLE_ACTION.MARK_SAMPLE_COLLECTED]: {
    from: APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_COLLECTION_PENDING,
    to: APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_COLLECTED,
    timestampField: 'sampleCollectedAt',
    eventType: APPOINTMENT_TEST_TRACKING_EVENT.SAMPLE_COLLECTED,
    title: 'Sample collected',
  },
  [APPOINTMENT_TEST_SAMPLE_ACTION.MARK_SAMPLE_RECEIVED_AT_LAB]: {
    from: APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_COLLECTED,
    to: APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_RECEIVED_AT_LAB,
    timestampField: 'sampleReceivedAt',
    eventType: APPOINTMENT_TEST_TRACKING_EVENT.SAMPLE_RECEIVED_AT_LAB,
    title: 'Sample received at lab',
  },
  [APPOINTMENT_TEST_SAMPLE_ACTION.START_SAMPLE_PROCESSING]: {
    from: APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_RECEIVED_AT_LAB,
    to: APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_PROCESSING,
    timestampField: 'processingStartedAt',
    eventType: APPOINTMENT_TEST_TRACKING_EVENT.SAMPLE_PROCESSING,
    title: 'Sample processing started',
  },
  [APPOINTMENT_TEST_SAMPLE_ACTION.START_TESTING]: {
    from: APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_PROCESSING,
    to: APPOINTMENT_TEST_SAMPLE_STATUS.TESTING_IN_PROGRESS,
    timestampField: 'testingStartedAt',
    eventType: APPOINTMENT_TEST_TRACKING_EVENT.TESTING_IN_PROGRESS,
    title: 'Testing in progress',
  },
  [APPOINTMENT_TEST_SAMPLE_ACTION.MARK_QUALITY_CHECK_DONE]: {
    from: APPOINTMENT_TEST_SAMPLE_STATUS.TESTING_IN_PROGRESS,
    to: APPOINTMENT_TEST_SAMPLE_STATUS.QUALITY_CHECK,
    timestampField: 'qualityCheckedAt',
    eventType: APPOINTMENT_TEST_TRACKING_EVENT.QUALITY_CHECK_DONE,
    title: 'Result verified',
  },
  [APPOINTMENT_TEST_SAMPLE_ACTION.MARK_COMPLETED]: {
    from: APPOINTMENT_TEST_SAMPLE_STATUS.QUALITY_CHECK,
    to: APPOINTMENT_TEST_SAMPLE_STATUS.COMPLETED,
    timestampField: 'readyForReportAt',
    eventType: APPOINTMENT_TEST_TRACKING_EVENT.COMPLETED,
    title: 'Test completed',
  },
};

export class AppointmentTestService {
  private static isPaymentPaid(paymentStatus: string | null | undefined) {
    return (
      paymentStatus === APPOINTMENT_TEST_PAYMENT_STATUS.PAID ||
      paymentStatus === APPOINTMENT_TEST_LEGACY_PAYMENT_STATUS.PAID
    );
  }

  private static isPaymentPending(paymentStatus: string | null | undefined) {
    return (
      paymentStatus === APPOINTMENT_TEST_PAYMENT_STATUS.PENDING ||
      paymentStatus === APPOINTMENT_TEST_LEGACY_PAYMENT_STATUS.PENDING
    );
  }

  private static normalizePaymentStatus(
    paymentStatus: string | null | undefined
  ) {
    if (paymentStatus === APPOINTMENT_TEST_LEGACY_PAYMENT_STATUS.PAID) {
      return APPOINTMENT_TEST_PAYMENT_STATUS.PAID;
    }

    if (paymentStatus === APPOINTMENT_TEST_LEGACY_PAYMENT_STATUS.PENDING) {
      return APPOINTMENT_TEST_PAYMENT_STATUS.PENDING;
    }

    return paymentStatus;
  }

  private static isPaymentFailed(paymentStatus: string | null | undefined) {
    return paymentStatus?.toLowerCase() === 'failed';
  }

  private static getDashboardPaymentKey(
    paymentStatus: string | null | undefined
  ): DashboardPaymentKey | null {
    if (this.isPaymentPaid(paymentStatus)) {
      return 'PAID';
    }

    if (this.isPaymentPending(paymentStatus)) {
      return 'PENDING';
    }

    if (this.isPaymentFailed(paymentStatus)) {
      return 'FAILED';
    }

    return null;
  }

  private static getWorkflowStatusFilter(
    status: LabAppointmentWorkflowStatusFilter
  ): AppointmentTestWorkflowStatus {
    return status === LAB_APPOINTMENT_PENDING_WORKFLOW_STATUS
      ? APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD
      : status;
  }

  private static getLabResponseWorkflowStatus(
    status: string | null | undefined
  ) {
    return status === APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD
      ? LAB_APPOINTMENT_PENDING_WORKFLOW_STATUS
      : status;
  }

  private static normalizeLabPaymentMethod(
    paymentMethod: string | null | undefined
  ): LabAppointmentPaymentMethod | null {
    const normalized = paymentMethod?.trim().toUpperCase();

    return normalized === 'CASH' || normalized === 'UPI' ? normalized : null;
  }

  private static getPaymentMetadata(metadata: unknown) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {
        amount: null,
        paymentMethod: null,
        transactionId: null,
      };
    }

    const paymentMetadata = metadata as Record<string, unknown>;
    const amount =
      typeof paymentMetadata.amount === 'number'
        ? paymentMetadata.amount
        : null;
    const paymentMethod =
      typeof paymentMetadata.paymentMethod === 'string'
        ? this.normalizeLabPaymentMethod(paymentMetadata.paymentMethod)
        : null;
    const transactionId =
      typeof paymentMetadata.transactionId === 'string'
        ? paymentMetadata.transactionId
        : null;

    return {
      amount,
      paymentMethod,
      transactionId,
    };
  }

  private static getLatestPaymentDetails(events: PaymentTrackingEvent[]) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];

      if (
        event.eventType === APPOINTMENT_TEST_TRACKING_EVENT.PAYMENT_MARKED_PAID
      ) {
        return this.getPaymentMetadata(event.metadata);
      }
    }

    return {
      amount: null,
      paymentMethod: null,
      transactionId: null,
    };
  }

  private static toMoney(value: number | string | null | undefined) {
    const numericValue = Number(value ?? 0);
    return Number.isFinite(numericValue) ? numericValue.toFixed(2) : '0.00';
  }

  private static getValidPaidAmount(amount: number) {
    const paidAmount = Number(amount);

    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      throw new HttpError(400, 'Payment amount must be greater than 0');
    }

    return Math.round(paidAmount * 100) / 100;
  }

  private static getLabInvoiceExcludedWorkflowStatuses() {
    return [
      APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED,
      'Rejected',
      'rejected',
      'CANCELLED',
      'Cancelled',
      'cancelled',
      'CANCELED',
      'Canceled',
      'canceled',
      'DELETED',
      'Deleted',
      'deleted',
    ];
  }

  private static isExcludedFromLabInvoice(
    workflowStatus: string | null | undefined
  ) {
    return this.getLabInvoiceExcludedWorkflowStatuses().includes(
      String(workflowStatus ?? '').toUpperCase()
    );
  }

  private static getLabInvoiceItemAmount(item: LabInvoiceItemDisplayRecord) {
    if (item.invoiceTotalAmount !== null) {
      const invoiceAmount = Number(item.invoiceTotalAmount);
      return Number.isFinite(invoiceAmount)
        ? Math.round(invoiceAmount * 100) / 100
        : 0;
    }

    const appointmentTestPrice = Number(item.appointmentTestPrice ?? 0);
    const patientTestPrice = Number(item.patientTestPrice ?? 0);
    const fallbackAmount =
      appointmentTestPrice > 0 ? appointmentTestPrice : patientTestPrice;

    return Number.isFinite(fallbackAmount)
      ? Math.round(fallbackAmount * 100) / 100
      : 0;
  }

  private static formatLabInvoice(
    anchor: LabInvoiceAnchorRecord,
    items: LabInvoiceItemDisplayRecord[],
    appointmentTestId: string
  ) {
    const invoiceItems = items
      .filter((item) => item.invoiceId && item.invoiceNumber)
      .sort((first, second) => {
        const firstCreatedAt = first.invoiceCreatedAt?.getTime() ?? 0;
        const secondCreatedAt = second.invoiceCreatedAt?.getTime() ?? 0;

        if (firstCreatedAt !== secondCreatedAt) {
          return firstCreatedAt - secondCreatedAt;
        }

        return String(first.invoiceNumber).localeCompare(
          String(second.invoiceNumber)
        );
      });
    const canonicalInvoice = invoiceItems[0];
    const totalAmount = items.reduce(
      (sum, item) => sum + this.getLabInvoiceItemAmount(item),
      0
    );

    return {
      id: canonicalInvoice?.invoiceId ?? anchor.invoice.id,
      invoiceNumber:
        canonicalInvoice?.invoiceNumber ?? anchor.invoice.invoiceNumber,
      appointmentTestId,
      labId: anchor.invoice.labId,
      labName: anchor.labName,
      labAddress: anchor.labAddress,
      labContactNumber: anchor.labContactNumber,
      patientName: anchor.patientName,
      patientMobile: anchor.patientMobile,
      doctorName: anchor.doctorName,
      paymentMethod:
        canonicalInvoice?.invoicePaymentMethod ?? anchor.invoice.paymentMethod,
      totalAmount: this.toMoney(totalAmount),
      createdAt: canonicalInvoice?.invoiceCreatedAt ?? anchor.invoice.createdAt,
      updatedAt: canonicalInvoice?.invoiceUpdatedAt ?? anchor.invoice.updatedAt,
      items: items.map((item) => {
        const itemAmount = this.getLabInvoiceItemAmount(item);

        return {
          id: item.invoiceId ?? item.appointmentTestId,
          appointmentTestId: item.appointmentTestId,
          testId: item.testId,
          testName: item.testName ?? 'Lab test',
          category: item.category,
          sampleType: item.sampleType,
          barcodeValue: item.barcodeValue,
          quantity: 1,
          price: this.toMoney(itemAmount),
          total: this.toMoney(itemAmount),
        };
      }),
    };
  }

  private static async generateLabInvoiceNumber(
    trx: DbTransaction,
    now = new Date()
  ) {
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
    const [sequenceRow] = (await trx.execute(sql`
      SELECT nextval('lab_invoice_number_seq') AS value
    `)) as { value: string | number }[];
    const sequenceValue = String(sequenceRow.value).padStart(6, '0');

    return `LAB-${datePart}-${sequenceValue}`;
  }

  private static async getLabInvoiceAnchorById(
    trx: DbTransaction,
    invoiceId: string,
    context: { clinicId: string; labId: string }
  ) {
    const patientUser = alias(UserModel, 'invoice_patient_user');
    const doctorUser = alias(UserModel, 'invoice_doctor_user');

    const [record] = await trx
      .select({
        invoice: LabInvoiceModel,
        appointmentTest: LabOrderModel,
        labName: LabsModel.name,
        labAddress: LabsModel.address,
        labContactNumber: LabsModel.contactNo,
        patientName: sql<
          string | null
        >`coalesce(${patientUser.name}, ${IndependentPatientModel.name})`,
        patientMobile: sql<
          string | null
        >`coalesce(${patientUser.mobile}, ${IndependentPatientModel.mobile})`,
        doctorName: sql<
          string | null
        >`coalesce(${doctorUser.name}, ${IndependentPatientModel.doctorName})`,
      })
      .from(LabInvoiceModel)
      .innerJoin(
        LabOrderModel,
        eq(LabInvoiceModel.appointmentTestId, LabOrderModel.id)
      )
      .leftJoin(LabsModel, eq(LabInvoiceModel.labId, LabsModel.id))
      .leftJoin(patientUser, eq(LabOrderModel.patientId, patientUser.id))
      .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
      .leftJoin(
        IndependentPatientModel,
        eq(LabOrderModel.independentPatientId, IndependentPatientModel.id)
      )
      .where(
        and(
          eq(LabInvoiceModel.id, invoiceId),
          eq(LabInvoiceModel.clinicId, context.clinicId),
          eq(LabInvoiceModel.labId, context.labId),
          eq(LabOrderModel.clinicId, context.clinicId)
        )
      )
      .limit(1);

    return record ?? null;
  }

  private static async getLabInvoiceAnchorByAppointmentTestId(
    trx: DbTransaction,
    appointmentTestId: string,
    context: { clinicId: string; labId: string }
  ) {
    const patientUser = alias(UserModel, 'invoice_patient_user');
    const doctorUser = alias(UserModel, 'invoice_doctor_user');

    const [record] = await trx
      .select({
        invoice: LabInvoiceModel,
        appointmentTest: LabOrderModel,
        labName: LabsModel.name,
        labAddress: LabsModel.address,
        labContactNumber: LabsModel.contactNo,
        patientName: sql<
          string | null
        >`coalesce(${patientUser.name}, ${IndependentPatientModel.name})`,
        patientMobile: sql<
          string | null
        >`coalesce(${patientUser.mobile}, ${IndependentPatientModel.mobile})`,
        doctorName: sql<
          string | null
        >`coalesce(${doctorUser.name}, ${IndependentPatientModel.doctorName})`,
      })
      .from(LabInvoiceModel)
      .innerJoin(
        LabOrderModel,
        eq(LabInvoiceModel.appointmentTestId, LabOrderModel.id)
      )
      .leftJoin(LabsModel, eq(LabInvoiceModel.labId, LabsModel.id))
      .leftJoin(patientUser, eq(LabOrderModel.patientId, patientUser.id))
      .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
      .leftJoin(
        IndependentPatientModel,
        eq(LabOrderModel.independentPatientId, IndependentPatientModel.id)
      )
      .where(
        and(
          eq(LabInvoiceModel.appointmentTestId, appointmentTestId),
          eq(LabInvoiceModel.clinicId, context.clinicId),
          eq(LabInvoiceModel.labId, context.labId),
          eq(LabOrderModel.clinicId, context.clinicId)
        )
      )
      .limit(1);

    return record ?? null;
  }

  private static async getConsolidatedLabInvoice(
    trx: DbTransaction,
    anchor: LabInvoiceAnchorRecord,
    appointmentTestId: string,
    context: { clinicId: string; labId: string }
  ) {
    const invoiceScopeCondition = anchor.appointmentTest.appointmentId
      ? eq(LabOrderModel.appointmentId, anchor.appointmentTest.appointmentId)
      : eq(LabOrderModel.id, appointmentTestId);

    const items = await trx
      .select({
        invoiceId: LabInvoiceModel.id,
        invoiceNumber: LabInvoiceModel.invoiceNumber,
        invoicePaymentMethod: LabInvoiceModel.paymentMethod,
        invoiceTotalAmount: LabInvoiceModel.totalAmount,
        invoiceCreatedAt: LabInvoiceModel.createdAt,
        invoiceUpdatedAt: LabInvoiceModel.updatedAt,
        appointmentTestId: LabOrderModel.id,
        testId: LabOrderModel.testId,
        testName: TestCatalogModel.name,
        category: TestCatalogModel.category,
        sampleType: LabSamplesModel.sampleType,
        barcodeValue: LabSamplesModel.barcodeValue,
        appointmentTestPrice: LabOrderModel.price,
        patientTestPrice: TestCatalogModel.price,
      })
      .from(LabOrderModel)
      .innerJoin(
        TestCatalogModel,
        eq(LabOrderModel.testId, TestCatalogModel.id)
      )
      .leftJoin(
        LabInvoiceModel,
        and(
          eq(LabInvoiceModel.appointmentTestId, LabOrderModel.id),
          eq(LabInvoiceModel.clinicId, context.clinicId)
        )
      )
      .leftJoin(
        LabSamplesModel,
        and(
          eq(LabSamplesModel.appointmentTestId, LabOrderModel.id),
          eq(LabSamplesModel.clinicId, context.clinicId),
          eq(LabSamplesModel.labId, context.labId)
        )
      )
      .leftJoin(
        UserLabAssignmentsModel,
        and(
          eq(UserLabAssignmentsModel.userId, LabOrderModel.labAssistantId),
          eq(UserLabAssignmentsModel.labId, context.labId),
          eq(UserLabAssignmentsModel.clinicId, context.clinicId)
        )
      )
      .where(
        and(
          invoiceScopeCondition,
          eq(LabOrderModel.clinicId, context.clinicId),
          eq(LabOrderModel.paymentStatus, APPOINTMENT_TEST_PAYMENT_STATUS.PAID),
          notInArray(
            LabOrderModel.workflowStatus,
            this.getLabInvoiceExcludedWorkflowStatuses()
          ),
          eq(TestCatalogModel.isDeleted, false),
          isNull(TestCatalogModel.deletedAt),
          or(
            eq(LabInvoiceModel.labId, context.labId),
            and(
              isNull(LabInvoiceModel.id),
              isNotNull(UserLabAssignmentsModel.id)
            )
          )
        )
      )
      .orderBy(asc(LabOrderModel.createdAt), asc(LabOrderModel.id));

    if (items.length === 0) {
      return null;
    }

    return this.formatLabInvoice(anchor, items, appointmentTestId);
  }

  private static async getFormattedLabInvoiceById(
    trx: DbTransaction,
    invoiceId: string,
    context: { clinicId: string; labId: string }
  ) {
    const anchor = await this.getLabInvoiceAnchorById(trx, invoiceId, context);

    if (!anchor) {
      return null;
    }

    return await this.getConsolidatedLabInvoice(
      trx,
      anchor,
      anchor.appointmentTest.id,
      context
    );
  }

  private static async getFormattedLabInvoiceByAppointmentTestId(
    trx: DbTransaction,
    appointmentTestId: string,
    context: { clinicId: string; labId: string }
  ) {
    const anchor = await this.getLabInvoiceAnchorByAppointmentTestId(
      trx,
      appointmentTestId,
      context
    );

    if (
      !anchor ||
      !this.isPaymentPaid(anchor.appointmentTest.paymentStatus) ||
      this.isExcludedFromLabInvoice(anchor.appointmentTest.workflowStatus)
    ) {
      return null;
    }

    return await this.getConsolidatedLabInvoice(
      trx,
      anchor,
      appointmentTestId,
      context
    );
  }

  private static canEditExpectedReportReadyAt(
    sampleStatus: string | null | undefined
  ) {
    const editableSampleStatuses: AppointmentTestSampleStatus[] = [
      APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_RECEIVED_AT_LAB,
      APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_PROCESSING,
      APPOINTMENT_TEST_SAMPLE_STATUS.TESTING_IN_PROGRESS,
      APPOINTMENT_TEST_SAMPLE_STATUS.QUALITY_CHECK,
    ];

    return editableSampleStatuses.includes(
      (sampleStatus ??
        APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED) as AppointmentTestSampleStatus
    );
  }

  private static normalizeDashboardText(value: string | null | undefined) {
    return (value ?? '').trim().toLowerCase();
  }

  private static normalizeLabTestMatchText(value: string | null | undefined) {
    return (value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private static getCatalogKey(
    testName: string | null | undefined,
    category?: string | null
  ) {
    return `${this.normalizeDashboardText(
      testName
    )}::${this.normalizeDashboardText(category)}`;
  }

  private static buildCatalogLookups(catalogRows: LabDashboardCatalogRow[]) {
    const availableNames = new Set<string>();
    const priceByName = new Map<string, number>();
    const priceByNameAndCategory = new Map<string, number>();

    for (const row of catalogRows) {
      const nameKey = this.normalizeDashboardText(row.name);

      if (!nameKey) {
        continue;
      }

      availableNames.add(nameKey);

      if (typeof row.price === 'number') {
        if (!priceByName.has(nameKey)) {
          priceByName.set(nameKey, row.price);
        }

        priceByNameAndCategory.set(
          this.getCatalogKey(row.name, row.category),
          row.price
        );
      }
    }

    return {
      availableNames,
      priceByName,
      priceByNameAndCategory,
      rows: catalogRows,
    };
  }

  private static getLabCatalogMatchScore(
    row: Pick<LabDashboardRow, 'testName' | 'category'>,
    catalogRow: LabDashboardCatalogRow
  ) {
    const testName = this.normalizeLabTestMatchText(row.testName);
    const catalogName = this.normalizeLabTestMatchText(catalogRow.name);
    const catalogCode = this.normalizeLabTestMatchText(catalogRow.testCode);
    const sameCategory =
      this.normalizeDashboardText(row.category) !== '' &&
      this.normalizeDashboardText(row.category) ===
        this.normalizeDashboardText(catalogRow.category);

    if (!testName || !catalogName) {
      return 0;
    }

    let score = 0;

    if (catalogCode && catalogCode === testName) {
      score = 1;
    }

    if (score === 0 && catalogName === testName) {
      score = 1;
    }

    if (
      score === 0 &&
      (catalogName.includes(testName) || testName.includes(catalogName))
    ) {
      score = 0.9;
    }

    if (score === 0) {
      const testWords = testName.split(/\s+/).filter(Boolean);
      const catalogWords = catalogName.split(/\s+/).filter(Boolean);
      const testAcronym = testWords.map((word) => word[0]).join('');
      const catalogAcronym = catalogWords.map((word) => word[0]).join('');

      if (testAcronym === catalogAcronym && testAcronym.length > 1) {
        score = 0.85;
      } else if (testAcronym === catalogName || catalogAcronym === testName) {
        score = 0.85;
      } else {
        const commonWords = testWords.filter((word) =>
          catalogWords.includes(word)
        );

        if (commonWords.length > 0) {
          score =
            0.7 *
            (commonWords.length /
              Math.max(testWords.length, catalogWords.length));
        }
      }
    }

    if (sameCategory && score > 0) {
      score = Math.min(1, score + 0.05);
    }

    return score;
  }

  private static findBestLabCatalogMatch(
    row: Pick<LabDashboardRow, 'testName' | 'category'>,
    catalogRows: LabDashboardCatalogRow[]
  ) {
    let bestMatch: LabDashboardCatalogRow | null = null;
    let bestScore = 0;

    for (const catalogRow of catalogRows) {
      const score = this.getLabCatalogMatchScore(row, catalogRow);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = catalogRow;
      }
    }

    return bestScore > 0.5 ? bestMatch : null;
  }

  private static getLabTestActionAvailability(
    row: Pick<LabDashboardRow, 'testName' | 'category' | 'workflowStatus'>,
    catalogRows: LabDashboardCatalogRow[]
  ) {
    const matchedCatalogTest = this.findBestLabCatalogMatch(row, catalogRows);
    const workflowStatus = this.getLabResponseWorkflowStatus(
      row.workflowStatus
    );
    const isActiveLabTest = matchedCatalogTest !== null;
    const isNewRequest =
      workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED;
    const isRejected =
      workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED;
    const canReview = isNewRequest && isActiveLabTest;
    let actionStatus:
      | 'READY_FOR_REVIEW'
      | 'TEST_NOT_AVAILABLE'
      | 'NOT_REVIEWABLE'
      | 'REJECTED' = 'NOT_REVIEWABLE';

    if (isRejected) {
      actionStatus = 'REJECTED';
    } else if (canReview) {
      actionStatus = 'READY_FOR_REVIEW';
    } else if (!isActiveLabTest) {
      actionStatus = 'TEST_NOT_AVAILABLE';
    }

    return {
      isActiveLabTest,
      canAccept: canReview,
      canReject: canReview,
      actionStatus,
      unavailableReason: isActiveLabTest
        ? null
        : 'No active lab test is configured for this request.',
      matchedLabTest: matchedCatalogTest
        ? {
            id: matchedCatalogTest.id,
            name: matchedCatalogTest.name,
            testCode: matchedCatalogTest.testCode,
            category: matchedCatalogTest.category,
            price: matchedCatalogTest.price,
            sampleType: matchedCatalogTest.sampleType ?? null,
          }
        : null,
    };
  }

  private static getDashboardPrice(
    row: Pick<LabDashboardRow, 'testName' | 'category' | 'price' | 'testPrice'>,
    catalogLookups: ReturnType<
      typeof AppointmentTestService.buildCatalogLookups
    >
  ) {
    const matchedCatalogTest = this.findBestLabCatalogMatch(
      row,
      catalogLookups.rows
    );

    return (
      catalogLookups.priceByNameAndCategory.get(
        this.getCatalogKey(row.testName, row.category)
      ) ??
      catalogLookups.priceByName.get(
        this.normalizeDashboardText(row.testName)
      ) ??
      matchedCatalogTest?.price ??
      row.price ??
      row.testPrice ??
      0
    );
  }

  private static buildRecentRejectedRequests(
    rows: LabDashboardRow[],
    catalogLookups: ReturnType<
      typeof AppointmentTestService.buildCatalogLookups
    >
  ) {
    return [...rows]
      .sort(
        (a, b) =>
          (b.rejectedAt ?? b.updatedAt ?? b.createdAt).getTime() -
          (a.rejectedAt ?? a.updatedAt ?? a.createdAt).getTime()
      )
      .slice(0, 10)
      .map((row) => ({
        appointmentTestId: row.appointmentTestId,
        uniqueTestId: row.uniqueTestId,
        patientName: row.patientName,
        patientMobile: row.patientMobile,
        patientPhone: row.patientMobile,
        patientNumber: row.patientMobile,
        doctorName: row.doctorName,
        testName: row.testName,
        category: row.category,
        price: this.getDashboardPrice(row, catalogLookups),
        dateTime: row.dateTime,
        appointmentTime: row.appointmentTime,
        workflowStatus: this.getLabResponseWorkflowStatus(row.workflowStatus),
        labAssistantId: row.labAssistantId ?? null,
        rejectedAt: row.rejectedAt?.toISOString() ?? null,
        rejectedByUserId: row.labAssistantId ?? null,
        rejectionReason: row.rejectionReason ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
  }

  private static getIstParts(date: Date) {
    const shifted = new Date(date.getTime() + IST_OFFSET_MS);

    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth(),
      date: shifted.getUTCDate(),
      day: shifted.getUTCDay(),
    };
  }

  private static getIstBoundary(year: number, month: number, date: number) {
    return new Date(Date.UTC(year, month, date) - IST_OFFSET_MS);
  }

  private static getIstDayRange(date = new Date()) {
    const parts = this.getIstParts(date);

    return {
      start: this.getIstBoundary(parts.year, parts.month, parts.date),
      end: this.getIstBoundary(parts.year, parts.month, parts.date + 1),
    };
  }

  private static getIstWeekRange(date = new Date()) {
    const parts = this.getIstParts(date);
    const daysSinceMonday = (parts.day + 6) % 7;

    return {
      start: this.getIstBoundary(
        parts.year,
        parts.month,
        parts.date - daysSinceMonday
      ),
      end: this.getIstBoundary(
        parts.year,
        parts.month,
        parts.date - daysSinceMonday + 7
      ),
    };
  }

  private static getIstMonthRange(date = new Date()) {
    const parts = this.getIstParts(date);

    return {
      start: this.getIstBoundary(parts.year, parts.month, 1),
      end: this.getIstBoundary(parts.year, parts.month + 1, 1),
    };
  }

  private static getIstYearMonthKey(date: Date) {
    const parts = this.getIstParts(date);
    const month = String(parts.month + 1).padStart(2, '0');

    return `${parts.year}-${month}`;
  }

  private static getIstDateKey(date: Date) {
    const parts = this.getIstParts(date);
    const month = String(parts.month + 1).padStart(2, '0');
    const day = String(parts.date).padStart(2, '0');

    return `${parts.year}-${month}-${day}`;
  }

  private static getIstMonthLabel(date: Date) {
    const parts = this.getIstParts(date);

    return `${MONTH_LABELS[parts.month]} ${parts.year}`;
  }

  private static getIstDayLabel(date: Date) {
    const parts = this.getIstParts(date);

    return `${MONTH_LABELS[parts.month]} ${parts.date}`;
  }

  private static parseDateOnly(value: string) {
    const [year, month, date] = value.split('-').map(Number);

    return { year, month: month - 1, date };
  }

  private static getIstDateOnlyRange(startDate: string, endDate: string) {
    const startParts = this.parseDateOnly(startDate);
    const endParts = this.parseDateOnly(endDate);

    return {
      start: this.getIstBoundary(
        startParts.year,
        startParts.month,
        startParts.date
      ),
      end: this.getIstBoundary(
        endParts.year,
        endParts.month,
        endParts.date + 1
      ),
    };
  }

  private static getInclusiveIstEndDateKey(end: Date) {
    return this.getIstDateKey(new Date(end.getTime() - 1));
  }

  private static getPreviousDateRange(start: Date, end: Date) {
    const duration = end.getTime() - start.getTime();

    return {
      comparisonStart: new Date(start.getTime() - duration),
      comparisonEnd: new Date(start.getTime()),
    };
  }

  private static getLabDashboardDateRange(
    query: LabAppointmentTestsQuery
  ): LabDashboardDateRange {
    const now = new Date();
    const requestedPreset =
      query.datePreset ?? (query.startDate && query.endDate ? 'custom' : null);

    if (!requestedPreset) {
      return {
        datePreset: null,
        start: null,
        end: null,
        startDate: null,
        endDate: null,
        comparisonStart: null,
        comparisonEnd: null,
        comparisonStartDate: null,
        comparisonEndDate: null,
        comparisonPeriod: 'previousPeriod',
        comparisonLabel: 'vs previous period',
      };
    }

    let start: Date;
    let end: Date;
    let comparisonLabel = 'vs previous period';
    let comparisonPeriod: LabDashboardComparisonPeriod = 'previousPeriod';

    if (requestedPreset === 'custom') {
      if (!query.startDate || !query.endDate) {
        return {
          datePreset: requestedPreset,
          start: null,
          end: null,
          startDate: query.startDate ?? null,
          endDate: query.endDate ?? null,
          comparisonStart: null,
          comparisonEnd: null,
          comparisonStartDate: null,
          comparisonEndDate: null,
          comparisonPeriod,
          comparisonLabel,
        };
      }

      const customRange = this.getIstDateOnlyRange(
        query.startDate,
        query.endDate
      );
      start = customRange.start;
      end = customRange.end;
    } else if (requestedPreset === 'today') {
      const todayRange = this.getIstDayRange(now);
      start = todayRange.start;
      end = todayRange.end;
      comparisonLabel = 'vs yesterday';
      comparisonPeriod = 'yesterday';
    } else if (requestedPreset === 'yesterday') {
      const todayRange = this.getIstDayRange(now);
      start = new Date(todayRange.start.getTime() - MS_PER_DAY);
      end = todayRange.start;
      comparisonLabel = 'vs previous day';
      comparisonPeriod = 'previousDay';
    } else if (requestedPreset === 'thisWeek') {
      const weekRange = this.getIstWeekRange(now);
      start = weekRange.start;
      end = weekRange.end;
      comparisonLabel = 'vs last week';
      comparisonPeriod = 'lastWeek';
    } else {
      const monthRange = this.getIstMonthRange(now);
      start = monthRange.start;
      end = monthRange.end;
      comparisonLabel = 'vs last month';
      comparisonPeriod = 'lastMonth';
    }

    let previousRange: {
      comparisonStart: Date;
      comparisonEnd: Date;
    };

    if (requestedPreset === 'today' || requestedPreset === 'yesterday') {
      previousRange = {
        comparisonStart: new Date(start.getTime() - MS_PER_DAY),
        comparisonEnd: start,
      };
    } else if (requestedPreset === 'thisMonth') {
      const startParts = this.getIstParts(start);

      previousRange = {
        comparisonStart: this.getIstBoundary(
          startParts.year,
          startParts.month - 1,
          1
        ),
        comparisonEnd: start,
      };
    } else {
      previousRange = this.getPreviousDateRange(start, end);
    }

    return {
      datePreset: requestedPreset,
      start,
      end,
      startDate: this.getIstDateKey(start),
      endDate: this.getInclusiveIstEndDateKey(end),
      comparisonStart: previousRange.comparisonStart,
      comparisonEnd: previousRange.comparisonEnd,
      comparisonStartDate: this.getIstDateKey(previousRange.comparisonStart),
      comparisonEndDate: this.getInclusiveIstEndDateKey(
        previousRange.comparisonEnd
      ),
      comparisonPeriod,
      comparisonLabel,
    };
  }

  private static getLabDashboardDateCondition(
    dateRange: Pick<LabDashboardDateRange, 'start' | 'end'>
  ): SQL | null {
    if (!dateRange.start || !dateRange.end) {
      return null;
    }

    return or(
      and(
        isNull(LabOrderModel.appointmentId),
        gte(LabOrderModel.createdAt, dateRange.start),
        lt(LabOrderModel.createdAt, dateRange.end)
      ),
      and(
        isNotNull(LabOrderModel.appointmentId),
        gte(AppointmentModel.appointmentDate, dateRange.start),
        lt(AppointmentModel.appointmentDate, dateRange.end)
      )
    ) as SQL;
  }

  private static toDashboardDate(
    date: Date | string | number | null | undefined
  ) {
    if (!date) {
      return null;
    }

    if (date instanceof Date) {
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const parsed = new Date(date);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private static isDateInRange(
    date: Date | string | number | null | undefined,
    start: Date,
    end: Date
  ) {
    const normalizedDate = this.toDashboardDate(date);

    if (!normalizedDate) {
      return false;
    }

    const time = normalizedDate.getTime();

    return time >= start.getTime() && time < end.getTime();
  }

  private static getDashboardTestDate(row: LabDashboardRow) {
    return (
      this.toDashboardDate(row.dateTime) ??
      this.toDashboardDate(row.createdAt) ??
      new Date()
    );
  }

  private static getDashboardRevenueDate(row: LabDashboardRow) {
    return (
      this.toDashboardDate(row.paymentCollectedAt) ??
      this.toDashboardDate(row.updatedAt) ??
      this.toDashboardDate(row.createdAt) ??
      new Date()
    );
  }

  private static getDashboardPercentage(countValue: number, total: number) {
    if (total <= 0) {
      return 0;
    }

    return Number(((countValue / total) * 100).toFixed(2));
  }

  private static getDashboardActivityTitle(row: LabDashboardRow) {
    switch (row.workflowStatus) {
      case APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED:
        return 'New test initiated';
      case APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD:
        return 'Test pending';
      case APPOINTMENT_TEST_WORKFLOW_STATUS.IN_PROGRESS:
        return 'Test in progress';
      case APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED:
        return 'Test completed';
      case APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED:
        return 'Test rejected';
      default:
        return 'Lab test updated';
    }
  }

  private static roundDashboardNumber(value: number, precision = 2) {
    if (!Number.isFinite(value)) {
      return 0;
    }

    const multiplier = 10 ** precision;

    return Math.round(value * multiplier) / multiplier;
  }

  private static clampDashboardTrendPercentage(value: number) {
    const roundedValue = this.roundDashboardNumber(value);

    return Math.max(-100, Math.min(100, roundedValue));
  }

  private static getDashboardChangePercentage(
    current: number,
    previous: number
  ) {
    if (previous === 0) {
      return 0;
    }

    const baseline = Math.max(Math.abs(current), Math.abs(previous));

    if (baseline === 0) {
      return 0;
    }

    return this.clampDashboardTrendPercentage(
      ((current - previous) / baseline) * 100
    );
  }

  private static buildDashboardTrend(
    current: number,
    previous: number,
    comparison: Pick<
      LabDashboardDateRange,
      'comparisonLabel' | 'comparisonStartDate' | 'comparisonEndDate'
    >
  ): LabDashboardMetricTrend {
    const percentage = this.getDashboardChangePercentage(current, previous);

    return {
      value: this.roundDashboardNumber(current),
      previousValue: this.roundDashboardNumber(previous),
      change: this.roundDashboardNumber(current - previous),
      percentage,
      trendPercentage: percentage,
      direction: percentage > 0 ? 'up' : percentage < 0 ? 'down' : 'neutral',
      comparisonLabel: comparison.comparisonLabel,
      comparisonStartDate: comparison.comparisonStartDate,
      comparisonEndDate: comparison.comparisonEndDate,
    };
  }

  private static getPendingReportDueAt(row: LabDashboardRow) {
    return (
      row.expectedReportReadyAt ??
      row.readyForReportAt ??
      new Date(row.createdAt.getTime() + MS_PER_DAY)
    );
  }

  private static isPendingReport(row: LabDashboardRow) {
    if (
      row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED ||
      row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED ||
      row.reportPdf
    ) {
      return false;
    }

    const sampleStatus =
      row.sampleStatus ?? APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED;

    return (
      row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.IN_PROGRESS ||
      row.expectedReportReadyAt !== null ||
      sampleStatus === APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_PROCESSING ||
      sampleStatus === APPOINTMENT_TEST_SAMPLE_STATUS.TESTING_IN_PROGRESS ||
      sampleStatus === APPOINTMENT_TEST_SAMPLE_STATUS.QUALITY_CHECK ||
      sampleStatus === APPOINTMENT_TEST_SAMPLE_STATUS.COMPLETED
    );
  }

  private static isSampleCollected(row: LabDashboardRow) {
    const sampleStatus =
      row.sampleStatus ?? APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED;
    const collectedStatuses: AppointmentTestSampleStatus[] = [
      APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_COLLECTED,
      APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_RECEIVED_AT_LAB,
      APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_PROCESSING,
      APPOINTMENT_TEST_SAMPLE_STATUS.TESTING_IN_PROGRESS,
      APPOINTMENT_TEST_SAMPLE_STATUS.QUALITY_CHECK,
      APPOINTMENT_TEST_SAMPLE_STATUS.COMPLETED,
    ];

    return collectedStatuses.includes(
      sampleStatus as AppointmentTestSampleStatus
    );
  }

  private static isTestPerformed(row: LabDashboardRow) {
    const sampleStatus =
      row.sampleStatus ?? APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED;
    const performedStatuses: AppointmentTestSampleStatus[] = [
      APPOINTMENT_TEST_SAMPLE_STATUS.TESTING_IN_PROGRESS,
      APPOINTMENT_TEST_SAMPLE_STATUS.QUALITY_CHECK,
      APPOINTMENT_TEST_SAMPLE_STATUS.COMPLETED,
    ];

    return (
      row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED ||
      performedStatuses.includes(sampleStatus as AppointmentTestSampleStatus)
    );
  }

  private static isReportGenerated(row: LabDashboardRow) {
    return (
      row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED ||
      Boolean(row.reportPdf) ||
      row.readyForReportAt !== null
    );
  }

  private static getTurnaroundTimeHours(rows: LabDashboardRow[]) {
    const durations = rows
      .filter((row) => this.isReportGenerated(row))
      .map((row) => {
        const completedAt =
          row.readyForReportAt ?? row.updatedAt ?? row.createdAt;
        return completedAt.getTime() - row.createdAt.getTime();
      })
      .filter((duration) => duration >= 0);

    if (durations.length === 0) {
      return 0;
    }

    const averageMs =
      durations.reduce((sum, duration) => sum + duration, 0) / durations.length;

    return this.roundDashboardNumber(averageMs / (60 * 60 * 1000));
  }

  private static getDueInLabel(dueInMinutes: number) {
    const absoluteMinutes = Math.abs(dueInMinutes);
    const hours = Math.floor(absoluteMinutes / 60);
    const minutes = absoluteMinutes % 60;
    const timeParts = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    return dueInMinutes < 0 ? `Overdue by ${timeParts}` : `Due in ${timeParts}`;
  }

  private static getLabDashboardMetricSnapshot(
    rows: LabDashboardRow[],
    catalogLookups: ReturnType<
      typeof AppointmentTestService.buildCatalogLookups
    >,
    criticalAlertCount = 0
  ): LabDashboardMetricSnapshot {
    const getPrice = (row: LabDashboardRow) =>
      this.getDashboardPrice(row, catalogLookups);
    const paidRows = rows.filter((row) =>
      this.isPaymentPaid(row.paymentStatus)
    );
    const completedTests = rows.filter(
      (row) => row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED
    ).length;
    const rejectedTests = rows.filter(
      (row) => row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED
    ).length;
    const totalTests = rows.length;
    const reportsGenerated = rows.filter((row) =>
      this.isReportGenerated(row)
    ).length;
    const reportAccuracyDenominator = completedTests + rejectedTests;

    return {
      totalTests,
      newRequests: rows.filter(
        (row) =>
          row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED
      ).length,
      inProgressTests: rows.filter(
        (row) =>
          row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.IN_PROGRESS
      ).length,
      completedTests,
      pendingReports: rows.filter((row) => this.isPendingReport(row)).length,
      totalRevenue: this.roundDashboardNumber(
        paidRows.reduce((sum, row) => sum + getPrice(row), 0)
      ),
      samplesCollected: rows.filter((row) => this.isSampleCollected(row))
        .length,
      testsPerformed: rows.filter((row) => this.isTestPerformed(row)).length,
      reportsGenerated,
      criticalAlerts: criticalAlertCount,
      turnaroundTime: this.getTurnaroundTimeHours(rows),
      reportAccuracy:
        reportAccuracyDenominator === 0
          ? 0
          : this.getDashboardPercentage(
              completedTests,
              reportAccuracyDenominator
            ),
      sampleRejectionRate: this.getDashboardPercentage(
        rejectedTests,
        totalTests
      ),
    };
  }

  private static buildLabAppointmentDashboard(
    rows: LabDashboardRow[],
    catalogRows: LabDashboardCatalogRow[],
    comparisonRows: LabDashboardRow[] = [],
    options?: {
      dateRange?: LabDashboardDateRange;
      trendPeriod?: LabDashboardTrendPeriod;
      rejectedRows?: LabDashboardRow[];
    }
  ) {
    const catalogLookups = this.buildCatalogLookups(catalogRows);
    const now = new Date();
    const todayRange = this.getIstDayRange(now);
    const currentIstParts = this.getIstParts(now);
    const monthRange = this.getIstMonthRange(now);
    const olderThan24Hours = new Date(now.getTime() - MS_PER_DAY);
    const dateRange = options?.dateRange ?? this.getLabDashboardDateRange({});
    const trendPeriod = options?.trendPeriod ?? 'daily';
    const getPrice = (row: LabDashboardRow) =>
      this.getDashboardPrice(row, catalogLookups);
    const getPaidRevenue = (matchingRows: LabDashboardRow[]) =>
      this.roundDashboardNumber(
        matchingRows
          .filter((row) => this.isPaymentPaid(row.paymentStatus))
          .reduce((sum, row) => sum + getPrice(row), 0)
      );
    const countWorkflowStatus = (status: string) =>
      rows.filter(
        (row) =>
          this.getLabResponseWorkflowStatus(row.workflowStatus) === status
      ).length;
    const getRowsInTestBucket = (start: Date, end: Date) =>
      rows.filter((row) =>
        this.isDateInRange(this.getDashboardTestDate(row), start, end)
      );
    const getRowsInRevenueBucket = (start: Date, end: Date) =>
      rows.filter((row) =>
        this.isDateInRange(this.getDashboardRevenueDate(row), start, end)
      );
    const getStatusCount = (
      key: (typeof STATUS_BREAKDOWN_META)[number]['key']
    ) => {
      if (key === 'NEW_REQUESTS') {
        return countWorkflowStatus(APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED);
      }

      if (key === 'IN_PROGRESS') {
        return countWorkflowStatus(
          APPOINTMENT_TEST_WORKFLOW_STATUS.IN_PROGRESS
        );
      }

      if (key === 'COMPLETED') {
        return countWorkflowStatus(APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED);
      }

      return rows.filter((row) => this.isPendingReport(row)).length;
    };
    const isSampleCollectionPending = (row: LabDashboardRow) => {
      const sampleStatus =
        row.sampleStatus ?? APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED;

      return (
        row.workflowStatus !== APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED &&
        row.workflowStatus !== APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED &&
        (sampleStatus === APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED ||
          sampleStatus ===
            APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_COLLECTION_PENDING)
      );
    };

    const pendingReportRows = rows.filter((row) => this.isPendingReport(row));
    const overdueReportRows = pendingReportRows.filter(
      (row) => this.getPendingReportDueAt(row).getTime() < now.getTime()
    );
    const overdueSampleRows = rows.filter(
      (row) =>
        isSampleCollectionPending(row) &&
        row.createdAt.getTime() < olderThan24Hours.getTime()
    );
    const pendingPaymentRows = rows.filter(
      (row) =>
        this.isPaymentPending(row.paymentStatus) &&
        row.createdAt.getTime() < olderThan24Hours.getTime()
    );
    const newRequestRows = rows.filter(
      (row) => row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED
    );
    const todayNewRequestRows = newRequestRows.filter((row) =>
      this.isDateInRange(
        this.getDashboardTestDate(row),
        todayRange.start,
        todayRange.end
      )
    );
    const requestActionSummaries = newRequestRows.map((row) =>
      this.getLabTestActionAvailability(row, catalogLookups.rows)
    );
    const acceptableRequests = requestActionSummaries.filter(
      (action) => action.canAccept
    ).length;
    const unavailableRequests = requestActionSummaries.filter(
      (action) => !action.isActiveLabTest
    ).length;
    const rejectedRequestRows =
      options?.rejectedRows ??
      rows.filter(
        (row) =>
          row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED
      );
    const todayPaymentTotal = this.roundDashboardNumber(
      todayNewRequestRows.reduce((sum, row) => sum + getPrice(row), 0)
    );
    const pendingPaymentTotal = this.roundDashboardNumber(
      newRequestRows
        .filter((row) => this.isPaymentPending(row.paymentStatus))
        .reduce((sum, row) => sum + getPrice(row), 0)
    );
    const requestReview = {
      totalRequests: rows.length,
      newRequests: newRequestRows.length,
      todayDate: this.getIstDateKey(todayRange.start),
      todayRequests: todayNewRequestRows.length,
      todayPaymentTotal,
      currentDatePaymentTotal: todayPaymentTotal,
      pendingPaymentTotal,
      activeRequests: acceptableRequests,
      acceptableRequests,
      unavailableRequests,
      rejectedRequests: rejectedRequestRows.length,
      cards: [
        {
          key: 'totalRequests',
          label: 'Total Requests',
          value: rows.length,
          valueType: 'number',
        },
        {
          key: 'newRequests',
          label: 'New Requests',
          value: newRequestRows.length,
          valueType: 'number',
        },
        {
          key: 'todayPaymentTotal',
          label: "Today's Payment Total",
          value: todayPaymentTotal,
          valueType: 'currency',
        },
        {
          key: 'acceptableRequests',
          label: 'Available To Accept',
          value: acceptableRequests,
          valueType: 'number',
        },
        {
          key: 'rejectedRequests',
          label: 'Rejected Requests',
          value: rejectedRequestRows.length,
          valueType: 'number',
        },
      ],
      recentRejectedRequests: this.buildRecentRejectedRequests(
        rejectedRequestRows,
        catalogLookups
      ),
    };

    const criticalAlerts = [
      ...overdueReportRows.map((row) => {
        const dueAt = this.getPendingReportDueAt(row);

        return {
          id: `${row.appointmentTestId}:overdue-report`,
          title: 'Report overdue',
          description: `${row.testName} report is past the expected ready time.`,
          severity: 'high',
          time: dueAt.toISOString(),
          appointmentTestId: row.appointmentTestId,
        };
      }),
      ...overdueSampleRows.map((row) => ({
        id: `${row.appointmentTestId}:overdue-sample`,
        title: 'Sample collection overdue',
        description: `${row.testName} sample has not been collected within 24 hours.`,
        severity: 'medium',
        time: row.createdAt.toISOString(),
        appointmentTestId: row.appointmentTestId,
      })),
      ...pendingPaymentRows.map((row) => ({
        id: `${row.appointmentTestId}:pending-payment`,
        title: 'Payment pending',
        description: `${row.testName} payment has been pending for more than 24 hours.`,
        severity: 'medium',
        time: row.createdAt.toISOString(),
        appointmentTestId: row.appointmentTestId,
      })),
    ]
      .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
      .slice(0, 10);

    const currentMetrics = this.getLabDashboardMetricSnapshot(
      rows,
      catalogLookups,
      criticalAlerts.length
    );
    const hasComparisonRange =
      dateRange.comparisonStart !== null && dateRange.comparisonEnd !== null;
    const previousMetrics = hasComparisonRange
      ? this.getLabDashboardMetricSnapshot(comparisonRows, catalogLookups)
      : currentMetrics;
    const totalTests = currentMetrics.totalTests;
    const paidRows = rows.filter((row) =>
      this.isPaymentPaid(row.paymentStatus)
    );
    const todayTests = getRowsInTestBucket(
      todayRange.start,
      todayRange.end
    ).length;
    const todayRevenue = getPaidRevenue(
      getRowsInRevenueBucket(todayRange.start, todayRange.end)
    );
    const monthlyRevenue = getPaidRevenue(
      getRowsInRevenueBucket(monthRange.start, monthRange.end)
    );

    const statusBreakdown = STATUS_BREAKDOWN_META.map((status) => {
      const statusCount = getStatusCount(status.key);

      return {
        key: status.key,
        label: status.label,
        count: statusCount,
        percentage: this.getDashboardPercentage(statusCount, totalTests),
      };
    });

    const paymentBreakdown = PAYMENT_BREAKDOWN_META.map((payment) => {
      const paymentRows = rows.filter(
        (row) => this.getDashboardPaymentKey(row.paymentStatus) === payment.key
      );
      const amount = paymentRows.reduce((sum, row) => sum + getPrice(row), 0);

      return {
        key: payment.key,
        label: payment.label,
        count: paymentRows.length,
        amount: this.roundDashboardNumber(amount),
        percentage: this.getDashboardPercentage(paymentRows.length, totalTests),
      };
    });

    const sampleWorkflowFunnel = SAMPLE_FUNNEL_META.map((sampleStatus) => ({
      key: sampleStatus.key,
      label: sampleStatus.label,
      count: rows.filter(
        (row) =>
          (row.sampleStatus ?? APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED) ===
          sampleStatus.key
      ).length,
    }));

    const dailyStart =
      dateRange.start ??
      this.getIstBoundary(
        currentIstParts.year,
        currentIstParts.month,
        currentIstParts.date - 8
      );
    const dailyEnd =
      dateRange.end ??
      this.getIstBoundary(
        currentIstParts.year,
        currentIstParts.month,
        currentIstParts.date + 1
      );
    const dailyTrend: {
      date: string;
      label: string;
      tests: number;
      revenue: number;
    }[] = [];
    let dailyCursor = dailyStart;

    while (dailyCursor.getTime() < dailyEnd.getTime()) {
      const nextDayParts = this.getIstParts(dailyCursor);
      const nextDay = this.getIstBoundary(
        nextDayParts.year,
        nextDayParts.month,
        nextDayParts.date + 1
      );

      dailyTrend.push({
        date: this.getIstDateKey(dailyCursor),
        label: this.getIstDayLabel(dailyCursor),
        tests: getRowsInTestBucket(dailyCursor, nextDay).length,
        revenue: getPaidRevenue(getRowsInRevenueBucket(dailyCursor, nextDay)),
      });

      dailyCursor = nextDay;
    }

    const getWeekStart = (date: Date) => {
      const parts = this.getIstParts(date);
      const daysSinceMonday = (parts.day + 6) % 7;

      return this.getIstBoundary(
        parts.year,
        parts.month,
        parts.date - daysSinceMonday
      );
    };
    const currentWeekRange = this.getIstWeekRange(now);
    const weeklyStart =
      dateRange.start ??
      new Date(currentWeekRange.start.getTime() - 5 * 7 * MS_PER_DAY);
    const weeklyEnd = dateRange.end ?? currentWeekRange.end;
    const weeklyTrend: {
      date: string;
      label: string;
      tests: number;
      revenue: number;
    }[] = [];
    let weeklyCursor = getWeekStart(weeklyStart);

    while (weeklyCursor.getTime() < weeklyEnd.getTime()) {
      const nextWeek = new Date(weeklyCursor.getTime() + 7 * MS_PER_DAY);

      weeklyTrend.push({
        date: this.getIstDateKey(weeklyCursor),
        label: `Week of ${this.getIstDayLabel(weeklyCursor)}`,
        tests: getRowsInTestBucket(weeklyCursor, nextWeek).length,
        revenue: getPaidRevenue(getRowsInRevenueBucket(weeklyCursor, nextWeek)),
      });

      weeklyCursor = nextWeek;
    }

    const getMonthStart = (date: Date) => {
      const parts = this.getIstParts(date);

      return this.getIstBoundary(parts.year, parts.month, 1);
    };
    const getNextMonthStart = (date: Date) => {
      const parts = this.getIstParts(date);

      return this.getIstBoundary(parts.year, parts.month + 1, 1);
    };
    const monthlyStart =
      dateRange.start ??
      this.getIstBoundary(currentIstParts.year, currentIstParts.month - 5, 1);
    const monthlyEnd = dateRange.end
      ? getNextMonthStart(new Date(dateRange.end.getTime() - 1))
      : this.getIstBoundary(currentIstParts.year, currentIstParts.month + 1, 1);
    const monthlyTrend: {
      month: string;
      label: string;
      tests: number;
      revenue: number;
    }[] = [];
    let monthlyCursor = getMonthStart(monthlyStart);

    while (monthlyCursor.getTime() < monthlyEnd.getTime()) {
      const nextMonth = getNextMonthStart(monthlyCursor);

      monthlyTrend.push({
        month: this.getIstYearMonthKey(monthlyCursor),
        label: this.getIstMonthLabel(monthlyCursor),
        tests: getRowsInTestBucket(monthlyCursor, nextMonth).length,
        revenue: getPaidRevenue(
          getRowsInRevenueBucket(monthlyCursor, nextMonth)
        ),
      });

      monthlyCursor = nextMonth;
    }

    const requestedTestsByKey = new Map<
      string,
      {
        testName: string;
        category: string | null;
        count: number;
        revenue: number;
      }
    >();
    const doctorsByKey = new Map<
      string,
      {
        doctorName: string;
        department: string;
        count: number;
        revenue: number;
      }
    >();
    const catalogGapByKey = new Map<
      string,
      {
        testName: string;
        category: string | null;
        requestCount: number;
      }
    >();

    for (const row of rows) {
      const testGroupKey = this.getCatalogKey(row.testName, row.category);
      const testGroup = requestedTestsByKey.get(testGroupKey) ?? {
        testName: row.testName,
        category: row.category,
        count: 0,
        revenue: 0,
      };

      testGroup.count += 1;

      if (this.isPaymentPaid(row.paymentStatus)) {
        testGroup.revenue += getPrice(row);
      }

      requestedTestsByKey.set(testGroupKey, testGroup);

      const doctorName = row.doctorName ?? 'Unknown Doctor';
      const doctorGroupKey = this.normalizeDashboardText(doctorName);
      const doctorGroup = doctorsByKey.get(doctorGroupKey) ?? {
        doctorName,
        department: row.doctorDepartment ?? 'General',
        count: 0,
        revenue: 0,
      };

      doctorGroup.count += 1;

      if (this.isPaymentPaid(row.paymentStatus)) {
        doctorGroup.revenue += getPrice(row);
      }

      doctorsByKey.set(doctorGroupKey, doctorGroup);

      if (!this.findBestLabCatalogMatch(row, catalogLookups.rows)) {
        const gapGroup = catalogGapByKey.get(testGroupKey) ?? {
          testName: row.testName,
          category: row.category,
          requestCount: 0,
        };

        gapGroup.requestCount += 1;
        catalogGapByKey.set(testGroupKey, gapGroup);
      }
    }

    const topRequestedTests = Array.from(requestedTestsByKey.values())
      .map((test) => ({
        ...test,
        revenue: this.roundDashboardNumber(test.revenue),
      }))
      .sort(
        (a, b) =>
          b.count - a.count ||
          b.revenue - a.revenue ||
          a.testName.localeCompare(b.testName)
      )
      .slice(0, 10);
    const topReferringDoctors = Array.from(doctorsByKey.values())
      .map((doctor) => ({
        ...doctor,
        revenue: this.roundDashboardNumber(doctor.revenue),
      }))
      .sort(
        (a, b) =>
          b.count - a.count ||
          b.revenue - a.revenue ||
          a.doctorName.localeCompare(b.doctorName)
      )
      .slice(0, 10);
    const catalogGaps = Array.from(catalogGapByKey.values())
      .sort(
        (a, b) =>
          b.requestCount - a.requestCount ||
          a.testName.localeCompare(b.testName)
      )
      .slice(0, 10);
    const recentActivity = [...rows]
      .sort((a, b) => {
        const bTime = (b.updatedAt ?? b.createdAt).getTime();
        const aTime = (a.updatedAt ?? a.createdAt).getTime();

        return bTime - aTime;
      })
      .slice(0, 10)
      .map((row) => ({
        appointmentTestId: row.appointmentTestId,
        title: this.getDashboardActivityTitle(row),
        patientName: row.patientName,
        doctorName: row.doctorName,
        testName: row.testName,
        workflowStatus: this.getLabResponseWorkflowStatus(row.workflowStatus),
        paymentStatus: this.normalizePaymentStatus(row.paymentStatus),
        sampleStatus:
          row.sampleStatus ?? APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED,
        createdAt: row.createdAt.toISOString(),
        updatedAt: (row.updatedAt ?? row.createdAt).toISOString(),
      }));
    const recentTestRequests = [...rows]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10)
      .map((row) => ({
        appointmentTestId: row.appointmentTestId,
        requestId: row.uniqueTestId ?? row.appointmentTestId,
        patientName: row.patientName,
        patientMobile: row.patientMobile,
        testName: row.testName,
        sampleType: row.sampleType,
        workflowStatus: this.getLabResponseWorkflowStatus(row.workflowStatus),
        requestedBy: row.doctorName,
        requestedAt: row.createdAt.toISOString(),
      }));
    const pendingReports = pendingReportRows
      .sort(
        (a, b) =>
          this.getPendingReportDueAt(a).getTime() -
          this.getPendingReportDueAt(b).getTime()
      )
      .slice(0, 10)
      .map((row) => {
        const dueAt = this.getPendingReportDueAt(row);
        const dueInMinutes = Math.round(
          (dueAt.getTime() - now.getTime()) / (60 * 1000)
        );

        return {
          appointmentTestId: row.appointmentTestId,
          testName: row.testName,
          patientName: row.patientName,
          registeredOn: row.createdAt.toISOString(),
          dueAt: dueAt.toISOString(),
          dueInMinutes,
          dueInLabel: this.getDueInLabel(dueInMinutes),
        };
      });
    const upcomingSampleCollections = rows
      .filter((row) => isSampleCollectionPending(row))
      .sort(
        (a, b) =>
          this.getDashboardTestDate(a).getTime() -
          this.getDashboardTestDate(b).getTime()
      )
      .slice(0, 10)
      .map((row) => {
        const collectionTime = this.getDashboardTestDate(row);

        return {
          appointmentTestId: row.appointmentTestId,
          patientName: row.patientName,
          testName: row.testName,
          sampleType: row.sampleType,
          collectionTime: collectionTime.toISOString(),
          patientMobile: row.patientMobile,
          patientPhone: row.patientMobile,
          patientNumber: row.patientMobile,
        };
      });

    const revenueOverviewPoints =
      trendPeriod === 'weekly'
        ? weeklyTrend
        : trendPeriod === 'monthly'
          ? monthlyTrend.map((point) => ({
              date: `${point.month}-01`,
              label: point.label,
              tests: point.tests,
              revenue: point.revenue,
            }))
          : dailyTrend;
    const comparisonLabel = dateRange.comparisonLabel;
    const buildTrend = (current: number, previous: number) =>
      this.buildDashboardTrend(current, previous, dateRange);

    return {
      meta: {
        datePreset: dateRange.datePreset,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        comparisonStartDate: dateRange.comparisonStartDate,
        comparisonEndDate: dateRange.comparisonEndDate,
        comparisonPeriod: dateRange.comparisonPeriod,
        timezone: LAB_DASHBOARD_TIMEZONE,
        generatedAt: now.toISOString(),
        comparisonLabel,
      },
      summary: {
        totalTests: currentMetrics.totalTests,
        newRequests: currentMetrics.newRequests,
        inProgressTests: currentMetrics.inProgressTests,
        completedTests: currentMetrics.completedTests,
        pendingReports: currentMetrics.pendingReports,
        totalRevenue: currentMetrics.totalRevenue,
        samplesCollected: currentMetrics.samplesCollected,
        testsPerformed: currentMetrics.testsPerformed,
        reportsGenerated: currentMetrics.reportsGenerated,
        criticalAlerts: currentMetrics.criticalAlerts,
        todayTests,
        todayRevenue,
        monthlyRevenue,
        turnaroundTime: currentMetrics.turnaroundTime,
        reportAccuracy: currentMetrics.reportAccuracy,
        sampleRejectionRate: currentMetrics.sampleRejectionRate,
        pendingTests: countWorkflowStatus(
          LAB_APPOINTMENT_PENDING_WORKFLOW_STATUS
        ),
        onHoldTests: countWorkflowStatus(
          LAB_APPOINTMENT_PENDING_WORKFLOW_STATUS
        ),
        urgentOrHoldTests: countWorkflowStatus(
          LAB_APPOINTMENT_PENDING_WORKFLOW_STATUS
        ),
        readyForReport: currentMetrics.pendingReports,
        rejectedTests: countWorkflowStatus(
          APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED
        ),
        pendingPayments: rows.filter((row) =>
          this.isPaymentPending(row.paymentStatus)
        ).length,
        paidTests: paidRows.length,
      },
      requestReview,
      kpiTrends: {
        totalTests: buildTrend(
          currentMetrics.totalTests,
          previousMetrics.totalTests
        ),
        newRequests: buildTrend(
          currentMetrics.newRequests,
          previousMetrics.newRequests
        ),
        inProgressTests: buildTrend(
          currentMetrics.inProgressTests,
          previousMetrics.inProgressTests
        ),
        completedTests: buildTrend(
          currentMetrics.completedTests,
          previousMetrics.completedTests
        ),
        pendingReports: buildTrend(
          currentMetrics.pendingReports,
          previousMetrics.pendingReports
        ),
        totalRevenue: buildTrend(
          currentMetrics.totalRevenue,
          previousMetrics.totalRevenue
        ),
      },
      statusBreakdown,
      revenueOverview: {
        totalRevenue: currentMetrics.totalRevenue,
        collectionCharges: 0,
        testCharges: currentMetrics.totalRevenue,
        otherCharges: 0,
        points: revenueOverviewPoints,
      },
      dailyTrend,
      weeklyTrend,
      monthlyTrend,
      topRequestedTests,
      recentActivity,
      recentTestRequests,
      pendingReports,
      upcomingSampleCollections,
      criticalAlerts,
      labInsights: {
        turnaroundTime: buildTrend(
          currentMetrics.turnaroundTime,
          previousMetrics.turnaroundTime
        ),
        reportAccuracy: buildTrend(
          currentMetrics.reportAccuracy,
          previousMetrics.reportAccuracy
        ),
        sampleRejectionRate: buildTrend(
          currentMetrics.sampleRejectionRate,
          previousMetrics.sampleRejectionRate
        ),
        reportsGenerated: buildTrend(
          currentMetrics.reportsGenerated,
          previousMetrics.reportsGenerated
        ),
      },
      slaAlerts: {
        overdueSamples: overdueSampleRows.length,
        overdueReports: overdueReportRows.length,
        pendingPaymentOlderThan24h: pendingPaymentRows.length,
      },
      paymentBreakdown,
      sampleWorkflowFunnel,
      topReferringDoctors,
      catalogGaps,
    };
  }

  private static buildTestIdentifierPrefix(
    testName: string | null | undefined
  ) {
    const normalizedName = (testName ?? 'test').trim().toUpperCase();
    const words = normalizedName.match(/[A-Z]+/g) ?? [];
    const letters = normalizedName.replace(/[^A-Z]/g, '');

    if (words.length >= 3) {
      return words
        .slice(0, 3)
        .map((word) => word[0])
        .join('');
    }

    if (words.length === 2) {
      return `${words[0].slice(0, 2)}${words[1][0]}`;
    }

    return letters.slice(0, 3) || 'TST';
  }

  private static buildSampleScanValue(
    barcodeValue: string | null | undefined,
    testIdentifier: string | null | undefined
  ) {
    if (!barcodeValue) {
      return null;
    }

    const prefix = this.buildTestIdentifierPrefix(testIdentifier);

    return barcodeValue.replace(/^SMP-/, `${prefix}-`);
  }

  private static getLegacySampleBarcodeValue(scanValue: string) {
    const match = scanValue.match(/^[A-Z]{1,3}-(\d{8})-(\d{6})$/);

    if (!match || scanValue.startsWith('SMP-')) {
      return null;
    }

    return `SMP-${match[1]}-${match[2]}`;
  }

  private static async generateUniqueTestId(
    trx: DbTransaction,
    testName: string | null | undefined
  ) {
    const prefix = this.buildTestIdentifierPrefix(testName);
    const [sequenceRow] = (await trx.execute(sql`
      SELECT nextval('appointment_test_unique_id_seq') AS value
    `)) as { value: string | number }[];

    return `${prefix}_${sequenceRow.value}`;
  }

  private static isCompactUniqueTestId(value: string | null | undefined) {
    return /^[A-Z]{1,3}_\d{3,}$/.test(value ?? '');
  }

  private static buildBarcodePayload(
    sample: { barcodeValue: string; barcodeType: string } | null,
    scanValue?: string | null
  ) {
    if (!sample?.barcodeValue) {
      return null;
    }

    const value = scanValue ?? sample.barcodeValue;

    return {
      format: sample.barcodeType,
      value,
      lookupPath: `/api/v1/lab/barcodes/${encodeURIComponent(value)}/lookup`,
      printDataPath: `/api/v1/lab/barcodes/${encodeURIComponent(
        value
      )}/print-data`,
      legacyLookupPath: `/api/v1/lab/appointment-tests/barcode/${encodeURIComponent(
        value
      )}`,
    };
  }

  private static async generateSampleBarcodeValue(
    trx: DbTransaction,
    testIdentifier: string | null | undefined,
    now = new Date()
  ) {
    const prefix = this.buildTestIdentifierPrefix(testIdentifier);
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
    const [sequenceRow] = (await trx.execute(sql`
      SELECT nextval('lab_sample_barcode_seq') AS value
    `)) as { value: string | number }[];
    const sequenceValue = String(sequenceRow.value).padStart(6, '0');

    return `${prefix}-${datePart}-${sequenceValue}`;
  }

  private static async getLabSampleForAppointmentTest(
    trx: DbTransaction,
    appointmentTestId: string
  ) {
    const [sample] = await trx
      .select()
      .from(LabSamplesModel)
      .where(eq(LabSamplesModel.appointmentTestId, appointmentTestId))
      .limit(1);

    return sample ?? null;
  }

  private static async findLabSampleByBarcodeValue(
    barcodeValue: string,
    clinicId: string
  ) {
    const [sample] = await database
      .select()
      .from(LabSamplesModel)
      .where(
        and(
          eq(LabSamplesModel.barcodeValue, barcodeValue),
          eq(LabSamplesModel.clinicId, clinicId)
        )
      )
      .limit(1);

    return sample ?? null;
  }

  private static async getStoredSampleScanValue(
    sample: { appointmentTestId: string; barcodeValue: string },
    context: { clinicId: string; labId: string }
  ) {
    const [record] = await database
      .select({
        testName: TestCatalogModel.name,
        labTestCode: LabTestCatalogModel.testCode,
      })
      .from(LabOrderModel)
      .innerJoin(
        TestCatalogModel,
        eq(LabOrderModel.testId, TestCatalogModel.id)
      )
      .leftJoin(
        LabTestCatalogModel,
        and(
          eq(LabTestCatalogModel.labId, context.labId),
          or(
            eq(LabTestCatalogModel.id, TestCatalogModel.labTestId),
            eq(LabTestCatalogModel.name, TestCatalogModel.name),
            eq(LabTestCatalogModel.testCode, TestCatalogModel.name)
          ),
          eq(LabTestCatalogModel.status, 'active'),
          isNull(LabTestCatalogModel.deletedAt)
        )
      )
      .where(
        and(
          eq(LabOrderModel.id, sample.appointmentTestId),
          eq(LabOrderModel.clinicId, context.clinicId)
        )
      )
      .limit(1);

    return this.buildSampleScanValue(
      sample.barcodeValue,
      record?.labTestCode ?? record?.testName
    );
  }

  private static async ensureUniqueTestId(
    trx: DbTransaction,
    appointmentTest: {
      id: string;
      uniqueTestId: string | null;
      workflowStatus: string;
    },
    testName: string | null | undefined,
    clinicId: string
  ) {
    if (this.isCompactUniqueTestId(appointmentTest.uniqueTestId)) {
      return appointmentTest.uniqueTestId;
    }

    if (
      appointmentTest.workflowStatus ===
      APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED
    ) {
      return appointmentTest.uniqueTestId;
    }

    const uniqueTestId = await this.generateUniqueTestId(trx, testName);
    const uniqueTestIdCondition = appointmentTest.uniqueTestId
      ? eq(LabOrderModel.uniqueTestId, appointmentTest.uniqueTestId)
      : isNull(LabOrderModel.uniqueTestId);

    const [updated] = await trx
      .update(LabOrderModel)
      .set({ uniqueTestId })
      .where(
        and(
          eq(LabOrderModel.id, appointmentTest.id),
          eq(LabOrderModel.clinicId, clinicId),
          uniqueTestIdCondition
        )
      )
      .returning({ uniqueTestId: LabOrderModel.uniqueTestId });

    if (updated?.uniqueTestId) {
      return updated.uniqueTestId;
    }

    const [current] = await trx
      .select({ uniqueTestId: LabOrderModel.uniqueTestId })
      .from(LabOrderModel)
      .where(
        and(
          eq(LabOrderModel.id, appointmentTest.id),
          eq(LabOrderModel.clinicId, clinicId)
        )
      )
      .limit(1);

    return current?.uniqueTestId ?? null;
  }

  private static async ensureLabSample(
    trx: DbTransaction,
    record: {
      appointmentTest: {
        id: string;
        clinicId: string | null;
        patientId: string | null;
        testId: string;
        labAssistantId: string | null;
        workflowStatus: string;
        sampleStatus: string | null;
        sampleCollectedAt: Date | null;
        sampleReceivedAt: Date | null;
        processingStartedAt: Date | null;
        testingStartedAt: Date | null;
        qualityCheckedAt: Date | null;
        readyForReportAt: Date | null;
      };
      testName: string | null;
      category: string | null;
      labTestCode?: string | null;
      labSampleType?: string | null;
    },
    context: { clinicId: string; labId: string; userId: string },
    now = new Date()
  ) {
    const existing = await this.getLabSampleForAppointmentTest(
      trx,
      record.appointmentTest.id
    );

    if (existing) {
      if (existing.labId !== context.labId) {
        throw new HttpError(403, 'You are not allowed to access this barcode');
      }

      return existing;
    }

    if (
      record.appointmentTest.workflowStatus ===
      APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED
    ) {
      return null;
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const barcodeValue = await this.generateSampleBarcodeValue(
        trx,
        record.labTestCode ?? record.testName,
        now
      );
      const [inserted] = await trx
        .insert(LabSamplesModel)
        .values({
          clinicId: context.clinicId,
          labId: context.labId,
          labOrderId: record.appointmentTest.id,
          appointmentTestId: record.appointmentTest.id,
          patientId: record.appointmentTest.patientId,
          testId: record.appointmentTest.testId,
          sampleType: record.labSampleType ?? record.category,
          barcodeValue,
          barcodeType: 'CODE128',
          status: (record.appointmentTest.sampleStatus ??
            APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED) as LabSampleStatus,
          collectedBy: record.appointmentTest.sampleCollectedAt
            ? record.appointmentTest.labAssistantId
            : null,
          collectedAt: record.appointmentTest.sampleCollectedAt,
          receivedAtLabBy: record.appointmentTest.sampleReceivedAt
            ? record.appointmentTest.labAssistantId
            : null,
          receivedAtLabAt: record.appointmentTest.sampleReceivedAt,
          processingStartedAt: record.appointmentTest.processingStartedAt,
          testingStartedAt: record.appointmentTest.testingStartedAt,
          resultVerifiedAt: record.appointmentTest.qualityCheckedAt,
          reportReadyAt: record.appointmentTest.readyForReportAt,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();

      if (inserted) {
        return inserted;
      }

      const conflictSample = await this.getLabSampleForAppointmentTest(
        trx,
        record.appointmentTest.id
      );

      if (conflictSample) {
        if (conflictSample.labId !== context.labId) {
          throw new HttpError(
            403,
            'You are not allowed to access this barcode'
          );
        }

        return conflictSample;
      }
    }

    throw new HttpError(409, 'Unable to generate a unique sample barcode');
  }

  private static getSampleTimestampUpdate(
    action: AppointmentTestSampleAction,
    userId: string,
    now: Date
  ) {
    switch (action) {
      case APPOINTMENT_TEST_SAMPLE_ACTION.MARK_SAMPLE_COLLECTED:
        return { collectedAt: now, collectedBy: userId };
      case APPOINTMENT_TEST_SAMPLE_ACTION.MARK_SAMPLE_RECEIVED_AT_LAB:
        return { receivedAtLabAt: now, receivedAtLabBy: userId };
      case APPOINTMENT_TEST_SAMPLE_ACTION.START_SAMPLE_PROCESSING:
        return { processingStartedAt: now };
      case APPOINTMENT_TEST_SAMPLE_ACTION.START_TESTING:
        return { testingStartedAt: now };
      case APPOINTMENT_TEST_SAMPLE_ACTION.MARK_QUALITY_CHECK_DONE:
        return { resultVerifiedAt: now };
      case APPOINTMENT_TEST_SAMPLE_ACTION.MARK_COMPLETED:
        return { reportReadyAt: now };
      default:
        return {};
    }
  }

  private static getReportUploadPaymentStatus(
    paymentStatus: string | null | undefined
  ) {
    return this.isPaymentPaid(paymentStatus)
      ? APPOINTMENT_TEST_PAYMENT_STATUS.PAID
      : APPOINTMENT_TEST_PAYMENT_STATUS.PENDING;
  }

  private static getNextAction(sampleStatus: string | null | undefined) {
    switch (sampleStatus) {
      case APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_COLLECTION_PENDING:
        return {
          key: APPOINTMENT_TEST_SAMPLE_ACTION.MARK_SAMPLE_COLLECTED,
          label: 'Mark Sample Collected',
        };
      case APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_COLLECTED:
        return {
          key: APPOINTMENT_TEST_SAMPLE_ACTION.MARK_SAMPLE_RECEIVED_AT_LAB,
          label: 'Mark Received At Lab',
        };
      case APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_RECEIVED_AT_LAB:
        return {
          key: LAB_APPOINTMENT_SET_EXPECTED_REPORT_READY_ACTION,
          label: 'Set Expected Report Ready Time',
          requiredFields: ['expectedReportReadyAt'],
        };
      case APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_PROCESSING:
        return {
          key: APPOINTMENT_TEST_SAMPLE_ACTION.START_TESTING,
          label: 'Start Testing',
        };
      case APPOINTMENT_TEST_SAMPLE_STATUS.TESTING_IN_PROGRESS:
        return {
          key: APPOINTMENT_TEST_SAMPLE_ACTION.MARK_QUALITY_CHECK_DONE,
          label: 'Mark Result Verified',
        };
      case APPOINTMENT_TEST_SAMPLE_STATUS.QUALITY_CHECK:
        return {
          key: APPOINTMENT_TEST_SAMPLE_ACTION.MARK_COMPLETED,
          label: 'Mark Completed',
        };
      default:
        return null;
    }
  }

  private static buildTrackingSteps(appointmentTest: {
    paymentStatus: string;
    sampleStatus: string | null;
    paymentCollectedAt: Date | null;
    sampleCollectedAt: Date | null;
    sampleReceivedAt: Date | null;
    processingStartedAt: Date | null;
    testingStartedAt: Date | null;
    qualityCheckedAt: Date | null;
    expectedReportReadyAt: Date | null;
    readyForReportAt: Date | null;
  }) {
    const paymentPaid = this.isPaymentPaid(appointmentTest.paymentStatus);
    const sampleStatus =
      appointmentTest.sampleStatus ??
      APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED;

    // SAMPLE_COLLECTION_PENDING is an internal state (payment done, awaiting
    // collection) and is not a visible step; at that point only payment (index 0)
    // is complete and "Sample Collected" (index 1) is the current step.
    const completedIndex =
      sampleStatus === APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED ||
      sampleStatus === APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_COLLECTION_PENDING
        ? 0
        : Math.max(
            0,
            SAMPLE_STEP_ORDER.findIndex((step) => step.key === sampleStatus)
          );

    return SAMPLE_STEP_ORDER.map((step, index) => {
      let status: (typeof APPOINTMENT_TEST_STEP_STATUS)[keyof typeof APPOINTMENT_TEST_STEP_STATUS] =
        APPOINTMENT_TEST_STEP_STATUS.LOCKED;

      if (step.key === 'PAYMENT_COMPLETED') {
        status = paymentPaid
          ? APPOINTMENT_TEST_STEP_STATUS.COMPLETED
          : APPOINTMENT_TEST_STEP_STATUS.PENDING;
      } else if (!paymentPaid) {
        status = APPOINTMENT_TEST_STEP_STATUS.LOCKED;
      } else if (index <= completedIndex) {
        status = APPOINTMENT_TEST_STEP_STATUS.COMPLETED;
      } else if (index === completedIndex + 1) {
        status = APPOINTMENT_TEST_STEP_STATUS.PENDING;
      }

      return {
        key: step.key,
        title: step.title,
        description: step.description,
        status,
        timestamp: appointmentTest[step.timestampField],
        expectedReportReadyAt: step.expectedReportReadyField
          ? appointmentTest[step.expectedReportReadyField]
          : null,
      };
    });
  }

  private static getTrackingEventCreatedAt(
    appointmentTest: {
      onHoldAt: Date | null;
      rejectedAt: Date | null;
      paymentCollectedAt: Date | null;
      sampleCollectedAt: Date | null;
      sampleReceivedAt: Date | null;
      processingStartedAt: Date | null;
      testingStartedAt: Date | null;
      qualityCheckedAt: Date | null;
      readyForReportAt: Date | null;
    },
    eventType: string,
    fallback: Date
  ) {
    switch (eventType) {
      case APPOINTMENT_TEST_TRACKING_EVENT.ON_HOLD:
        return appointmentTest.onHoldAt ?? fallback;
      case APPOINTMENT_TEST_TRACKING_EVENT.REJECTED:
        return appointmentTest.rejectedAt ?? fallback;
      case APPOINTMENT_TEST_TRACKING_EVENT.PAYMENT_MARKED_PAID:
      case APPOINTMENT_TEST_TRACKING_EVENT.SAMPLE_COLLECTION_PENDING:
        return appointmentTest.paymentCollectedAt ?? fallback;
      case APPOINTMENT_TEST_TRACKING_EVENT.SAMPLE_COLLECTED:
        return appointmentTest.sampleCollectedAt ?? fallback;
      case APPOINTMENT_TEST_TRACKING_EVENT.SAMPLE_RECEIVED_AT_LAB:
        return appointmentTest.sampleReceivedAt ?? fallback;
      case APPOINTMENT_TEST_TRACKING_EVENT.SAMPLE_PROCESSING:
        return appointmentTest.processingStartedAt ?? fallback;
      case APPOINTMENT_TEST_TRACKING_EVENT.TESTING_IN_PROGRESS:
        return appointmentTest.testingStartedAt ?? fallback;
      case APPOINTMENT_TEST_TRACKING_EVENT.QUALITY_CHECK_DONE:
        return appointmentTest.qualityCheckedAt ?? fallback;
      case APPOINTMENT_TEST_TRACKING_EVENT.COMPLETED:
        return appointmentTest.readyForReportAt ?? fallback;
      default:
        return fallback;
    }
  }

  private static async verifyLabAccess(
    trx: DbTransaction,
    clinicId: string,
    labId: string,
    userId: string
  ) {
    const [user] = await trx
      .select({ userType: UserModel.userType })
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);

    if (
      user?.userType === 'Admin' ||
      user?.userType === 'Super_Admin' ||
      user?.userType === 'Receptionist'
    ) {
      const [lab] = await trx
        .select({ id: LabsModel.id })
        .from(LabsModel)
        .where(
          and(
            eq(LabsModel.id, labId),
            eq(LabsModel.clinicId, clinicId),
            isNull(LabsModel.deletedAt)
          )
        )
        .limit(1);

      if (lab) {
        return user?.userType ?? null;
      }
    }

    const [assignment] = await trx
      .select({ id: UserLabAssignmentsModel.id })
      .from(UserLabAssignmentsModel)
      .where(
        and(
          eq(UserLabAssignmentsModel.userId, userId),
          eq(UserLabAssignmentsModel.labId, labId),
          eq(UserLabAssignmentsModel.clinicId, clinicId)
        )
      )
      .limit(1);

    if (!assignment) {
      throw new HttpError(403, 'Lab assistant is not allowed for this lab');
    }

    return user?.userType ?? null;
  }

  private static async getScopedAppointmentTest(
    trx: DbTransaction,
    appointmentTestId: string,
    clinicId: string,
    labId: string,
    userId: string
  ) {
    const performerUserType = await this.verifyLabAccess(
      trx,
      clinicId,
      labId,
      userId
    );

    const patientUser = alias(UserModel, 'patient_user');
    const patientProfile = alias(UserProfileModel, 'patient_profile');
    const doctorUser = alias(UserModel, 'doctor_user');

    const [record] = await trx
      .select({
        appointmentTest: LabOrderModel,
        appointmentId: LabOrderModel.appointmentId,
        appointmentDate: sql<Date>`coalesce(${AppointmentModel.appointmentDate}, ${LabOrderModel.createdAt})`,
        appointmentTime: AppointmentModel.appointmentTime,
        patientId: patientUser.id,
        patientName: sql<
          string | null
        >`coalesce(${patientUser.name}, ${IndependentPatientModel.name})`,
        patientEmail: patientUser.email,
        patientMobile: sql<
          string | null
        >`coalesce(${patientUser.mobile}, ${IndependentPatientModel.mobile})`,
        patientAge: sql<
          number | null
        >`coalesce(${patientProfile.age}, ${IndependentPatientModel.age})`,
        patientDob: patientProfile.dob,
        patientGender: sql<
          string | null
        >`coalesce(${patientProfile.gender}, ${IndependentPatientModel.gender})`,
        doctorName: sql<
          string | null
        >`coalesce(${doctorUser.name}, ${IndependentPatientModel.doctorName})`,
        testName: TestCatalogModel.name,
        category: TestCatalogModel.category,
        testPrice: TestCatalogModel.price,
        labTestCode: LabTestCatalogModel.testCode,
        labTestPrice: LabTestCatalogModel.price,
        labSampleType: LabTestCatalogModel.sampleType,
        labId: LabsModel.id,
        labName: LabsModel.name,
        labAddress: LabsModel.address,
        labContactNumber: LabsModel.contactNo,
      })
      .from(LabOrderModel)
      .leftJoin(
        AppointmentModel,
        eq(LabOrderModel.appointmentId, AppointmentModel.id)
      )
      .innerJoin(
        TestCatalogModel,
        eq(LabOrderModel.testId, TestCatalogModel.id)
      )
      .leftJoin(
        LabTestCatalogModel,
        and(
          eq(LabTestCatalogModel.clinicId, clinicId),
          eq(LabTestCatalogModel.labId, labId),
          or(
            eq(LabTestCatalogModel.id, TestCatalogModel.labTestId),
            eq(LabTestCatalogModel.name, TestCatalogModel.name),
            eq(LabTestCatalogModel.testCode, TestCatalogModel.name)
          ),
          eq(LabTestCatalogModel.status, 'active'),
          isNull(LabTestCatalogModel.deletedAt)
        )
      )
      .leftJoin(patientUser, eq(LabOrderModel.patientId, patientUser.id))
      .leftJoin(patientProfile, eq(patientProfile.userId, patientUser.id))
      .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
      .leftJoin(
        IndependentPatientModel,
        eq(LabOrderModel.independentPatientId, IndependentPatientModel.id)
      )
      .leftJoin(
        LabsModel,
        and(
          eq(LabsModel.id, labId),
          eq(LabsModel.clinicId, clinicId),
          isNull(LabsModel.deletedAt)
        )
      )
      .where(
        and(
          eq(LabOrderModel.id, appointmentTestId),
          eq(LabOrderModel.clinicId, clinicId)
        )
      )
      .limit(1);

    if (!record) {
      throw new HttpError(404, 'Appointment test not found');
    }

    // Once a test is claimed by an assistant (status changed -> labAssistantId set),
    // it is private to the lab(s) that assistant belongs to. Unclaimed tests stay
    // visible clinic-wide. The check is scoped to this labId so an assistant who
    // belongs to multiple labs is handled correctly.
    if (record.appointmentTest.labAssistantId) {
      const [assistantInLab] = await trx
        .select({ id: UserLabAssignmentsModel.id })
        .from(UserLabAssignmentsModel)
        .where(
          and(
            eq(
              UserLabAssignmentsModel.userId,
              record.appointmentTest.labAssistantId
            ),
            eq(UserLabAssignmentsModel.labId, labId),
            eq(UserLabAssignmentsModel.clinicId, clinicId)
          )
        )
        .limit(1);

      if (!assistantInLab) {
        const [assignedUser] = await trx
          .select({ userType: UserModel.userType })
          .from(UserModel)
          .where(eq(UserModel.id, record.appointmentTest.labAssistantId))
          .limit(1);

        if (
          assignedUser?.userType === 'Admin' ||
          assignedUser?.userType === 'Super_Admin' ||
          assignedUser?.userType === 'Receptionist'
        ) {
          return { ...record, performerUserType };
        }

        throw new HttpError(403, 'Appointment test is assigned to another lab');
      }
    }

    return { ...record, performerUserType };
  }

  private static async createLabInvoiceForPaidAppointmentTest(
    trx: DbTransaction,
    record: {
      appointmentTest: typeof LabOrderModel.$inferSelect;
    },
    payload: {
      amount: number;
      paymentMethod: LabAppointmentPaymentMethod;
    },
    context: { clinicId: string; labId: string; userId: string },
    now = new Date()
  ) {
    const existingInvoice =
      await this.getFormattedLabInvoiceByAppointmentTestId(
        trx,
        record.appointmentTest.id,
        context
      );

    if (existingInvoice) {
      return existingInvoice;
    }

    const paidAmount = this.getValidPaidAmount(payload.amount);
    const paidAmountText = this.toMoney(paidAmount);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const invoiceNumber = await this.generateLabInvoiceNumber(trx, now);
      const [invoice] = await trx
        .insert(LabInvoiceModel)
        .values({
          invoiceNumber,
          appointmentTestId: record.appointmentTest.id,
          clinicId: context.clinicId,
          labId: context.labId,
          patientId: record.appointmentTest.patientId,
          doctorId: record.appointmentTest.doctorId,
          createdBy: context.userId,
          testId: record.appointmentTest.testId,
          paymentMethod: payload.paymentMethod,
          totalAmount: paidAmountText,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();

      if (!invoice) {
        const conflictInvoice =
          await this.getFormattedLabInvoiceByAppointmentTestId(
            trx,
            record.appointmentTest.id,
            context
          );

        if (conflictInvoice) {
          return conflictInvoice;
        }

        continue;
      }

      const formattedInvoice = await this.getFormattedLabInvoiceById(
        trx,
        invoice.id,
        context
      );

      if (formattedInvoice) {
        // Fire-and-forget receipt to the patient. Queued, so it never holds
        // this transaction open on a network call.
        void LabNotificationService.sendPaymentReceived({
          patientId: record.appointmentTest.patientId,
          clinicId: context.clinicId,
          labId: context.labId,
          testId: record.appointmentTest.testId,
          amount: paidAmountText,
          invoiceNumber: invoice.invoiceNumber,
        });

        return formattedInvoice;
      }
    }

    throw new HttpError(409, 'Unable to create lab invoice');
  }

  private static async createTrackingEvent(
    trx: DbTransaction,
    payload: {
      clinicId: string;
      labId: string;
      appointmentTestId: string;
      eventType: AppointmentTestTrackingEvent;
      title: string;
      description?: string | null;
      actorUserId?: string;
      metadata?: Record<string, unknown> | null;
      createdAt?: Date;
    }
  ) {
    await trx.insert(LabOrderTrackingEventModel).values({
      clinicId: payload.clinicId,
      labId: payload.labId,
      appointmentTestId: payload.appointmentTestId,
      eventType: payload.eventType,
      title: payload.title,
      description: payload.description ?? null,
      actorUserId: payload.actorUserId,
      metadata: payload.metadata ?? null,
      createdAt: payload.createdAt ?? new Date(),
    });
  }

  //     // final patient ID
  //     const finalPatientId = patientId ?? appointmentExists.patientId;

  //     const previousAppointmentState = latestHistory?.previousState
  //       ? latestHistory.previousState
  //       : appointmentExists;

  //     if (performerUserId && clinicId) {
  //       const performer = await getUserById(performerUserId);

  //       if (!performer) {
  //         logger.warn('❌ Performer not found');
  //         return;
  //       }

  //       await notifyTestAssignedToLab(
  //         entry.id,
  //         clinicId, // ✅ only clinicId needed
  //         performer.id,
  //         performer.name,
  //         performer.userType,
  //         testExists.name
  //       );
  //     }

  //   const appointmentExists = appointmentResult[0];
  //   const testExists = testResult[0];

  //   const finalPatientId = patientId ?? appointmentExists.patientId;

  //     return newEntry;
  //   });

  //   return entry;
  // }

  static async addTestsToAppointment(
    appointmentId: string,
    testIds: string[],
    patientId: string,
    doctorId: string,
    reportPdf?: string | null,
    performerUserId?: string,
    clinicId?: string
  ) {
    // Fetch appointment once
    const [appointment] = await database
      .select()
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);

    if (!appointment) {
      throw new HttpError(404, 'Appointment not found');
    }

    // Fetch all tests in one query
    const tests = await database
      .select()
      .from(TestCatalogModel)
      .where(inArray(TestCatalogModel.id, testIds));

    if (tests.length !== testIds.length) {
      const foundIds = tests.map((t) => t.id);
      const missingIds = testIds.filter((id) => !foundIds.includes(id));
      throw new HttpError(404, `Tests not found: ${missingIds.join(', ')}`);
    }

    const existingTests = await database
      .select({ testId: LabOrderModel.testId })
      .from(LabOrderModel)
      .where(
        and(
          eq(LabOrderModel.appointmentId, appointmentId),
          inArray(LabOrderModel.testId, testIds)
        )
      );

    if (existingTests.length > 0) {
      throw new HttpError(400, `Tests already added to this appointment`);
    }

    // Create a map for quick test lookup
    const testMap = new Map(tests.map((t) => [t.id, t]));

    // Process all in a single transaction
    const entries = await database.transaction(async (trx) => {
      const insertedEntries = [];

      for (const testId of testIds) {
        const test = testMap.get(testId)!;

        // Insert each test assignment
        const [newEntry] = await trx
          .insert(LabOrderModel)
          .values({
            appointmentId,
            testId,
            patientId,
            doctorId,
            clinicId,
            reportPdf, // Same PDF for all tests (optional)
            price: test.price || 0,
            reportStatus: 'Initiated',
            paymentStatus: APPOINTMENT_TEST_PAYMENT_STATUS.PENDING,
            workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED,
            sampleStatus: APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED,
          })
          .returning();

        // Log activity for each test
        await AppointmentActivityHistoryService.logActivity({
          appointmentId,
          action: 'TEST_PRESCRIBED',
          performedBy: performerUserId,
          previousState: appointment,
          newState: appointment,
          remarks: `${test.name} (${test.category}) prescribed`,
          tx: trx,
        });

        insertedEntries.push(newEntry);
      }

      // Optional: Log a bulk activity
      if (testIds.length > 1) {
        await AppointmentActivityHistoryService.logActivity({
          appointmentId,
          action: 'TEST_PRESCRIBED',
          performedBy: performerUserId,
          previousState: appointment,
          newState: appointment,
          remarks: `${testIds.length} tests prescribed`,
          tx: trx,
        });
      }

      return insertedEntries;
    });

    // A new order on the encounter screen is exactly what the ordering
    // doctor needs to see without a refresh — no lab is assigned yet at this
    // point, so only the encounter half fires (see signalLabChange).
    signalLabChange(
      { clinicId: appointment.clinicId, appointmentId, doctorId },
      'lab.test_prescribed'
    );

    // Fire notifications (fire-and-forget)
    if (performerUserId && clinicId) {
      for (const entry of entries) {
        const test = testMap.get(entry.testId)!;
        this.sendTestAssignedNotification(
          entry.id,
          clinicId,
          performerUserId,
          test.name
        ).catch((error) => {
          logger.error('Failed to send lab notification:', error);
        });
      }
    }

    return entries;
  }

  private static async getOrCreatePatientTestFromLabCatalog(
    trx: DbTransaction,
    labTest: typeof LabTestCatalogModel.$inferSelect,
    clinicId: string,
    now = new Date()
  ) {
    const [existingByLabTestId] = await trx
      .select()
      .from(TestCatalogModel)
      .where(
        and(
          eq(TestCatalogModel.clinicId, clinicId),
          eq(TestCatalogModel.labTestId, labTest.id),
          eq(TestCatalogModel.isDeleted, false)
        )
      )
      .limit(1);

    if (existingByLabTestId) {
      return existingByLabTestId;
    }

    const [existingTest] = await trx
      .select()
      .from(TestCatalogModel)
      .where(
        and(
          eq(TestCatalogModel.clinicId, clinicId),
          eq(TestCatalogModel.name, labTest.name),
          eq(TestCatalogModel.isDeleted, false)
        )
      )
      .limit(1);

    if (existingTest) {
      if (!existingTest.labTestId) {
        const [linkedTest] = await trx
          .update(TestCatalogModel)
          .set({ labTestId: labTest.id, updatedAt: now })
          .where(eq(TestCatalogModel.id, existingTest.id))
          .returning();
        return linkedTest ?? existingTest;
      }
      return existingTest;
    }

    const [createdTest] = await trx
      .insert(TestCatalogModel)
      .values({
        name: labTest.name,
        category: labTest.category,
        clinicId: clinicId,
        labTestId: labTest.id,
        price: labTest.price,
        status: 'active',
        isDeleted: false,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();

    if (createdTest) {
      return createdTest;
    }

    const [conflictTest] = await trx
      .select()
      .from(TestCatalogModel)
      .where(
        and(
          eq(TestCatalogModel.clinicId, clinicId),
          eq(TestCatalogModel.name, labTest.name),
          eq(TestCatalogModel.isDeleted, false)
        )
      )
      .limit(1);

    if (conflictTest) {
      return conflictTest;
    }

    throw new HttpError(409, `Unable to prepare test: ${labTest.name}`);
  }

  private static async resolveIndependentTests(
    trx: DbTransaction,
    testIds: string[],
    context: { clinicId: string; labId: string },
    now = new Date()
  ): Promise<IndependentResolvedTest[]> {
    const directPatientTests = await trx
      .select()
      .from(TestCatalogModel)
      .where(
        and(
          inArray(TestCatalogModel.id, testIds),
          eq(TestCatalogModel.isDeleted, false),
          or(
            eq(TestCatalogModel.clinicId, context.clinicId),
            isNull(TestCatalogModel.clinicId)
          )
        )
      );

    const resolvedByInputId = new Map<string, IndependentResolvedTest>();

    for (const patientTest of directPatientTests) {
      resolvedByInputId.set(patientTest.id, {
        inputTestId: patientTest.id,
        patientTest,
        displayName: patientTest.name,
        price: patientTest.price,
      });
    }

    const unresolvedIds = testIds.filter((id) => !resolvedByInputId.has(id));

    if (unresolvedIds.length > 0) {
      const labCatalogTests = await trx
        .select()
        .from(LabTestCatalogModel)
        .where(
          and(
            inArray(LabTestCatalogModel.id, unresolvedIds),
            eq(LabTestCatalogModel.labId, context.labId),
            eq(LabTestCatalogModel.status, 'active'),
            isNull(LabTestCatalogModel.deletedAt),
            or(
              eq(LabTestCatalogModel.clinicId, context.clinicId),
              isNull(LabTestCatalogModel.clinicId)
            )
          )
        );

      for (const labTest of labCatalogTests) {
        const patientTest = await this.getOrCreatePatientTestFromLabCatalog(
          trx,
          labTest,
          context.clinicId,
          now
        );

        resolvedByInputId.set(labTest.id, {
          inputTestId: labTest.id,
          patientTest,
          displayName: labTest.name,
          price: labTest.price ?? patientTest.price,
        });
      }
    }

    const missingIds = testIds.filter((id) => !resolvedByInputId.has(id));

    if (missingIds.length > 0) {
      throw new HttpError(404, `Tests not found: ${missingIds.join(', ')}`);
    }

    return testIds.map((id) => resolvedByInputId.get(id)!);
  }

  static async addIndependentTests(payload: AddIndependentTestsPayload) {
    const uniqueTestIds = Array.from(new Set(payload.testIds));

    if (uniqueTestIds.length !== payload.testIds.length) {
      throw new HttpError(400, 'Duplicate test IDs are not allowed');
    }

    const entries = await database.transaction(async (trx) => {
      const performerUserType = await this.verifyLabAccess(
        trx,
        payload.clinicId,
        payload.labId,
        payload.performerUserId
      );
      // Only stamp labAssistantId when the creator is an actual lab assistant
      // (tracked in UserLabAssignmentsModel). Admin/Receptionist walk-in
      // creators aren't lab staff, so leave the test unclaimed rather than
      // misattributing it to them, which would hide it from every real lab
      // assistant's "Active Tests" view.
      const creatorLabAssistantId =
        performerUserType === 'Lab_Assistant' ? payload.performerUserId : null;

      const now = new Date();
      const resolvedTests = await this.resolveIndependentTests(
        trx,
        uniqueTestIds,
        {
          clinicId: payload.clinicId,
          labId: payload.labId,
        },
        now
      );

      const [independentPatient] = await trx
        .insert(IndependentPatientModel)
        .values({
          name: payload.patientName,
          mobile: payload.patientMobile,
          age: payload.patientAge,
          gender: payload.patientGender,
          doctorName: payload.doctorName,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      const createdEntries: (typeof LabOrderModel.$inferSelect)[] = [];

      // Walk-in tests are staff-initiated: the lab assistant already picked
      // these from our own verified catalog, so there is no external
      // request to vet. Skip straight to ON_HOLD (the same state Accept
      // produces) instead of INITIATED, so no Accept/Reject step is needed
      // and the test lands directly in Active Tests.
      for (const resolvedTest of resolvedTests) {
        const test = resolvedTest.patientTest;
        const uniqueTestId = await this.generateUniqueTestId(
          trx,
          resolvedTest.displayName
        );
        const [newEntry] = await trx
          .insert(LabOrderModel)
          .values({
            appointmentId: null,
            patientId: null,
            doctorId: null,
            testId: test.id,
            isIndependent: true,
            independentPatientId: independentPatient.id,
            labAssistantId: creatorLabAssistantId,
            clinicId: payload.clinicId,
            price: resolvedTest.price ?? test.price ?? 0,
            reportStatus: 'Initiated',
            uniqueTestId,
            paymentStatus: APPOINTMENT_TEST_PAYMENT_STATUS.PENDING,
            workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD,
            sampleStatus: APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED,
            onHoldAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        await this.ensureLabSample(
          trx,
          {
            appointmentTest: {
              id: newEntry.id,
              clinicId: newEntry.clinicId,
              patientId: newEntry.patientId,
              testId: newEntry.testId,
              labAssistantId: newEntry.labAssistantId,
              workflowStatus: newEntry.workflowStatus,
              sampleStatus: newEntry.sampleStatus,
              sampleCollectedAt: null,
              sampleReceivedAt: null,
              processingStartedAt: null,
              testingStartedAt: null,
              qualityCheckedAt: null,
              readyForReportAt: null,
            },
            testName: resolvedTest.displayName,
            category: test.category,
          },
          {
            clinicId: payload.clinicId,
            labId: payload.labId,
            userId: payload.performerUserId,
          },
          now
        );

        await this.createTrackingEvent(trx, {
          clinicId: payload.clinicId,
          labId: payload.labId,
          appointmentTestId: newEntry.id,
          eventType: APPOINTMENT_TEST_TRACKING_EVENT.ON_HOLD,
          title: 'Independent lab test created',
          description: 'Walk-in test, auto-accepted at creation',
          actorUserId: payload.performerUserId,
          metadata: {
            independentPatientId: independentPatient.id,
            requestedTestId: resolvedTest.inputTestId,
            testId: test.id,
            testName: resolvedTest.displayName,
            autoAccepted: true,
          },
          createdAt: now,
        });

        createdEntries.push(newEntry);
      }

      return createdEntries;
    });

    // Independent tests are assigned to a lab immediately (no ordering
    // appointment/doctor exists for these — see signalLabChange).
    signalLabChange(
      { clinicId: payload.clinicId, labId: payload.labId },
      'lab.test_created'
    );

    return entries;
  }

  // Separate method for notification
  private static async sendTestAssignedNotification(
    entryId: string,
    clinicId: string,
    performerUserId: string,
    testName: string
  ) {
    try {
      const performer = await getUserById(performerUserId);

      if (!performer) {
        logger.warn('❌ Performer not found');
        return;
      }

      await notifyTestAssignedToLab(
        entryId,
        clinicId,
        performer.id,
        performer.name,
        performer.userType,
        testName
      );
    } catch (error) {
      logger.error('Error sending test assigned notification:', error);
    }
  }

  static async getLabAppointmentTests(
    clinicId: string,
    labId: string,
    userId: string,
    query: LabAppointmentTestsQuery
  ) {
    return await database.transaction(async (trx) => {
      await this.verifyLabAccess(trx, clinicId, labId, userId);

      const [lab] = await trx
        .select({
          id: LabsModel.id,
          name: LabsModel.name,
          address: LabsModel.address,
          contactNo: LabsModel.contactNo,
          email: LabsModel.email,
          logo: LabsModel.logo,
          labStatus: LabsModel.labStatus,
        })
        .from(LabsModel)
        .where(
          and(
            eq(LabsModel.id, labId),
            eq(LabsModel.clinicId, clinicId),
            isNull(LabsModel.deletedAt)
          )
        )
        .limit(1);

      if (!lab) {
        throw new HttpError(404, 'Lab not found');
      }

      const labCatalogRows: LabDashboardCatalogRow[] = await trx
        .select({
          id: LabTestCatalogModel.id,
          name: LabTestCatalogModel.name,
          testCode: LabTestCatalogModel.testCode,
          category: LabTestCatalogModel.category,
          price: LabTestCatalogModel.price,
          sampleType: LabTestCatalogModel.sampleType,
        })
        .from(LabTestCatalogModel)
        .where(
          and(
            eq(LabTestCatalogModel.labId, labId),
            eq(LabTestCatalogModel.status, 'active'),
            isNull(LabTestCatalogModel.deletedAt)
          )
        );

      // Doctor-ordered tests that match this lab's own verified catalog
      // don't need a human to vet them - same reasoning as the walk-in path
      // (see addIndependentTests): auto-accept them straight to ON_HOLD so
      // they land in Active Tests without a manual Accept/Reject click.
      await this.autoAcceptEligibleAppointmentTests(
        trx,
        { clinicId, labId, userId },
        labCatalogRows
      );

      const patientUser = alias(UserModel, 'patient_user');
      const patientProfile = alias(UserProfileModel, 'patient_profile');
      const doctorUser = alias(UserModel, 'doctor_user');
      const doctorProfessional = alias(
        UserProfessionalModel,
        'doctor_professional'
      );
      const patientNameExpression = sql<
        string | null
      >`coalesce(${patientUser.name}, ${IndependentPatientModel.name})`;
      const patientMobileExpression = sql<
        string | null
      >`coalesce(${patientUser.mobile}, ${IndependentPatientModel.mobile})`;
      const patientAgeExpression = sql<
        number | null
      >`coalesce(${patientProfile.age}, ${IndependentPatientModel.age})`;
      const patientGenderExpression = sql<
        string | null
      >`coalesce(${patientProfile.gender}, ${IndependentPatientModel.gender})`;
      const doctorNameExpression = sql<
        string | null
      >`coalesce(${doctorUser.name}, ${IndependentPatientModel.doctorName})`;
      const dateTimeExpression = sql<Date>`coalesce(${AppointmentModel.appointmentDate}, ${LabOrderModel.createdAt})`;
      const requestedPage = Number(query.page ?? query.pageNumber) || 1;
      const pageNumber = Math.max(requestedPage, 1);
      const pageSize = Math.min(
        Math.max(
          Number(query.limit ?? query.pageSize) ||
            LAB_APPOINTMENT_TESTS_DEFAULT_PAGE_SIZE,
          1
        ),
        LAB_APPOINTMENT_TESTS_MAX_PAGE_SIZE
      );
      const offset = (pageNumber - 1) * pageSize;
      const tab = query.tab ?? 'all';
      const groupByPatient = query.groupBy === 'patient';
      const includeDashboard = query.includeDashboard ?? true;
      const dateRange = this.getLabDashboardDateRange(query);
      const dateCondition = this.getLabDashboardDateCondition(dateRange);
      const [currentUser] = await trx
        .select({ userType: UserModel.userType })
        .from(UserModel)
        .where(eq(UserModel.id, userId))
        .limit(1);
      const isClinicLabAdmin =
        currentUser?.userType === 'Admin' ||
        currentUser?.userType === 'Super_Admin';
      // Receptionists have full front-desk visibility over lab test data
      // (gated separately via requirePermission(LAB_TEST_VIEW)), so they
      // should see the same lab-wide records an Admin sees rather than being
      // scoped to tests claimed under their own user id.
      const hasLabWideVisibility =
        isClinicLabAdmin || currentUser?.userType === 'Receptionist';

      // Get all assistant IDs for this lab to show shared active tests
      const assistants = await trx
        .select({ userId: UserLabAssignmentsModel.userId })
        .from(UserLabAssignmentsModel)
        .where(
          and(
            eq(UserLabAssignmentsModel.labId, labId),
            eq(UserLabAssignmentsModel.clinicId, clinicId)
          )
        );
      const assistantIds = assistants.map((a) => a.userId);
      const targetAssistantIds = Array.from(
        new Set(
          hasLabWideVisibility
            ? [...assistantIds, userId]
            : assistantIds.length > 0
              ? assistantIds
              : [userId]
        )
      );

      const baseConditions: SQL[] = [eq(LabOrderModel.clinicId, clinicId)];

      // A test that has been claimed by an assistant (labAssistantId set, e.g.
      // moved to ON_HOLD) is private to that assistant's lab. Unclaimed tests
      // remain visible clinic-wide. Admins and receptionists bypass this
      // scoping entirely since they need full lab-wide visibility.
      if (!hasLabWideVisibility) {
        baseConditions.push(
          or(
            isNull(LabOrderModel.labAssistantId),
            inArray(LabOrderModel.labAssistantId, targetAssistantIds)
          ) as SQL
        );
      }

      if (query.search?.trim()) {
        const pattern = `%${query.search.trim().toLowerCase()}%`;
        baseConditions.push(
          or(
            sql`lower(coalesce(${patientUser.name}, ${IndependentPatientModel.name}, '')) LIKE ${pattern}`,
            sql`lower(coalesce(${patientUser.mobile}, ${IndependentPatientModel.mobile}, '')) LIKE ${pattern}`,
            sql`lower(coalesce(${doctorUser.name}, ${IndependentPatientModel.doctorName}, '')) LIKE ${pattern}`,
            sql`lower(${TestCatalogModel.name}) LIKE ${pattern}`,
            sql`lower(${TestCatalogModel.category}) LIKE ${pattern}`,
            sql`lower(${LabOrderModel.uniqueTestId}) LIKE ${pattern}`,
            sql`lower(${LabSamplesModel.barcodeValue}) LIKE ${pattern}`
          ) as SQL
        );
      }

      if (query.category?.trim()) {
        baseConditions.push(
          eq(TestCatalogModel.category, query.category.trim())
        );
      }

      if (query.patientId) {
        baseConditions.push(eq(LabOrderModel.patientId, query.patientId));
      }

      if (query.independentPatientId) {
        baseConditions.push(
          eq(LabOrderModel.independentPatientId, query.independentPatientId)
        );
      }

      const listConditions = [...baseConditions];

      if (query.status) {
        listConditions.push(
          eq(
            LabOrderModel.workflowStatus,
            this.getWorkflowStatusFilter(query.status)
          )
        );
      } else if (tab === 'all') {
        listConditions.push(
          inArray(LabOrderModel.workflowStatus, ALL_TAB_WORKFLOW_STATUSES)
        );
      } else if (tab === 'new') {
        listConditions.push(
          inArray(
            LabOrderModel.workflowStatus,
            REQUEST_REVIEW_TAB_WORKFLOW_STATUSES
          )
        );
      } else if (tab === 'assigned') {
        listConditions.push(
          inArray(LabOrderModel.workflowStatus, ASSIGNED_TAB_WORKFLOW_STATUSES)
        );
        if (!hasLabWideVisibility) {
          // Unclaimed tests (e.g. a walk-in auto-accepted at creation, never
          // picked up by a specific assistant) stay visible to every assistant
          // of this lab, same as the base scoping already does for other tabs.
          listConditions.push(
            or(
              isNull(LabOrderModel.labAssistantId),
              inArray(LabOrderModel.labAssistantId, targetAssistantIds)
            ) as SQL
          );
        }
      } else if (tab === 'my') {
        listConditions.push(
          inArray(LabOrderModel.labAssistantId, targetAssistantIds)
        );
      }

      if (dateCondition) {
        listConditions.push(dateCondition);
      }

      const dashboardConditions = [...baseConditions];

      if (query.status) {
        dashboardConditions.push(
          eq(
            LabOrderModel.workflowStatus,
            this.getWorkflowStatusFilter(query.status)
          )
        );
      } else if (tab === 'all') {
        dashboardConditions.push(
          inArray(LabOrderModel.workflowStatus, ALL_TAB_WORKFLOW_STATUSES)
        );
      } else if (tab === 'new') {
        dashboardConditions.push(
          eq(
            LabOrderModel.workflowStatus,
            APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED
          )
        );
      } else if (tab === 'assigned') {
        dashboardConditions.push(
          inArray(LabOrderModel.workflowStatus, ASSIGNED_TAB_WORKFLOW_STATUSES)
        );
        if (!hasLabWideVisibility) {
          dashboardConditions.push(
            or(
              isNull(LabOrderModel.labAssistantId),
              inArray(LabOrderModel.labAssistantId, targetAssistantIds)
            ) as SQL
          );
        }
      } else if (tab === 'my') {
        dashboardConditions.push(
          inArray(LabOrderModel.labAssistantId, targetAssistantIds)
        );
      }

      const dashboardComparisonConditions = [...dashboardConditions];

      if (dateCondition) {
        dashboardConditions.push(dateCondition);
      }

      const dashboardComparisonDateCondition =
        this.getLabDashboardDateCondition({
          start: dateRange.comparisonStart,
          end: dateRange.comparisonEnd,
        });

      if (dashboardComparisonDateCondition) {
        dashboardComparisonConditions.push(dashboardComparisonDateCondition);
      }

      const dashboardRejectedConditions: SQL[] = [
        ...baseConditions,
        eq(
          LabOrderModel.workflowStatus,
          APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED
        ),
      ];

      if (dateCondition) {
        dashboardRejectedConditions.push(dateCondition);
      }

      const whereCondition = and(...listConditions);
      const dashboardWhereCondition = and(...dashboardConditions);
      const dashboardComparisonWhereCondition = dashboardComparisonDateCondition
        ? and(...dashboardComparisonConditions)
        : null;
      const dashboardRejectedWhereCondition = and(
        ...dashboardRejectedConditions
      );

      let countRow: { count: number } | undefined;
      let rows: LabAppointmentTestListRow[] = [];
      let patientGroups: LabAppointmentPatientGroup[] = [];
      let groupedTotalRecords = 0;

      if (groupByPatient) {
        const [patientCountRow] = await trx
          .select({
            count: sql<number>`count(distinct coalesce(${LabOrderModel.patientId}, ${LabOrderModel.independentPatientId}))`,
          })
          .from(LabOrderModel)
          .leftJoin(
            AppointmentModel,
            eq(LabOrderModel.appointmentId, AppointmentModel.id)
          )
          .innerJoin(
            TestCatalogModel,
            eq(LabOrderModel.testId, TestCatalogModel.id)
          )
          .leftJoin(
            LabSamplesModel,
            eq(LabSamplesModel.appointmentTestId, LabOrderModel.id)
          )
          .leftJoin(patientUser, eq(LabOrderModel.patientId, patientUser.id))
          .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
          .leftJoin(
            IndependentPatientModel,
            eq(LabOrderModel.independentPatientId, IndependentPatientModel.id)
          )
          .where(whereCondition);

        groupedTotalRecords = Number(patientCountRow?.count ?? 0);

        const patientPageRows = await trx
          .select({
            patientId: LabOrderModel.patientId,
            independentPatientId: LabOrderModel.independentPatientId,
            latestDateTime: sql<Date>`max(${dateTimeExpression})`,
          })
          .from(LabOrderModel)
          .leftJoin(
            AppointmentModel,
            eq(LabOrderModel.appointmentId, AppointmentModel.id)
          )
          .innerJoin(
            TestCatalogModel,
            eq(LabOrderModel.testId, TestCatalogModel.id)
          )
          .leftJoin(
            LabSamplesModel,
            eq(LabSamplesModel.appointmentTestId, LabOrderModel.id)
          )
          .leftJoin(patientUser, eq(LabOrderModel.patientId, patientUser.id))
          .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
          .leftJoin(
            IndependentPatientModel,
            eq(LabOrderModel.independentPatientId, IndependentPatientModel.id)
          )
          .where(whereCondition)
          .groupBy(LabOrderModel.patientId, LabOrderModel.independentPatientId)
          .orderBy(desc(sql`max(${dateTimeExpression})`))
          .limit(pageSize)
          .offset(offset);

        const pagePatientIds = patientPageRows
          .map((row) => row.patientId)
          .filter((id): id is string => Boolean(id));
        const pageIndependentPatientIds = patientPageRows
          .map((row) => row.independentPatientId)
          .filter((id): id is string => Boolean(id));

        const groupMemberFilters: SQL[] = [];
        if (pagePatientIds.length > 0) {
          groupMemberFilters.push(
            inArray(LabOrderModel.patientId, pagePatientIds)
          );
        }
        if (pageIndependentPatientIds.length > 0) {
          groupMemberFilters.push(
            inArray(
              LabOrderModel.independentPatientId,
              pageIndependentPatientIds
            )
          );
        }

        const groupMemberRows =
          groupMemberFilters.length > 0
            ? await trx
                .select({
                  patientId: LabOrderModel.patientId,
                  independentPatientId: LabOrderModel.independentPatientId,
                  isIndependent: LabOrderModel.isIndependent,
                  patientName: patientNameExpression,
                  patientMobile: patientMobileExpression,
                  patientAge: patientAgeExpression,
                  patientGender: patientGenderExpression,
                  doctorName: doctorNameExpression,
                  workflowStatus: LabOrderModel.workflowStatus,
                  dateTime: dateTimeExpression,
                })
                .from(LabOrderModel)
                .leftJoin(
                  AppointmentModel,
                  eq(LabOrderModel.appointmentId, AppointmentModel.id)
                )
                .innerJoin(
                  TestCatalogModel,
                  eq(LabOrderModel.testId, TestCatalogModel.id)
                )
                .leftJoin(
                  LabSamplesModel,
                  eq(LabSamplesModel.appointmentTestId, LabOrderModel.id)
                )
                .leftJoin(
                  patientUser,
                  eq(LabOrderModel.patientId, patientUser.id)
                )
                .leftJoin(
                  patientProfile,
                  eq(patientProfile.userId, patientUser.id)
                )
                .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
                .leftJoin(
                  IndependentPatientModel,
                  eq(
                    LabOrderModel.independentPatientId,
                    IndependentPatientModel.id
                  )
                )
                .where(and(whereCondition, or(...groupMemberFilters)))
            : [];

        const groupKeyOf = (
          patientId: string | null,
          independentPatientId: string | null
        ) =>
          patientId
            ? `patient:${patientId}`
            : `independent:${independentPatientId}`;

        const memberRowsByGroupKey = new Map<string, typeof groupMemberRows>();
        for (const memberRow of groupMemberRows) {
          const key = groupKeyOf(
            memberRow.patientId,
            memberRow.independentPatientId
          );
          const list = memberRowsByGroupKey.get(key) ?? [];
          list.push(memberRow);
          memberRowsByGroupKey.set(key, list);
        }

        patientGroups = patientPageRows.map((patientRow) => {
          const key = groupKeyOf(
            patientRow.patientId,
            patientRow.independentPatientId
          );
          const memberRows = memberRowsByGroupKey.get(key) ?? [];
          const firstMemberRow = memberRows[0];

          const doctorNames = Array.from(
            new Set(
              memberRows
                .map((memberRow) => memberRow.doctorName)
                .filter((name): name is string => Boolean(name))
            )
          );

          const statusCounts: Record<string, number> = {};
          for (const memberRow of memberRows) {
            const status =
              this.getLabResponseWorkflowStatus(memberRow.workflowStatus) ??
              memberRow.workflowStatus;
            statusCounts[status] = (statusCounts[status] ?? 0) + 1;
          }

          return {
            patientKey: key,
            patientId: patientRow.patientId,
            independentPatientId: patientRow.independentPatientId,
            isIndependent:
              firstMemberRow?.isIndependent ??
              Boolean(patientRow.independentPatientId),
            patientName: firstMemberRow?.patientName ?? null,
            patientMobile: firstMemberRow?.patientMobile ?? null,
            patientAge: firstMemberRow?.patientAge ?? null,
            patientGender: firstMemberRow?.patientGender ?? null,
            doctorNames,
            testCount: memberRows.length,
            latestDateTime: patientRow.latestDateTime,
            statusCounts,
          };
        });
      } else {
        const [countRowResult] = await trx
          .select({ count: count() })
          .from(LabOrderModel)
          .leftJoin(
            AppointmentModel,
            eq(LabOrderModel.appointmentId, AppointmentModel.id)
          )
          .innerJoin(
            TestCatalogModel,
            eq(LabOrderModel.testId, TestCatalogModel.id)
          )
          .leftJoin(
            LabSamplesModel,
            eq(LabSamplesModel.appointmentTestId, LabOrderModel.id)
          )
          .leftJoin(patientUser, eq(LabOrderModel.patientId, patientUser.id))
          .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
          .leftJoin(
            IndependentPatientModel,
            eq(LabOrderModel.independentPatientId, IndependentPatientModel.id)
          )
          .where(whereCondition);
        countRow = countRowResult;

        rows = await trx
          .select({
            appointmentTestId: LabOrderModel.id,
            appointmentId: LabOrderModel.appointmentId,
            uniqueTestId: LabOrderModel.uniqueTestId,
            isIndependent: LabOrderModel.isIndependent,
            independentPatientId: LabOrderModel.independentPatientId,
            patientName: patientNameExpression,
            patientMobile: patientMobileExpression,
            patientAge: patientAgeExpression,
            patientGender: patientGenderExpression,
            doctorName: doctorNameExpression,
            testName: TestCatalogModel.name,
            category: TestCatalogModel.category,
            price: LabOrderModel.price,
            testPrice: TestCatalogModel.price,
            dateTime: dateTimeExpression,
            appointmentTime: AppointmentModel.appointmentTime,
            workflowStatus: LabOrderModel.workflowStatus,
            paymentStatus: LabOrderModel.paymentStatus,
            sampleStatus: LabOrderModel.sampleStatus,
            reportStatus: LabOrderModel.reportStatus,
            reportPdf: LabOrderModel.reportPdf,
            labAssistantId: LabOrderModel.labAssistantId,
            rejectedAt: LabOrderModel.rejectedAt,
            rejectionReason: LabOrderModel.rejectionReason,
            expectedReportReadyAt: LabOrderModel.expectedReportReadyAt,
            sampleId: LabSamplesModel.id,
            sampleBarcodeValue: LabSamplesModel.barcodeValue,
            sampleBarcodeType: LabSamplesModel.barcodeType,
            sampleType: LabSamplesModel.sampleType,
            createdAt: LabOrderModel.createdAt,
            updatedAt: LabOrderModel.updatedAt,
          })
          .from(LabOrderModel)
          .leftJoin(
            AppointmentModel,
            eq(LabOrderModel.appointmentId, AppointmentModel.id)
          )
          .innerJoin(
            TestCatalogModel,
            eq(LabOrderModel.testId, TestCatalogModel.id)
          )
          .leftJoin(
            LabSamplesModel,
            eq(LabSamplesModel.appointmentTestId, LabOrderModel.id)
          )
          .leftJoin(patientUser, eq(LabOrderModel.patientId, patientUser.id))
          .leftJoin(patientProfile, eq(patientProfile.userId, patientUser.id))
          .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
          .leftJoin(
            IndependentPatientModel,
            eq(LabOrderModel.independentPatientId, IndependentPatientModel.id)
          )
          .where(whereCondition)
          .orderBy(desc(LabOrderModel.updatedAt))
          .limit(pageSize)
          .offset(offset);
      }

      const dashboardSelection = {
        appointmentTestId: LabOrderModel.id,
        uniqueTestId: LabOrderModel.uniqueTestId,
        patientName: patientNameExpression,
        patientMobile: patientMobileExpression,
        patientAge: patientAgeExpression,
        patientGender: patientGenderExpression,
        doctorName: doctorNameExpression,
        doctorDepartment: doctorProfessional.speciality,
        testName: TestCatalogModel.name,
        category: TestCatalogModel.category,
        price: LabOrderModel.price,
        testPrice: TestCatalogModel.price,
        dateTime: dateTimeExpression,
        appointmentTime: AppointmentModel.appointmentTime,
        workflowStatus: LabOrderModel.workflowStatus,
        paymentStatus: LabOrderModel.paymentStatus,
        sampleStatus: LabOrderModel.sampleStatus,
        reportStatus: LabOrderModel.reportStatus,
        reportPdf: LabOrderModel.reportPdf,
        sampleType: LabSamplesModel.sampleType,
        labAssistantId: LabOrderModel.labAssistantId,
        rejectedAt: LabOrderModel.rejectedAt,
        rejectionReason: LabOrderModel.rejectionReason,
        onHoldAt: LabOrderModel.onHoldAt,
        paymentCollectedAt: LabOrderModel.paymentCollectedAt,
        expectedReportReadyAt: LabOrderModel.expectedReportReadyAt,
        readyForReportAt: LabOrderModel.readyForReportAt,
        createdAt: LabOrderModel.createdAt,
        updatedAt: LabOrderModel.updatedAt,
      };

      let dashboard: unknown = undefined;

      if (includeDashboard) {
        if (tab === 'new') {
          const dashboardConditions = [...baseConditions];
          dashboardConditions.push(
            inArray(
              LabOrderModel.workflowStatus,
              REQUEST_REVIEW_TAB_WORKFLOW_STATUSES
            )
          );

          if (dateCondition) {
            dashboardConditions.push(dateCondition);
          }

          const requestReviewRows = await trx
            .select(dashboardSelection)
            .from(LabOrderModel)
            .leftJoin(
              AppointmentModel,
              eq(LabOrderModel.appointmentId, AppointmentModel.id)
            )
            .innerJoin(
              TestCatalogModel,
              eq(LabOrderModel.testId, TestCatalogModel.id)
            )
            .leftJoin(
              LabSamplesModel,
              eq(LabSamplesModel.appointmentTestId, LabOrderModel.id)
            )
            .leftJoin(patientUser, eq(LabOrderModel.patientId, patientUser.id))
            .leftJoin(patientProfile, eq(patientProfile.userId, patientUser.id))
            .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
            .leftJoin(
              IndependentPatientModel,
              eq(LabOrderModel.independentPatientId, IndependentPatientModel.id)
            )
            .leftJoin(
              doctorProfessional,
              eq(LabOrderModel.doctorId, doctorProfessional.userId)
            )
            .where(and(...dashboardConditions));

          const totalRequests = requestReviewRows.length;
          const newRequests = requestReviewRows.filter(
            (row) =>
              row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED
          ).length;
          const acceptedRequests = requestReviewRows.filter(
            (row) =>
              row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD ||
              row.workflowStatus ===
                APPOINTMENT_TEST_WORKFLOW_STATUS.IN_PROGRESS ||
              row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED
          ).length;
          const rejectedRequestRows = requestReviewRows.filter(
            (row) =>
              row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED
          );
          const rejectedRequests = rejectedRequestRows.length;
          const labCatalogLookups = this.buildCatalogLookups(labCatalogRows);
          const recentRejectedRequests = this.buildRecentRejectedRequests(
            rejectedRequestRows,
            labCatalogLookups
          );

          const now = new Date();
          const todayRange = this.getIstDayRange(now);

          const acceptedToday = requestReviewRows.filter((row) => {
            const isAcceptedStatus =
              row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD ||
              row.workflowStatus ===
                APPOINTMENT_TEST_WORKFLOW_STATUS.IN_PROGRESS ||
              row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED;
            return (
              isAcceptedStatus &&
              row.onHoldAt &&
              this.isDateInRange(row.onHoldAt, todayRange.start, todayRange.end)
            );
          }).length;

          const todayRequests = requestReviewRows.filter((row) => {
            const isNew =
              row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED;
            const testDate = row.dateTime ?? row.createdAt;
            return (
              isNew &&
              this.isDateInRange(testDate, todayRange.start, todayRange.end)
            );
          }).length;

          const newRequestRows = requestReviewRows.filter(
            (row) =>
              row.workflowStatus === APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED
          );
          const requestActionSummaries = newRequestRows.map((row) =>
            this.getLabTestActionAvailability(row, labCatalogRows)
          );
          const acceptableRequests = requestActionSummaries.filter(
            (action) => action.canAccept
          ).length;
          const unavailableRequests = requestActionSummaries.filter(
            (action) => !action.isActiveLabTest
          ).length;

          const cards = [
            {
              key: 'totalRequests',
              label: 'Total Requests',
              value: totalRequests,
              valueType: 'number',
            },
            {
              key: 'newRequests',
              label: 'New Requests',
              value: newRequests,
              valueType: 'number',
            },
            {
              key: 'acceptedRequests',
              label: 'Accepted',
              value: acceptedRequests,
              valueType: 'number',
            },
            {
              key: 'rejectedRequests',
              label: 'Rejected Requests',
              value: rejectedRequests,
              valueType: 'number',
            },
          ];

          dashboard = {
            requestReview: {
              totalRequests,
              newRequests,
              acceptedRequests,
              acceptedToday,
              rejectedRequests,
              acceptableRequests,
              unavailableRequests,
              todayRequests,
              cards,
              recentRejectedRequests,
            },
          };
        } else {
          const dashboardRows: LabDashboardRow[] = await trx
            .select(dashboardSelection)
            .from(LabOrderModel)
            .leftJoin(
              AppointmentModel,
              eq(LabOrderModel.appointmentId, AppointmentModel.id)
            )
            .innerJoin(
              TestCatalogModel,
              eq(LabOrderModel.testId, TestCatalogModel.id)
            )
            .leftJoin(
              LabSamplesModel,
              eq(LabSamplesModel.appointmentTestId, LabOrderModel.id)
            )
            .leftJoin(patientUser, eq(LabOrderModel.patientId, patientUser.id))
            .leftJoin(patientProfile, eq(patientProfile.userId, patientUser.id))
            .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
            .leftJoin(
              IndependentPatientModel,
              eq(LabOrderModel.independentPatientId, IndependentPatientModel.id)
            )
            .leftJoin(
              doctorProfessional,
              eq(LabOrderModel.doctorId, doctorProfessional.userId)
            )
            .where(dashboardWhereCondition);

          const comparisonDashboardRows: LabDashboardRow[] =
            dashboardComparisonWhereCondition
              ? await trx
                  .select(dashboardSelection)
                  .from(LabOrderModel)
                  .leftJoin(
                    AppointmentModel,
                    eq(LabOrderModel.appointmentId, AppointmentModel.id)
                  )
                  .innerJoin(
                    TestCatalogModel,
                    eq(LabOrderModel.testId, TestCatalogModel.id)
                  )
                  .leftJoin(
                    LabSamplesModel,
                    eq(LabSamplesModel.appointmentTestId, LabOrderModel.id)
                  )
                  .leftJoin(
                    patientUser,
                    eq(LabOrderModel.patientId, patientUser.id)
                  )
                  .leftJoin(
                    patientProfile,
                    eq(patientProfile.userId, patientUser.id)
                  )
                  .leftJoin(
                    doctorUser,
                    eq(LabOrderModel.doctorId, doctorUser.id)
                  )
                  .leftJoin(
                    IndependentPatientModel,
                    eq(
                      LabOrderModel.independentPatientId,
                      IndependentPatientModel.id
                    )
                  )
                  .leftJoin(
                    doctorProfessional,
                    eq(LabOrderModel.doctorId, doctorProfessional.userId)
                  )
                  .where(dashboardComparisonWhereCondition)
              : [];

          const rejectedDashboardRows: LabDashboardRow[] = await trx
            .select(dashboardSelection)
            .from(LabOrderModel)
            .leftJoin(
              AppointmentModel,
              eq(LabOrderModel.appointmentId, AppointmentModel.id)
            )
            .innerJoin(
              TestCatalogModel,
              eq(LabOrderModel.testId, TestCatalogModel.id)
            )
            .leftJoin(
              LabSamplesModel,
              eq(LabSamplesModel.appointmentTestId, LabOrderModel.id)
            )
            .leftJoin(patientUser, eq(LabOrderModel.patientId, patientUser.id))
            .leftJoin(patientProfile, eq(patientProfile.userId, patientUser.id))
            .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
            .leftJoin(
              IndependentPatientModel,
              eq(LabOrderModel.independentPatientId, IndependentPatientModel.id)
            )
            .leftJoin(
              doctorProfessional,
              eq(LabOrderModel.doctorId, doctorProfessional.userId)
            )
            .where(dashboardRejectedWhereCondition);

          dashboard = this.buildLabAppointmentDashboard(
            dashboardRows,
            labCatalogRows,
            comparisonDashboardRows,
            {
              dateRange,
              trendPeriod: query.trendPeriod,
              rejectedRows: rejectedDashboardRows,
            }
          );
        }
      }

      const appointmentTestIds = rows.map((row) => row.appointmentTestId);

      const resultRows =
        appointmentTestIds.length > 0
          ? await trx
              .select({
                id: LabOrderResultsModel.id,
                appointmentTestId: LabOrderResultsModel.appointmentTestId,
              })
              .from(LabOrderResultsModel)
              .where(
                inArray(
                  LabOrderResultsModel.appointmentTestId,
                  appointmentTestIds
                )
              )
              .orderBy(
                desc(LabOrderResultsModel.updatedAt),
                desc(LabOrderResultsModel.createdAt)
              )
          : [];

      const latestResultIdByAppointmentTestId = new Map<string, string>();

      for (const resultRow of resultRows) {
        if (
          !latestResultIdByAppointmentTestId.has(resultRow.appointmentTestId)
        ) {
          latestResultIdByAppointmentTestId.set(
            resultRow.appointmentTestId,
            resultRow.id
          );
        }
      }

      if (groupByPatient) {
        const totalPages =
          groupedTotalRecords === 0
            ? 0
            : Math.ceil(groupedTotalRecords / pageSize);

        return {
          labName: lab.name,
          lab,
          data: patientGroups,
          pagination: {
            totalRecords: groupedTotalRecords,
            totalPages,
            currentPage: pageNumber,
            pageNumber,
            pageSize,
            limit: pageSize,
            hasNextPage: pageNumber < totalPages,
            hasPreviousPage: pageNumber > 1,
            nextPage: pageNumber < totalPages ? pageNumber + 1 : null,
            previousPage: pageNumber > 1 ? pageNumber - 1 : null,
          },
          dashboard,
        };
      }

      const labCatalogLookups = this.buildCatalogLookups(labCatalogRows);
      const totalRecords = Number(countRow?.count ?? 0);
      const totalPages =
        totalRecords === 0 ? 0 : Math.ceil(totalRecords / pageSize);
      const recordsOnPage = rows.length;
      const from = totalRecords === 0 ? 0 : offset + 1;
      const to = totalRecords === 0 ? 0 : offset + recordsOnPage;

      return {
        labName: lab.name,
        lab,
        tests: rows.map((row) => {
          const matchedCatalogTest = this.findBestLabCatalogMatch(
            row,
            labCatalogRows
          );
          const actionAvailability = this.getLabTestActionAvailability(
            row,
            labCatalogRows
          );
          const scanValue = this.buildSampleScanValue(
            row.sampleBarcodeValue,
            matchedCatalogTest?.testCode ?? row.testName
          );
          const latestResultId =
            latestResultIdByAppointmentTestId.get(row.appointmentTestId) ??
            null;
          const barcodeSample = row.sampleBarcodeValue
            ? {
                barcodeValue: row.sampleBarcodeValue,
                barcodeType: row.sampleBarcodeType ?? 'CODE128',
              }
            : null;

          return {
            appointmentTestId: row.appointmentTestId,
            appointmentId: row.appointmentId,
            resultId: latestResultId,
            labResultId: latestResultId,
            latestResultId,
            uniqueTestId: row.uniqueTestId,
            isIndependent: row.isIndependent,
            independentPatientId: row.independentPatientId,
            barcode: this.buildBarcodePayload(barcodeSample, scanValue),
            barcodeValue: row.sampleBarcodeValue,
            barcodeType: row.sampleBarcodeType,
            scanValue,
            sampleType: row.sampleType,
            patientName: row.patientName,
            patientMobile: row.patientMobile,
            patientAge: row.patientAge,
            patientGender: row.patientGender,
            patientPhone: row.patientMobile,
            patientNumber: row.patientMobile,
            doctorName: row.doctorName,
            testName: row.testName,
            category: row.category,
            price: this.getDashboardPrice(row, labCatalogLookups),
            dateTime: row.dateTime,
            appointmentTime: row.appointmentTime,
            workflowStatus: this.getLabResponseWorkflowStatus(
              row.workflowStatus
            ),
            paymentStatus: this.normalizePaymentStatus(row.paymentStatus),
            sampleStatus:
              row.sampleStatus ?? APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED,
            actions: {
              isActiveLabTest: actionAvailability.isActiveLabTest,
              canAccept: actionAvailability.canAccept,
              canReject: actionAvailability.canReject,
              status: actionAvailability.actionStatus,
              unavailableReason: actionAvailability.unavailableReason,
            },
            availability: {
              isActiveLabTest: actionAvailability.isActiveLabTest,
              matchedLabTest: actionAvailability.matchedLabTest,
              unavailableReason: actionAvailability.unavailableReason,
            },
            reportStatus: row.reportStatus,
            reportPdf: row.reportPdf,
            expectedReportReadyAt: row.expectedReportReadyAt,
            labAssistantId: row.labAssistantId,
            rejectedAt: row.rejectedAt,
            rejectionReason: row.rejectionReason,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          };
        }),
        pagination: {
          totalRecords,
          totalPages,
          currentPage: pageNumber,
          pageNumber,
          pageSize,
          limit: pageSize,
          offset,
          recordsOnPage,
          from,
          to,
          hasNextPage: pageNumber < totalPages,
          hasPreviousPage: pageNumber > 1,
          nextPage: pageNumber < totalPages ? pageNumber + 1 : null,
          previousPage: pageNumber > 1 ? pageNumber - 1 : null,
        },
        dashboard,
      };
    });
  }

  // Finds INITIATED requests that match this lab's own verified catalog and
  // moves them straight to ON_HOLD (the same state a manual Accept
  // produces), without waiting for a lab assistant to click Accept. Mirrors
  // addIndependentTests: there's nothing to "vet" once the request maps
  // cleanly onto a catalog entry the lab has already configured.
  private static async autoAcceptEligibleAppointmentTests(
    trx: DbTransaction,
    context: { clinicId: string; labId: string; userId: string },
    labCatalogRows: LabDashboardCatalogRow[]
  ) {
    if (labCatalogRows.length === 0) {
      return;
    }

    const candidates = await trx
      .select({
        id: LabOrderModel.id,
        testName: TestCatalogModel.name,
        category: TestCatalogModel.category,
      })
      .from(LabOrderModel)
      .innerJoin(
        TestCatalogModel,
        eq(LabOrderModel.testId, TestCatalogModel.id)
      )
      .where(
        and(
          eq(LabOrderModel.clinicId, context.clinicId),
          eq(
            LabOrderModel.workflowStatus,
            APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED
          )
        )
      );

    const eligibleIds = candidates
      .filter(
        (row) => this.findBestLabCatalogMatch(row, labCatalogRows) !== null
      )
      .map((row) => row.id);

    for (const appointmentTestId of eligibleIds) {
      await this.autoAcceptAppointmentTest(trx, appointmentTestId, context);
    }
  }

  private static async autoAcceptAppointmentTest(
    trx: DbTransaction,
    appointmentTestId: string,
    context: { clinicId: string; labId: string; userId: string }
  ) {
    const record = await this.getScopedAppointmentTest(
      trx,
      appointmentTestId,
      context.clinicId,
      context.labId,
      context.userId
    );

    if (
      record.appointmentTest.workflowStatus !==
      APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED
    ) {
      return;
    }

    const now = new Date();
    const uniqueTestId =
      record.appointmentTest.uniqueTestId ??
      (await this.generateUniqueTestId(trx, record.testName));

    // Left unclaimed (labAssistantId untouched) rather than attributed to
    // whichever user's request happened to trigger this - same as an
    // unclaimed walk-in test, it stays visible to every assistant of this
    // lab instead of being pinned to one person who never actually reviewed it.
    const [updated] = await trx
      .update(LabOrderModel)
      .set({
        uniqueTestId,
        workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD,
        paymentStatus: APPOINTMENT_TEST_PAYMENT_STATUS.PENDING,
        sampleStatus: APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED,
        onHoldAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(LabOrderModel.id, appointmentTestId),
          eq(LabOrderModel.clinicId, context.clinicId),
          eq(
            LabOrderModel.workflowStatus,
            APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED
          )
        )
      )
      .returning({
        workflowStatus: LabOrderModel.workflowStatus,
        sampleStatus: LabOrderModel.sampleStatus,
      });

    if (!updated) {
      // Already moved by a concurrent request - nothing left to do.
      return;
    }

    await this.ensureLabSample(
      trx,
      {
        ...record,
        appointmentTest: {
          ...record.appointmentTest,
          workflowStatus: updated.workflowStatus,
          sampleStatus: updated.sampleStatus,
        },
      },
      context,
      now
    );

    await this.createTrackingEvent(trx, {
      clinicId: context.clinicId,
      labId: context.labId,
      appointmentTestId,
      eventType: APPOINTMENT_TEST_TRACKING_EVENT.ON_HOLD,
      title: 'Test auto-accepted',
      description: 'Active lab test match found, no manual review needed',
      metadata: { autoAccepted: true },
      createdAt: now,
    });
  }

  static async markOnHold(
    appointmentTestId: string,
    payload: { reason?: string },
    context: { clinicId: string; labId: string; userId: string }
  ) {
    return await database.transaction(async (trx) => {
      const record = await this.getScopedAppointmentTest(
        trx,
        appointmentTestId,
        context.clinicId,
        context.labId,
        context.userId
      );

      if (
        record.appointmentTest.workflowStatus !==
        APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED
      ) {
        throw new HttpError(409, 'Only initiated tests can move to on hold');
      }

      const now = new Date();
      const uniqueTestId =
        record.appointmentTest.uniqueTestId ??
        (await this.generateUniqueTestId(trx, record.testName));
      const [updated] = await trx
        .update(LabOrderModel)
        .set({
          uniqueTestId,
          workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD,
          paymentStatus: APPOINTMENT_TEST_PAYMENT_STATUS.PENDING,
          sampleStatus: APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED,
          onHoldAt: now,
          labAssistantId: context.userId,
          updatedAt: now,
        })
        .where(
          and(
            eq(LabOrderModel.id, appointmentTestId),
            eq(LabOrderModel.clinicId, context.clinicId),
            eq(
              LabOrderModel.workflowStatus,
              APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED
            )
          )
        )
        .returning({
          id: LabOrderModel.id,
          uniqueTestId: LabOrderModel.uniqueTestId,
          workflowStatus: LabOrderModel.workflowStatus,
          paymentStatus: LabOrderModel.paymentStatus,
          sampleStatus: LabOrderModel.sampleStatus,
        });

      if (!updated) {
        throw new HttpError(409, 'Appointment test status already moved');
      }

      const sample = await this.ensureLabSample(
        trx,
        {
          ...record,
          appointmentTest: {
            ...record.appointmentTest,
            labAssistantId: context.userId,
            workflowStatus: updated.workflowStatus,
            sampleStatus: updated.sampleStatus,
          },
        },
        context,
        now
      );

      await this.createTrackingEvent(trx, {
        clinicId: context.clinicId,
        labId: context.labId,
        appointmentTestId,
        eventType: APPOINTMENT_TEST_TRACKING_EVENT.ON_HOLD,
        title: 'Test pending',
        description: payload.reason ?? null,
        actorUserId: context.userId,
        createdAt: now,
      });

      const scanValue = this.buildSampleScanValue(
        sample?.barcodeValue,
        record.labTestCode ?? record.testName
      );

      return {
        appointmentTestId: updated.id,
        uniqueTestId: updated.uniqueTestId,
        barcodeValue: sample?.barcodeValue ?? null,
        barcodeType: sample?.barcodeType ?? 'CODE128',
        scanValue,
        barcode: this.buildBarcodePayload(sample, scanValue),
        workflowStatus: this.getLabResponseWorkflowStatus(
          updated.workflowStatus
        ),
        paymentStatus: updated.paymentStatus,
        sampleStatus: updated.sampleStatus,
      };
    });
  }

  static async rejectAppointmentTest(
    appointmentTestId: string,
    payload: { reason?: string },
    context: { clinicId: string; labId: string; userId: string }
  ) {
    return await database.transaction(async (trx) => {
      const record = await this.getScopedAppointmentTest(
        trx,
        appointmentTestId,
        context.clinicId,
        context.labId,
        context.userId
      );

      const rejectableStatuses: AppointmentTestWorkflowStatus[] = [
        APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED,
        APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD,
      ];

      if (
        !rejectableStatuses.includes(
          record.appointmentTest.workflowStatus as AppointmentTestWorkflowStatus
        )
      ) {
        throw new HttpError(
          409,
          'Only initiated or on hold tests can be rejected'
        );
      }

      const now = new Date();
      const [updated] = await trx
        .update(LabOrderModel)
        .set({
          workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED,
          rejectedAt: now,
          rejectionReason: payload.reason ?? null,
          labAssistantId:
            record.appointmentTest.labAssistantId ?? context.userId,
          updatedAt: now,
        })
        .where(
          and(
            eq(LabOrderModel.id, appointmentTestId),
            eq(LabOrderModel.clinicId, context.clinicId),
            inArray(LabOrderModel.workflowStatus, [
              APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED,
              APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD,
            ])
          )
        )
        .returning({
          id: LabOrderModel.id,
          workflowStatus: LabOrderModel.workflowStatus,
          rejectionReason: LabOrderModel.rejectionReason,
        });

      if (!updated) {
        throw new HttpError(409, 'Appointment test status already moved');
      }

      await trx
        .update(LabSamplesModel)
        .set({
          status: APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED,
          updatedAt: now,
        })
        .where(eq(LabSamplesModel.appointmentTestId, appointmentTestId));

      await this.createTrackingEvent(trx, {
        clinicId: context.clinicId,
        labId: context.labId,
        appointmentTestId,
        eventType: APPOINTMENT_TEST_TRACKING_EVENT.REJECTED,
        title: 'Test rejected',
        description: payload.reason ?? null,
        actorUserId: context.userId,
        createdAt: now,
      });

      return {
        appointmentTestId: updated.id,
        workflowStatus: updated.workflowStatus,
        rejectionReason: updated.rejectionReason,
      };
    });
  }

  static async getSampleTrackingDetail(
    appointmentTestId: string,
    context: { clinicId: string; labId: string; userId: string }
  ) {
    return await database.transaction(async (trx) => {
      const record = await this.getScopedAppointmentTest(
        trx,
        appointmentTestId,
        context.clinicId,
        context.labId,
        context.userId
      );

      const actorUser = alias(UserModel, 'actor_user');

      const events = await trx
        .select({
          id: LabOrderTrackingEventModel.id,
          eventType: LabOrderTrackingEventModel.eventType,
          title: LabOrderTrackingEventModel.title,
          description: LabOrderTrackingEventModel.description,
          actorUserId: LabOrderTrackingEventModel.actorUserId,
          actorUserName: actorUser.name,
          metadata: LabOrderTrackingEventModel.metadata,
          createdAt: LabOrderTrackingEventModel.createdAt,
        })
        .from(LabOrderTrackingEventModel)
        .leftJoin(
          actorUser,
          eq(LabOrderTrackingEventModel.actorUserId, actorUser.id)
        )
        .where(
          and(
            eq(LabOrderTrackingEventModel.appointmentTestId, appointmentTestId),
            eq(LabOrderTrackingEventModel.clinicId, context.clinicId),
            eq(LabOrderTrackingEventModel.labId, context.labId)
          )
        )
        .orderBy(LabOrderTrackingEventModel.createdAt);

      const appointmentTest = record.appointmentTest;
      const uniqueTestId = await this.ensureUniqueTestId(
        trx,
        appointmentTest,
        record.testName,
        context.clinicId
      );
      const sample = await this.ensureLabSample(trx, record, context);
      const scanValue = this.buildSampleScanValue(
        sample?.barcodeValue,
        record.labTestCode ?? record.testName
      );
      const barcode = this.buildBarcodePayload(sample, scanValue);
      const paymentPaid = this.isPaymentPaid(appointmentTest.paymentStatus);
      const timelineEvents = events.map((event) => ({
        ...event,
        title:
          event.eventType === APPOINTMENT_TEST_TRACKING_EVENT.ON_HOLD
            ? 'Test pending'
            : event.title,
        createdAt: this.getTrackingEventCreatedAt(
          appointmentTest,
          event.eventType,
          event.createdAt
        ),
      }));
      const paymentDetails = this.getLatestPaymentDetails(events);

      return {
        appointmentTest: {
          id: appointmentTest.id,
          uniqueTestId,
          barcodeValue: sample?.barcodeValue ?? null,
          barcodeType: sample?.barcodeType ?? 'CODE128',
          scanValue,
          barcode,
          patientName: record.patientName,
          doctorName: record.doctorName,
          testName: record.testName,
          category: record.category,
          price:
            record.labTestPrice ??
            appointmentTest.price ??
            record.testPrice ??
            0,
          dateTime: record.appointmentDate,
          appointmentTime: record.appointmentTime,
          workflowStatus: this.getLabResponseWorkflowStatus(
            appointmentTest.workflowStatus
          ),
          paymentStatus: this.normalizePaymentStatus(
            appointmentTest.paymentStatus
          ),
          sampleStatus:
            appointmentTest.sampleStatus ??
            APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED,
          reportStatus: appointmentTest.reportStatus,
          expectedReportReadyAt: appointmentTest.expectedReportReadyAt,
          readyForReportAt: appointmentTest.readyForReportAt,
        },
        patient:
          record.patientName || record.patientMobile
            ? {
                id: record.patientId ?? null,
                name: record.patientName,
                age: record.patientAge,
                dob: record.patientDob,
                gender: record.patientGender,
                mobile: record.patientMobile,
                email: record.patientEmail,
              }
            : null,
        lab: record.labId
          ? {
              id: record.labId,
              name: record.labName,
              address: record.labAddress,
              contactNumber: record.labContactNumber,
            }
          : null,
        sample: sample
          ? {
              id: sample.id,
              labId: sample.labId,
              labOrderId: sample.labOrderId,
              appointmentTestId: sample.appointmentTestId,
              patientId: sample.patientId,
              testId: sample.testId,
              sampleType: sample.sampleType,
              barcodeValue: sample.barcodeValue,
              barcodeType: sample.barcodeType,
              scanValue,
              status: sample.status,
              collectedBy: sample.collectedBy,
              collectedAt: sample.collectedAt,
              receivedAtLabBy: sample.receivedAtLabBy,
              receivedAtLabAt: sample.receivedAtLabAt,
              processingStartedAt: sample.processingStartedAt,
              testingStartedAt: sample.testingStartedAt,
              resultVerifiedAt: sample.resultVerifiedAt,
              reportReadyAt: sample.reportReadyAt,
            }
          : null,
        barcodeValue: sample?.barcodeValue ?? null,
        barcodeType: sample?.barcodeType ?? 'CODE128',
        scanValue,
        barcode,
        labOrder: {
          id: appointmentTest.id,
          appointmentTestId: appointmentTest.id,
        },
        payment: {
          status: this.normalizePaymentStatus(appointmentTest.paymentStatus),
          amount:
            record.labTestPrice ??
            appointmentTest.price ??
            record.testPrice ??
            0,
          collectedAmount: paymentDetails.amount,
          paymentMethod: paymentDetails.paymentMethod,
          transactionId: paymentDetails.transactionId,
          collectedAt: appointmentTest.paymentCollectedAt,
          collectedBy: appointmentTest.paymentCollectedBy,
        },
        reportSchedule: {
          expectedReportReadyAt: appointmentTest.expectedReportReadyAt,
          readyForReportAt: appointmentTest.readyForReportAt,
          canEditExpectedReportReadyAt: this.canEditExpectedReportReadyAt(
            appointmentTest.sampleStatus
          ),
        },
        steps: this.buildTrackingSteps({
          paymentStatus: appointmentTest.paymentStatus,
          sampleStatus: appointmentTest.sampleStatus,
          paymentCollectedAt: appointmentTest.paymentCollectedAt,
          sampleCollectedAt: appointmentTest.sampleCollectedAt,
          sampleReceivedAt: appointmentTest.sampleReceivedAt,
          processingStartedAt: appointmentTest.processingStartedAt,
          testingStartedAt: appointmentTest.testingStartedAt,
          qualityCheckedAt: appointmentTest.qualityCheckedAt,
          expectedReportReadyAt: appointmentTest.expectedReportReadyAt,
          readyForReportAt: appointmentTest.readyForReportAt,
        }),
        events: timelineEvents,
        nextAction: paymentPaid
          ? this.getNextAction(appointmentTest.sampleStatus)
          : {
              key: 'MARK_PAYMENT_PAID',
              label: 'Mark as Paid',
              paymentMethods: LAB_APPOINTMENT_PAYMENT_METHODS,
            },
      };
    });
  }

  static async getSampleTrackingDetailByBarcode(
    barcodeValue: string,
    context: { clinicId: string; labId: string; userId: string }
  ) {
    const sample = await this.getLabSampleByBarcodeValue(barcodeValue, context);

    return this.getSampleTrackingDetail(sample.appointmentTestId, context);
  }

  private static async getLabSampleByBarcodeValue(
    barcodeValue: string,
    context: { clinicId: string; labId: string; userId: string }
  ) {
    const sample = await this.findLabSampleByBarcodeValue(
      barcodeValue,
      context.clinicId
    );

    if (sample) {
      if (sample.labId !== context.labId) {
        throw new HttpError(403, 'You are not allowed to access this barcode');
      }

      return sample;
    }

    const legacyBarcodeValue = this.getLegacySampleBarcodeValue(barcodeValue);
    const legacySample = legacyBarcodeValue
      ? await this.findLabSampleByBarcodeValue(
          legacyBarcodeValue,
          context.clinicId
        )
      : null;

    if (legacySample) {
      if (legacySample.labId !== context.labId) {
        throw new HttpError(403, 'You are not allowed to access this barcode');
      }

      const expectedScanValue = await this.getStoredSampleScanValue(
        legacySample,
        context
      );

      if (expectedScanValue === barcodeValue) {
        return legacySample;
      }
    }

    throw new HttpError(404, 'Barcode not found');
  }

  static async getAppointmentTestBarcode(
    appointmentTestId: string,
    context: { clinicId: string; labId: string; userId: string }
  ) {
    return await database.transaction(async (trx) => {
      const record = await this.getScopedAppointmentTest(
        trx,
        appointmentTestId,
        context.clinicId,
        context.labId,
        context.userId
      );

      const sample = await this.ensureLabSample(trx, record, context);

      if (!sample) {
        throw new HttpError(
          400,
          'Move test to on hold before generating barcode'
        );
      }

      const scanValue = this.buildSampleScanValue(
        sample.barcodeValue,
        record.labTestCode ?? record.testName
      );

      return {
        barcodeValue: sample.barcodeValue,
        barcodeType: sample.barcodeType,
        scanValue,
        barcode: this.buildBarcodePayload(sample, scanValue),
        labOrderId: sample.labOrderId,
        appointmentTestId: sample.appointmentTestId,
        patientId: sample.patientId,
        testName: record.testName,
        sampleType: sample.sampleType,
        workflowStatus: this.getLabResponseWorkflowStatus(
          record.appointmentTest.workflowStatus
        ),
        sampleStatus: record.appointmentTest.sampleStatus,
      };
    });
  }

  static async getBarcodeLookup(
    barcodeValue: string,
    context: { clinicId: string; labId: string; userId: string }
  ) {
    const detail = await this.getSampleTrackingDetailByBarcode(
      barcodeValue,
      context
    );
    const appointmentTest = detail.appointmentTest;

    return {
      ...detail,
      patient: {
        id: detail.sample?.patientId ?? null,
        name: appointmentTest.patientName,
      },
      doctor: {
        name: appointmentTest.doctorName,
      },
      test: {
        id: detail.sample?.testId ?? null,
        name: appointmentTest.testName,
        category: appointmentTest.category,
        price: appointmentTest.price,
        sampleType: detail.sample?.sampleType ?? null,
      },
      appointmentTest,
      paymentStatus: appointmentTest.paymentStatus,
      sampleStatus: appointmentTest.sampleStatus,
      workflowStatus: appointmentTest.workflowStatus,
      resultStatus: appointmentTest.reportStatus,
      reportStatus: appointmentTest.reportStatus,
      timeline: detail.events,
    };
  }

  static async getBarcodePrintData(
    barcodeValue: string,
    context: { clinicId: string; labId: string; userId: string }
  ) {
    const detail = await this.getSampleTrackingDetailByBarcode(
      barcodeValue,
      context
    );
    const [lab] = await database
      .select({ labName: LabsModel.name })
      .from(LabsModel)
      .where(eq(LabsModel.id, context.labId))
      .limit(1);

    return {
      barcodeValue: detail.barcodeValue,
      barcodeType: detail.barcodeType,
      scanValue: detail.scanValue,
      patientName: detail.appointmentTest.patientName,
      patientId: detail.sample?.patientId ?? null,
      testName: detail.appointmentTest.testName,
      sampleType: detail.sample?.sampleType ?? null,
      labName: lab?.labName ?? null,
      collectedAt: detail.sample?.collectedAt ?? null,
      labOrderId: detail.sample?.labOrderId ?? detail.appointmentTest.id,
      appointmentTestId:
        detail.sample?.appointmentTestId ?? detail.appointmentTest.id,
    };
  }

  static async updateSampleStatusByBarcode(
    barcodeValue: string,
    payload: BarcodeActionPayload,
    context: { clinicId: string; labId: string; userId: string }
  ) {
    const sample = await this.getLabSampleByBarcodeValue(barcodeValue, context);

    if (payload.action === 'MARK_PAYMENT_PAID') {
      if (payload.amount === undefined) {
        throw new HttpError(400, 'Payment amount is required');
      }

      if (!payload.paymentMethod) {
        throw new HttpError(400, 'Payment method is required');
      }

      return this.markPaymentPaid(
        sample.appointmentTestId,
        {
          amount: payload.amount,
          paymentMethod: payload.paymentMethod,
          transactionId: payload.transactionId,
        },
        context
      );
    }

    if (payload.action === 'SET_EXPECTED_REPORT_READY_AT') {
      if (!payload.expectedReportReadyAt) {
        throw new HttpError(
          400,
          'Expected report ready date and time is required'
        );
      }

      return this.setExpectedReportReadyAt(
        sample.appointmentTestId,
        {
          expectedReportReadyAt: payload.expectedReportReadyAt,
          note: payload.note,
        },
        context
      );
    }

    return this.updateSampleStatus(
      sample.appointmentTestId,
      payload.action,
      context
    );
  }

  static async getLabInvoiceByAppointmentTest(
    appointmentTestId: string,
    context: { clinicId: string; labId: string; userId: string }
  ) {
    return await database.transaction(async (trx) => {
      await this.verifyLabAccess(
        trx,
        context.clinicId,
        context.labId,
        context.userId
      );

      const invoice = await this.getFormattedLabInvoiceByAppointmentTestId(
        trx,
        appointmentTestId,
        context
      );

      if (!invoice) {
        throw new HttpError(404, 'Lab invoice not found');
      }

      return invoice;
    });
  }

  static async getLabInvoiceById(
    invoiceId: string,
    context: { clinicId: string; labId: string; userId: string }
  ) {
    return await database.transaction(async (trx) => {
      await this.verifyLabAccess(
        trx,
        context.clinicId,
        context.labId,
        context.userId
      );

      const invoice = await this.getFormattedLabInvoiceById(
        trx,
        invoiceId,
        context
      );

      if (!invoice) {
        throw new HttpError(404, 'Lab invoice not found');
      }

      return invoice;
    });
  }

  static async markPaymentPaid(
    appointmentTestId: string,
    payload: MarkPaymentPaidPayload,
    context: { clinicId: string; labId: string; userId: string }
  ) {
    const paidAmount = this.getValidPaidAmount(payload.amount);

    return await database.transaction(async (trx) => {
      const record = await this.getScopedAppointmentTest(
        trx,
        appointmentTestId,
        context.clinicId,
        context.labId,
        context.userId
      );

      const now = new Date();
      const paymentMethod = this.normalizeLabPaymentMethod(
        payload.paymentMethod
      );

      if (!paymentMethod) {
        throw new HttpError(400, 'Payment method must be CASH or UPI');
      }

      if (this.isPaymentPaid(record.appointmentTest.paymentStatus)) {
        await this.ensureLabSample(trx, record, context, now);
        const invoice = await this.createLabInvoiceForPaidAppointmentTest(
          trx,
          record,
          {
            amount: paidAmount,
            paymentMethod,
          },
          context,
          now
        );

        return {
          appointmentTestId: record.appointmentTest.id,
          workflowStatus: record.appointmentTest.workflowStatus,
          paymentStatus: 'PAID',
          paymentMethod: invoice.paymentMethod,
          transactionId: payload.transactionId ?? null,
          sampleStatus: record.appointmentTest.sampleStatus,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
        };
      }

      if (
        record.appointmentTest.workflowStatus !==
        APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD
      ) {
        throw new HttpError(409, 'Test must be on hold before marking paid');
      }

      if (!this.isPaymentPending(record.appointmentTest.paymentStatus)) {
        throw new HttpError(409, 'Payment has already been updated');
      }

      // Only reassign labAssistantId when the payer is an actual lab
      // assistant. A Receptionist/Admin collecting payment isn't lab staff —
      // stamping their id here would hide the test from every real lab
      // assistant's list (same pitfall as at walk-in creation).
      const labAssistantId =
        record.performerUserType === 'Lab_Assistant'
          ? context.userId
          : record.appointmentTest.labAssistantId;

      const [updated] = await trx
        .update(LabOrderModel)
        .set({
          workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.IN_PROGRESS,
          reportStatus: 'InProgress',
          paymentStatus: APPOINTMENT_TEST_PAYMENT_STATUS.PAID,
          paymentCollectedAt: now,
          paymentCollectedBy: context.userId,
          sampleStatus:
            APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_COLLECTION_PENDING,
          labAssistantId,
          updatedAt: now,
        })
        .where(
          and(
            eq(LabOrderModel.id, appointmentTestId),
            eq(LabOrderModel.clinicId, context.clinicId),
            eq(
              LabOrderModel.workflowStatus,
              APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD
            )
          )
        )
        .returning({
          id: LabOrderModel.id,
          workflowStatus: LabOrderModel.workflowStatus,
          paymentStatus: LabOrderModel.paymentStatus,
          sampleStatus: LabOrderModel.sampleStatus,
        });

      if (!updated) {
        throw new HttpError(409, 'Appointment test status already moved');
      }

      await this.ensureLabSample(
        trx,
        {
          ...record,
          appointmentTest: {
            ...record.appointmentTest,
            workflowStatus: updated.workflowStatus,
            sampleStatus: updated.sampleStatus,
          },
        },
        context,
        now
      );

      await trx
        .update(LabSamplesModel)
        .set({
          status: (updated.sampleStatus ??
            APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_COLLECTION_PENDING) as LabSampleStatus,
          updatedAt: now,
        })
        .where(eq(LabSamplesModel.appointmentTestId, appointmentTestId));

      const invoice = await this.createLabInvoiceForPaidAppointmentTest(
        trx,
        record,
        {
          amount: paidAmount,
          paymentMethod,
        },
        context,
        now
      );

      await this.createTrackingEvent(trx, {
        clinicId: context.clinicId,
        labId: context.labId,
        appointmentTestId,
        eventType: APPOINTMENT_TEST_TRACKING_EVENT.PAYMENT_MARKED_PAID,
        title: 'Payment marked as paid',
        actorUserId: context.userId,
        metadata: {
          amount: paidAmount,
          paymentMethod,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          transactionId: payload.transactionId ?? null,
        },
        createdAt: now,
      });

      await this.createTrackingEvent(trx, {
        clinicId: context.clinicId,
        labId: context.labId,
        appointmentTestId,
        eventType: APPOINTMENT_TEST_TRACKING_EVENT.SAMPLE_COLLECTION_PENDING,
        title: 'Sample collection pending',
        actorUserId: context.userId,
        createdAt: now,
      });

      return {
        appointmentTestId: updated.id,
        workflowStatus: updated.workflowStatus,
        paymentStatus: this.normalizePaymentStatus(
          updated.paymentStatus
        )?.toUpperCase(),
        paymentMethod,
        transactionId: payload.transactionId ?? null,
        sampleStatus: updated.sampleStatus,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      };
    });
  }

  static async setExpectedReportReadyAt(
    appointmentTestId: string,
    payload: SetExpectedReportReadyAtPayload,
    context: { clinicId: string; labId: string; userId: string }
  ) {
    return await database.transaction(async (trx) => {
      const record = await this.getScopedAppointmentTest(
        trx,
        appointmentTestId,
        context.clinicId,
        context.labId,
        context.userId
      );

      if (
        record.appointmentTest.workflowStatus ===
        APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED
      ) {
        throw new HttpError(409, 'Rejected tests cannot move forward');
      }

      if (!this.isPaymentPaid(record.appointmentTest.paymentStatus)) {
        throw new HttpError(
          400,
          'Payment must be paid before setting expected report ready time'
        );
      }

      const currentSampleStatus =
        record.appointmentTest.sampleStatus ??
        APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED;

      if (!this.canEditExpectedReportReadyAt(currentSampleStatus)) {
        throw new HttpError(
          409,
          'Expected report ready time can be set after sample is received at lab'
        );
      }

      const now = new Date();
      const shouldStartProcessing =
        currentSampleStatus ===
        APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_RECEIVED_AT_LAB;
      const nextSampleStatus = shouldStartProcessing
        ? APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_PROCESSING
        : currentSampleStatus;

      const [updated] = await trx
        .update(LabOrderModel)
        .set({
          expectedReportReadyAt: payload.expectedReportReadyAt,
          ...(shouldStartProcessing
            ? {
                sampleStatus: APPOINTMENT_TEST_SAMPLE_STATUS.SAMPLE_PROCESSING,
                workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.IN_PROGRESS,
                processingStartedAt: now,
              }
            : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(LabOrderModel.id, appointmentTestId),
            eq(LabOrderModel.clinicId, context.clinicId),
            eq(LabOrderModel.sampleStatus, currentSampleStatus)
          )
        )
        .returning({
          id: LabOrderModel.id,
          workflowStatus: LabOrderModel.workflowStatus,
          paymentStatus: LabOrderModel.paymentStatus,
          sampleStatus: LabOrderModel.sampleStatus,
          expectedReportReadyAt: LabOrderModel.expectedReportReadyAt,
        });

      if (!updated) {
        throw new HttpError(409, 'Appointment test status already moved');
      }

      await this.ensureLabSample(
        trx,
        {
          ...record,
          appointmentTest: {
            ...record.appointmentTest,
            workflowStatus: updated.workflowStatus,
            sampleStatus: updated.sampleStatus,
          },
        },
        context,
        now
      );

      await trx
        .update(LabSamplesModel)
        .set({
          status: (updated.sampleStatus ?? nextSampleStatus) as LabSampleStatus,
          ...(shouldStartProcessing ? { processingStartedAt: now } : {}),
          updatedAt: now,
        })
        .where(eq(LabSamplesModel.appointmentTestId, appointmentTestId));

      await this.createTrackingEvent(trx, {
        clinicId: context.clinicId,
        labId: context.labId,
        appointmentTestId,
        eventType: APPOINTMENT_TEST_TRACKING_EVENT.EXPECTED_REPORT_READY_AT_SET,
        title: 'Expected report ready time set',
        description: payload.note ?? null,
        actorUserId: context.userId,
        metadata: {
          expectedReportReadyAt: payload.expectedReportReadyAt.toISOString(),
        },
        createdAt: now,
      });

      return {
        appointmentTestId: updated.id,
        workflowStatus: this.getLabResponseWorkflowStatus(
          updated.workflowStatus
        ),
        paymentStatus: this.normalizePaymentStatus(updated.paymentStatus),
        sampleStatus: updated.sampleStatus,
        expectedReportReadyAt: updated.expectedReportReadyAt,
        nextAction: this.getNextAction(updated.sampleStatus),
      };
    });
  }

  static async updateSampleStatus(
    appointmentTestId: string,
    action: AppointmentTestSampleAction,
    context: { clinicId: string; labId: string; userId: string }
  ) {
    const result = await database.transaction(async (trx) => {
      const record = await this.getScopedAppointmentTest(
        trx,
        appointmentTestId,
        context.clinicId,
        context.labId,
        context.userId
      );

      if (
        record.appointmentTest.workflowStatus ===
        APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED
      ) {
        throw new HttpError(409, 'Rejected tests cannot move forward');
      }

      if (!this.isPaymentPaid(record.appointmentTest.paymentStatus)) {
        throw new HttpError(
          400,
          'Payment must be paid before sample process starts'
        );
      }

      const transition = SAMPLE_ACTION_TRANSITIONS[action];
      const currentSampleStatus =
        record.appointmentTest.sampleStatus ??
        APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED;

      if (currentSampleStatus !== transition.from) {
        throw new HttpError(409, 'Invalid sample status transition');
      }

      const now = new Date();
      const workflowStatus =
        transition.to === APPOINTMENT_TEST_SAMPLE_STATUS.COMPLETED
          ? APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED
          : APPOINTMENT_TEST_WORKFLOW_STATUS.IN_PROGRESS;

      const [updated] = await trx
        .update(LabOrderModel)
        .set({
          sampleStatus: transition.to,
          workflowStatus,
          [transition.timestampField]: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(LabOrderModel.id, appointmentTestId),
            eq(LabOrderModel.clinicId, context.clinicId),
            eq(LabOrderModel.sampleStatus, transition.from)
          )
        )
        .returning({
          id: LabOrderModel.id,
          workflowStatus: LabOrderModel.workflowStatus,
          paymentStatus: LabOrderModel.paymentStatus,
          sampleStatus: LabOrderModel.sampleStatus,
        });

      if (!updated) {
        throw new HttpError(409, 'Appointment test status already moved');
      }

      await this.ensureLabSample(
        trx,
        {
          ...record,
          appointmentTest: {
            ...record.appointmentTest,
            workflowStatus: updated.workflowStatus,
            sampleStatus: updated.sampleStatus,
          },
        },
        context,
        now
      );

      await trx
        .update(LabSamplesModel)
        .set({
          status: (updated.sampleStatus ?? transition.to) as LabSampleStatus,
          ...this.getSampleTimestampUpdate(action, context.userId, now),
          updatedAt: now,
        })
        .where(eq(LabSamplesModel.appointmentTestId, appointmentTestId));

      await this.createTrackingEvent(trx, {
        clinicId: context.clinicId,
        labId: context.labId,
        appointmentTestId,
        eventType: transition.eventType,
        title: transition.title,
        actorUserId: context.userId,
        createdAt: now,
      });

      return {
        appointmentTestId: updated.id,
        workflowStatus: updated.workflowStatus,
        paymentStatus: updated.paymentStatus,
        sampleStatus: updated.sampleStatus,
        nextAction:
          transition.to === APPOINTMENT_TEST_SAMPLE_STATUS.COMPLETED
            ? null
            : this.getNextAction(transition.to),
        appointmentId: record.appointmentTest.appointmentId,
        doctorId: record.appointmentTest.doctorId,
      };
    });

    signalLabChange(
      {
        clinicId: context.clinicId,
        labId: context.labId,
        appointmentId: result.appointmentId,
        doctorId: result.doctorId,
      },
      `lab.sample_${result.sampleStatus}`.toLowerCase()
    );

    const {
      appointmentId: _appointmentId,
      doctorId: _doctorId,
      ...response
    } = result;
    return response;
  }

  static async removeTestFromAppointment(id: string) {
    return await database.transaction(async (trx) => {
      const [deleted] = await trx
        .delete(LabOrderModel)
        .where(eq(LabOrderModel.id, id))
        .returning();

      if (!deleted) {
        throw new HttpError(404, 'Test assignment not found');
      }
      return deleted;
    });
  }

  static async getTestsByAppointmentId(appointmentId: string) {
    return await database.transaction(async (trx) => {
      // 1️⃣ Fetch tests + IDs
      const rows = await trx
        .select({
          appointmentTestId: LabOrderModel.id,
          appointmentId: AppointmentModel.id,

          test: TestCatalogModel,

          reportPdf: LabOrderModel.reportPdf,
          paymentStatus: LabOrderModel.paymentStatus,
          sampleStatus: LabOrderModel.sampleStatus,
          assignedAt: LabOrderModel.createdAt,

          doctorId: AppointmentModel.doctorId,
          patientId: AppointmentModel.patientId,
          clinicId: AppointmentModel.clinicId,

          clinicName: ClinicModel.clinicName,
          clinicAddress: ClinicModel.clinicAddress,
          clinicLocation: ClinicModel.clinicLocation,
        })
        .from(LabOrderModel)
        .innerJoin(
          AppointmentModel,
          eq(LabOrderModel.appointmentId, AppointmentModel.id)
        )
        .innerJoin(
          TestCatalogModel,
          eq(LabOrderModel.testId, TestCatalogModel.id)
        )
        .innerJoin(ClinicModel, eq(AppointmentModel.clinicId, ClinicModel.id))
        .where(eq(LabOrderModel.appointmentId, appointmentId))
        .orderBy(desc(LabOrderModel.createdAt));

      if (!rows.length) return [];

      // 2️⃣ Fetch doctor & patient names ONCE
      const validUserIds = Array.from(
        new Set(
          rows
            .flatMap((row) => [row.doctorId, row.patientId])
            .filter((id): id is string => Boolean(id))
        )
      );

      const users = validUserIds.length
        ? await trx
            .select({
              id: UserModel.id,
              name: UserModel.name,
            })
            .from(UserModel)
            .where(inArray(UserModel.id, validUserIds))
        : [];
      const userNameById = new Map(users.map((user) => [user.id, user.name]));

      // 3️⃣ Attach names once
      return rows.map((r) => ({
        ...r,
        paymentStatus: this.getReportUploadPaymentStatus(r.paymentStatus),
        sampleStatus:
          r.sampleStatus ?? APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED,
        doctorName: r.doctorId ? (userNameById.get(r.doctorId) ?? null) : null,
        patientName: r.patientId
          ? (userNameById.get(r.patientId) ?? null)
          : null,
      }));
    });
  }

  static async getTestsByPatientId(patientId: string) {
    return await database.transaction(async (trx) => {
      // 1️⃣ Fetch tests + IDs
      const rows = await trx
        .select({
          appointmentTestId: LabOrderModel.id,
          appointmentId: AppointmentModel.id,
          appointmentDate: AppointmentModel.appointmentDate,

          test: TestCatalogModel,

          reportPdf: LabOrderModel.reportPdf,
          paymentStatus: LabOrderModel.paymentStatus,
          sampleStatus: LabOrderModel.sampleStatus,
          assignedAt: LabOrderModel.createdAt,

          doctorId: AppointmentModel.doctorId,
          patientId: AppointmentModel.patientId,
          clinicId: AppointmentModel.clinicId,

          clinicName: ClinicModel.clinicName,
          clinicAddress: ClinicModel.clinicAddress,
          clinicLocation: ClinicModel.clinicLocation,
        })
        .from(LabOrderModel)
        .innerJoin(
          AppointmentModel,
          eq(LabOrderModel.appointmentId, AppointmentModel.id)
        )
        .innerJoin(
          TestCatalogModel,
          eq(LabOrderModel.testId, TestCatalogModel.id)
        )
        .innerJoin(ClinicModel, eq(AppointmentModel.clinicId, ClinicModel.id))
        .where(eq(AppointmentModel.patientId, patientId))
        .orderBy(desc(LabOrderModel.createdAt));

      if (!rows.length) return [];

      // 2️⃣ Fetch doctor & patient names ONCE
      const validUserIds = Array.from(
        new Set(
          rows
            .flatMap((row) => [row.doctorId, row.patientId])
            .filter((id): id is string => Boolean(id))
        )
      );

      const users = validUserIds.length
        ? await trx
            .select({
              id: UserModel.id,
              name: UserModel.name,
            })
            .from(UserModel)
            .where(inArray(UserModel.id, validUserIds))
        : [];
      const userNameById = new Map(users.map((user) => [user.id, user.name]));

      // 3️⃣ Attach names
      return rows.map((r) => ({
        ...r,
        paymentStatus: this.getReportUploadPaymentStatus(r.paymentStatus),
        sampleStatus:
          r.sampleStatus ?? APPOINTMENT_TEST_SAMPLE_STATUS.NOT_STARTED,
        doctorName: r.doctorId ? (userNameById.get(r.doctorId) ?? null) : null,
        patientName: r.patientId
          ? (userNameById.get(r.patientId) ?? null)
          : null,
      }));
    });
  }

  static async updateAppointmentTest(
    id: string,
    payload: {
      doctorId?: string;
      labAssistantId?: string;
      reportStatus?: 'Initiated' | 'InProgress' | 'Completed';
      reportPdf?: string;
      paymentStatus?: 'pending' | 'paid' | 'failed';
      workflowStatus?: AppointmentTestWorkflowStatus;
    },
    performerUserId?: string,
    clinicId?: string
  ) {
    const result = await database.transaction(async (trx) => {
      const oldPdfUrl = (
        await trx
          .select({ reportPdf: LabOrderModel.reportPdf })
          .from(LabOrderModel)
          .where(eq(LabOrderModel.id, id))
          .limit(1)
      )[0]?.reportPdf;

      if (payload.reportPdf) {
        payload.workflowStatus = APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED;
      }

      const [appointmentTestRecord] = await trx
        .select({
          appointmentTest: LabOrderModel,
          appointmentId: AppointmentModel.id,
          patientId: AppointmentModel.patientId,
          test: TestCatalogModel, // ✅ ADD THIS to get test name
        })
        .from(LabOrderModel)
        .innerJoin(
          AppointmentModel,
          eq(LabOrderModel.appointmentId, AppointmentModel.id)
        )
        .innerJoin(
          TestCatalogModel,
          eq(LabOrderModel.testId, TestCatalogModel.id)
        )
        .where(
          clinicId
            ? and(
                eq(LabOrderModel.id, id),
                eq(LabOrderModel.clinicId, clinicId)
              )
            : eq(LabOrderModel.id, id)
        );

      if (!appointmentTestRecord) {
        throw new HttpError(404, 'Appointment test not found');
      }

      const { appointmentTest, appointmentId, test } = appointmentTestRecord;

      const [updated] = await trx
        .update(LabOrderModel)
        .set({
          ...payload,
          updatedAt: new Date(),
        })
        .where(eq(LabOrderModel.id, id))
        .returning();

      if (payload.reportPdf && oldPdfUrl && oldPdfUrl !== payload.reportPdf) {
        await deleteFromS3(oldPdfUrl).catch(() => {
          logger.error('Failed to delete old test PDF');
        });
      }

      await AppointmentActivityHistoryService.logActivity({
        appointmentId: appointmentId,
        action: 'TEST_REPORT_UPLOADED',
        performedBy: performerUserId,
        previousState: appointmentTest,
        newState: updated,
        remarks: `${test.name} (${test.category}) - report has been updated`,
        tx: trx,
      });

      // Notification is dispatched post-commit; it writes on a different
      // connection than `trx`.
      return {
        updated,
        patientId: appointmentTestRecord.patientId,
        testName: test.name,
      };
    });

    const { updated, patientId, testName } = result;

    if (performerUserId && clinicId && payload.reportPdf) {
      const performer = await getUserById(performerUserId);
      if (performer) {
        await notifyTestReportUploaded(
          clinicId, // clinic context
          updated.id, // testId
          performer.id, // performerUserId
          performer.name, // performerName
          performer.userType, // performerRole
          updated.doctorId ?? undefined, // assigned doctor (optional)
          patientId, // patientId
          testName // test name
        );
      }
    }

    return updated;
  }
}
