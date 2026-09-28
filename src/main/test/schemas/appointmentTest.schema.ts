import z from 'zod';
import {
  APPOINTMENT_TEST_SAMPLE_ACTION,
  APPOINTMENT_TEST_WORKFLOW_STATUS,
} from '../constants/appointmentTest.constants';

const optionalTrimmedString = (maxLength: number) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().min(1).max(maxLength).optional()
  );

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const positiveQueryInt = (max?: number) => {
  const base = z.coerce.number().int().positive();
  return z.preprocess(
    emptyStringToUndefined,
    (max ? base.max(max) : base).optional()
  );
};

const dateOnlyString = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .optional()
);

const optionalBooleanQuery = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === '') {
    return undefined;
  }

  if (normalized === 'true' || normalized === '1') {
    return true;
  }

  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  return value;
}, z.boolean().optional());

const normalizeDatePresetQuery = (value: unknown) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

  if (normalized === '') {
    return undefined;
  }

  const aliases: Record<
    string,
    'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'custom'
  > = {
    today: 'today',
    yesterday: 'yesterday',
    week: 'thisWeek',
    thisweek: 'thisWeek',
    month: 'thisMonth',
    thismonth: 'thisMonth',
    custom: 'custom',
    customrange: 'custom',
  };

  return aliases[normalized] ?? value;
};

const paymentMethodSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
  z.enum(['CASH', 'UPI'])
);

const optionalPaymentMethodSchema = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === ''
      ? undefined
      : typeof value === 'string'
        ? value.trim().toUpperCase()
        : value,
  z.enum(['CASH', 'UPI']).optional()
);

const dateTimeSchema = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.coerce.date()
);

export const addTestToAppointmentSchema = z
  .object({
    appointmentId: z.string().uuid('Invalid Appointment ID'),
    patientId: z.string().uuid('Invalid Patient ID'),
    doctorId: z.string().uuid('Invalid doctor ID'),
    // Accept either single testId or array of testIds
    testId: z
      .union([
        z.string().uuid('Invalid Test ID'),
        z.array(z.string().uuid('Invalid Test ID')),
      ])
      .optional(),
    // Alternative field name for multiple tests
    testIds: z.array(z.string().uuid('Invalid Test ID')).optional(),
  })
  .refine((data) => data.testId || data.testIds, {
    message: 'Either testId or testIds must be provided',
  });

export const addIndependentTestsSchema = z.object({
  testIds: z
    .array(z.string().uuid('Invalid Test ID'))
    .min(1, 'At least one test must be selected'),
  patientName: z.string().trim().min(1, 'Patient name is required'),
  patientMobile: z.string().trim().min(1, 'Patient mobile is required'),
  patientAge: z.coerce
    .number()
    .int('Patient age must be an integer')
    .positive('Patient age must be greater than 0'),
  patientGender: z.string().trim().min(1, 'Patient gender is required'),
  doctorName: z.string().trim().optional(),
});

export const updateReportPdfSchema = z.object({
  appointmentTestId: z.string().uuid('Invalid Appointment Test ID'), // only validate ID
});

export const appointmentTestIdParamSchema = z.object({
  appointmentTestId: z.string().uuid('Invalid Appointment Test ID'),
});

export const labInvoiceIdParamSchema = z.object({
  invoiceId: z.string().uuid('Invalid Lab Invoice ID'),
});

export const appointmentTestUniqueTestIdParamSchema = z.object({
  uniqueTestId: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
    z.string().regex(/^[A-Z]{1,3}_\d{3,}$/, 'Invalid test barcode')
  ),
});

export const labSampleBarcodeValueParamSchema = z.object({
  barcodeValue: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
    z.string().regex(/^[A-Z0-9][A-Z0-9_-]{2,39}$/, 'Invalid barcode value')
  ),
});

export const removeTestFromAppointmentSchema = z.object({
  id: z.string().uuid('Invalid ID'),
});

export const appointmentIdParamSchema = z.object({
  appointmentId: z.string().uuid('Invalid Appointment ID'),
});

export const patientIdParamSchema = z.object({
  patientId: z.string().uuid('Invalid Patient ID'),
});

export const labAppointmentTestsQuerySchema = z
  .object({
    tab: z
      .preprocess(
        emptyStringToUndefined,
        z.enum(['all', 'assigned', 'my', 'new']).optional()
      )
      .default('all'),
    search: optionalTrimmedString(100),
    category: optionalTrimmedString(100),
    groupBy: z.preprocess(
      emptyStringToUndefined,
      z.enum(['patient']).optional()
    ),
    patientId: z.preprocess(
      emptyStringToUndefined,
      z.string().uuid('Invalid Patient ID').optional()
    ),
    independentPatientId: z.preprocess(
      emptyStringToUndefined,
      z.string().uuid('Invalid Independent Patient ID').optional()
    ),
    status: z.preprocess(
      emptyStringToUndefined,
      z
        .enum([
          APPOINTMENT_TEST_WORKFLOW_STATUS.INITIATED,
          APPOINTMENT_TEST_WORKFLOW_STATUS.ON_HOLD,
          'PENDING',
          APPOINTMENT_TEST_WORKFLOW_STATUS.REJECTED,
          APPOINTMENT_TEST_WORKFLOW_STATUS.IN_PROGRESS,
          APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED,
        ])
        .optional()
    ),
    page: positiveQueryInt(),
    limit: positiveQueryInt(100),
    pageNumber: positiveQueryInt(),
    pageSize: positiveQueryInt(100),
    datePreset: z.preprocess(
      normalizeDatePresetQuery,
      z
        .enum(['today', 'yesterday', 'thisWeek', 'thisMonth', 'custom'])
        .optional()
    ),
    startDate: dateOnlyString,
    endDate: dateOnlyString,
    trendPeriod: z
      .preprocess(
        emptyStringToUndefined,
        z.enum(['daily', 'weekly', 'monthly']).optional()
      )
      .default('daily'),
    includeDashboard: optionalBooleanQuery.default(true),
  })
  .refine(
    (query) =>
      query.datePreset !== 'custom' || (query.startDate && query.endDate),
    {
      message: 'startDate and endDate are required for custom datePreset',
      path: ['startDate'],
    }
  )
  .refine(
    (query) => {
      if (!query.startDate || !query.endDate) {
        return true;
      }

      return query.startDate <= query.endDate;
    },
    {
      message: 'startDate must be less than or equal to endDate',
      path: ['endDate'],
    }
  )
  .transform((query) => {
    const page = query.page ?? query.pageNumber ?? 1;
    const limit = query.limit ?? query.pageSize ?? 10;

    return {
      ...query,
      page,
      limit,
      pageNumber: page,
      pageSize: limit,
    };
  });

export const onHoldAppointmentTestSchema = z.object({
  reason: optionalTrimmedString(500),
});

export const rejectAppointmentTestSchema = z.object({
  reason: optionalTrimmedString(500),
});

export const markPaymentPaidSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  paymentMethod: paymentMethodSchema,
  transactionId: optionalTrimmedString(100),
});

export const setExpectedReportReadyAtSchema = z
  .object({
    expectedReportReadyAt: dateTimeSchema.optional(),
    reportReadyAt: dateTimeSchema.optional(),
    note: optionalTrimmedString(500),
  })
  .transform((data) => ({
    expectedReportReadyAt: data.expectedReportReadyAt ?? data.reportReadyAt,
    note: data.note,
  }))
  .refine((data) => data.expectedReportReadyAt instanceof Date, {
    message: 'Expected report ready date and time is required',
    path: ['expectedReportReadyAt'],
  });

export const updateSampleStatusSchema = z
  .object({
    action: z.enum([
      APPOINTMENT_TEST_SAMPLE_ACTION.MARK_SAMPLE_COLLECTED,
      APPOINTMENT_TEST_SAMPLE_ACTION.MARK_SAMPLE_RECEIVED_AT_LAB,
      APPOINTMENT_TEST_SAMPLE_ACTION.START_SAMPLE_PROCESSING,
      APPOINTMENT_TEST_SAMPLE_ACTION.START_TESTING,
      APPOINTMENT_TEST_SAMPLE_ACTION.MARK_QUALITY_CHECK_DONE,
      APPOINTMENT_TEST_SAMPLE_ACTION.MARK_COMPLETED,
      'SET_EXPECTED_REPORT_READY_AT',
    ]),
    expectedReportReadyAt: dateTimeSchema.optional(),
    note: optionalTrimmedString(500),
  })
  .refine(
    (data) =>
      data.action !== 'SET_EXPECTED_REPORT_READY_AT' ||
      data.expectedReportReadyAt !== undefined,
    {
      message: 'Expected report ready date and time is required',
      path: ['expectedReportReadyAt'],
    }
  );

export const barcodeSampleActionSchema = z
  .object({
    action: z.enum([
      'MARK_PAYMENT_PAID',
      'SET_EXPECTED_REPORT_READY_AT',
      APPOINTMENT_TEST_SAMPLE_ACTION.MARK_SAMPLE_COLLECTED,
      APPOINTMENT_TEST_SAMPLE_ACTION.MARK_SAMPLE_RECEIVED_AT_LAB,
      APPOINTMENT_TEST_SAMPLE_ACTION.START_SAMPLE_PROCESSING,
      APPOINTMENT_TEST_SAMPLE_ACTION.START_TESTING,
      APPOINTMENT_TEST_SAMPLE_ACTION.MARK_QUALITY_CHECK_DONE,
      APPOINTMENT_TEST_SAMPLE_ACTION.MARK_COMPLETED,
    ]),
    amount: z.coerce
      .number()
      .positive('Amount must be greater than 0')
      .optional(),
    paymentMethod: optionalPaymentMethodSchema,
    transactionId: optionalTrimmedString(100),
    expectedReportReadyAt: dateTimeSchema.optional(),
    note: optionalTrimmedString(500),
  })
  .refine(
    (data) => data.action !== 'MARK_PAYMENT_PAID' || data.amount !== undefined,
    {
      message: 'Payment amount is required',
      path: ['amount'],
    }
  )
  .refine(
    (data) =>
      data.action !== 'MARK_PAYMENT_PAID' || data.paymentMethod !== undefined,
    {
      message: 'Payment method is required',
      path: ['paymentMethod'],
    }
  )
  .refine(
    (data) =>
      data.action !== 'SET_EXPECTED_REPORT_READY_AT' ||
      data.expectedReportReadyAt !== undefined,
    {
      message: 'Expected report ready date and time is required',
      path: ['expectedReportReadyAt'],
    }
  );

// export const IdParamSchema = z.object({
//     appointmentTestId: z.string().uuid('Invalid Patient ID'),
// });
