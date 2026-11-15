import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalUuid = (message: string) =>
  z.preprocess(emptyStringToUndefined, z.string().uuid(message).optional());

const optionalTrimmedString = (max = 100) =>
  z.preprocess(emptyStringToUndefined, z.string().trim().max(max).optional());

const paymentStatusSchema = z.preprocess(
  emptyStringToUndefined,
  z.enum(['pending', 'paid', 'failed']).optional()
);

const walkinPaymentStatusSchema = z.preprocess(
  emptyStringToUndefined,
  z.enum(['pending', 'paid', 'failed']).default('paid')
);

const orderTypeSchema = z.preprocess(
  emptyStringToUndefined,
  z.enum(['walkin_test', 'walkin_package', 'prescribed']).optional()
);

const sampleTypeSchema = z.preprocess(
  emptyStringToUndefined,
  z.enum(['labCollected', 'homeCollected']).optional()
);

const nullableTrimmedString = (max = 100) =>
  z.preprocess((value) => {
    const processed = emptyStringToUndefined(value);
    return processed === null ? null : processed;
  }, z.string().trim().max(max).nullable().optional());

const nullableUuid = (message: string) =>
  z.preprocess((value) => {
    const processed = emptyStringToUndefined(value);
    return processed === null ? null : processed;
  }, z.string().uuid(message).nullable().optional());

export const homeSampleSchema = z.object({
  homeCollectionId: z.string().uuid('Invalid home collection pricing id'),
  distance: z.coerce.number().finite().min(0, 'Distance cannot be negative'),
  unit: z.enum(['m', 'km']),
});

const optionalDate = (endOfDay = false) =>
  z.preprocess((value) => {
    const processed = emptyStringToUndefined(value);
    if (
      typeof processed === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(processed)
    ) {
      const time = endOfDay ? '23:59:59.999' : '00:00:00.000';
      return new Date(`${processed}T${time}`);
    }
    return processed;
  }, z.coerce.date().optional());

export const getLabOrdersQuerySchema = z.object({
  page: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().positive().optional().default(1)
  ),
  limit: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().positive().max(100).optional().default(10)
  ),
  search: optionalTrimmedString(120),
  groupBy: z.preprocess(emptyStringToUndefined, z.enum(['patient']).optional()),
  view: z.preprocess(
    emptyStringToUndefined,
    z.enum(['list', 'grouped']).optional()
  ),
  labOrderId: optionalUuid('Invalid lab order id'),
  appointmentId: optionalUuid('Invalid appointment id'),
  patientId: optionalUuid('Invalid patient id'),
  doctorId: optionalUuid('Invalid doctor id'),
  referringDoctorName: optionalTrimmedString(255),
  orderType: orderTypeSchema,
  sampleType: sampleTypeSchema,
  labUpdatedTestPackageId: optionalUuid('Invalid lab updated test package id'),
  packageId: optionalUuid('Invalid package id'),
  workflowStatus: optionalTrimmedString(50),
  reportStatus: z.preprocess(
    emptyStringToUndefined,
    z.enum(['Initiated', 'InProgress', 'Collected', 'Completed']).optional()
  ),
  paymentStatus: paymentStatusSchema,
  overallStatus: z.preprocess(
    emptyStringToUndefined,
    z
      .enum([
        'Initiated',
        'Processing',
        'Completed',
        'On-Hold',
        'Rejected',
        'NoShow',
        'TestNotAvailable',
      ])
      .optional()
  ),
  sampleStatus: optionalTrimmedString(50),
  sampleCode: optionalTrimmedString(30),
  dateFrom: optionalDate(),
  dateTo: optionalDate(true),
  sortBy: z.preprocess(
    emptyStringToUndefined,
    z.enum(['date', 'createdAt', 'patientName', 'testName']).optional()
  ),
  sortOrder: z.preprocess(
    emptyStringToUndefined,
    z.enum(['asc', 'desc']).optional().default('desc')
  ),
});

export const labOrderIdParamSchema = z.object({
  labOrderId: z.string().uuid('Invalid lab order id'),
});

export const sampleCodeParamSchema = z.object({
  sampleCode: z.string().trim().min(1, 'Search value is required').max(150),
});

const uuidArraySchema = (message: string) =>
  z.array(z.string().uuid(message)).optional().default([]);

const parseUuidArrayInput = (value: unknown) => {
  const processed = emptyStringToUndefined(value);

  if (Array.isArray(processed)) return processed;

  if (typeof processed === 'string') {
    try {
      const parsed = JSON.parse(processed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall back to comma-separated form for multipart/form-data clients.
    }

    return processed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return processed;
};

const labOrderRefundSchema = z.object({
  amount: z.coerce.number().int().positive('Refund amount must be above 0'),
  refundHomeSample: z.boolean().optional().default(false),
  reason: z.string().trim().min(1, 'Refund reason is required').max(255),
  paymentMode: optionalTrimmedString(20),
  paymentNotes: optionalTrimmedString(50),
});

const homeSamplePaymentSchema = z.object({
  amount: z.coerce.number().int().positive('Payment amount must be above 0'),
  paymentStatus: walkinPaymentStatusSchema,
  paymentMode: optionalTrimmedString(20),
  paymentNotes: optionalTrimmedString(50),
});

const updateLabOrderFieldsSchema = z
  .object({
    homeSample: homeSampleSchema.optional(),
    refund: labOrderRefundSchema.optional(),
    // Found via this order's own labOrderId — send it on only one order
    // sharing the home sample, same rule as refund.refundHomeSample.
    homeSamplePayment: homeSamplePaymentSchema.optional(),
    labUpdatedTestId: nullableUuid('Invalid lab updated test id'),
    reportStatus: z.preprocess(
      emptyStringToUndefined,
      z.enum(['Initiated', 'InProgress', 'Collected', 'Completed']).optional()
    ),
    paymentStatus: paymentStatusSchema,
    price: z.preprocess(
      emptyStringToUndefined,
      z.coerce.number().int().min(0).optional()
    ),
    discountPercent: z.preprocess(
      emptyStringToUndefined,
      z.coerce.number().min(0).max(100).optional()
    ),
    paymentMode: nullableTrimmedString(20),
    paymentNotes: nullableTrimmedString(50),
    workflowStatus: optionalTrimmedString(50),
    sampleStatus: nullableTrimmedString(50),
    sampleCode: nullableTrimmedString(30),
    recollectedReason: optionalTrimmedString(1000),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'At least one lab order field must be provided',
  });

const distributeLabOrderPaymentSchema = z.object({
  labOrderGroupId: z.string().uuid('Invalid lab order group id'),
  // Narrows which tests in the group are eligible; omit for every test in the group.
  labOrderIds: z.array(z.string().uuid('Invalid lab order id')).optional(),
  amount: z.coerce.number().int().positive('Amount must be above 0'),
  includeHomeSample: z.boolean().optional().default(true),
  paymentStatus: walkinPaymentStatusSchema,
  paymentMode: optionalTrimmedString(20),
  paymentNotes: optionalTrimmedString(50),
});

export const updateLabOrdersSchema = z
  .union([
    z.object({
      labOrderIds: z
        .array(z.string().uuid('Invalid lab order id'))
        .min(1, 'At least one lab order id is required'),
      updates: updateLabOrderFieldsSchema,
      homeSample: homeSampleSchema.optional(),
    }),
    z.object({
      orders: z
        .array(
          z.object({
            labOrderId: z.string().uuid('Invalid lab order id'),
            updates: updateLabOrderFieldsSchema,
          })
        )
        .min(1, 'At least one lab order update is required'),
    }),
    z.object({
      distribute: distributeLabOrderPaymentSchema,
    }),
  ])
  .transform((data) => {
    if ('orders' in data || 'distribute' in data) {
      return data;
    }

    const updates =
      data.homeSample === undefined
        ? data.updates
        : { ...data.updates, homeSample: data.homeSample };

    return {
      orders: data.labOrderIds.map((labOrderId) => ({
        labOrderId,
        updates,
      })),
    };
  });

export const bulkUploadLabOrderReportSchema = z.object({
  labOrderIds: z.preprocess(
    parseUuidArrayInput,
    z
      .array(z.string().uuid('Invalid lab order id'))
      .min(1, 'At least one lab order id is required')
  ),
});

const resultValueSchema = z.preprocess((value) => {
  if (value === null || value === undefined) return value;
  return String(value);
}, z.string().trim().max(2000).nullable());

export const getLabOrderParametersSchema = z.object({
  labOrderIds: z
    .array(z.string().uuid('Invalid lab order id'))
    .min(1, 'At least one lab order id is required'),
});

export const getLabOrderReportSchema = getLabOrderParametersSchema;

const labOrderResultValueSchema = z.object({
  parameterId: z.string().uuid('Invalid parameter id'),
  resultValue: resultValueSchema,
});

export const saveLabUpdatedResultsSchema = z.object({
  orderResults: z
    .array(
      z.object({
        labOrderId: z.string().uuid('Invalid lab order id'),
        results: z.array(labOrderResultValueSchema).default([]),
      })
    )
    .min(1, 'At least one order result is required'),
});

export const addWalkinLabOrderSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(150),
    mobile: z.string().trim().min(6, 'Mobile is required').max(20),
    gender: z.string().trim().min(1, 'Gender is required').max(50),
    age: z.coerce.number().int().min(0).max(130),
    address: optionalTrimmedString(1000),
    city: optionalTrimmedString(100),
    state: optionalTrimmedString(100),
    createdAt: optionalDate(),
    homeSample: homeSampleSchema.optional(),
    referringDoctorName: optionalTrimmedString(255),
    price: z.preprocess(
      emptyStringToUndefined,
      z.coerce.number().int().min(0).optional()
    ),
    paymentStatus: walkinPaymentStatusSchema,
    paymentMode: optionalTrimmedString(20),
    paymentNotes: optionalTrimmedString(50),
    discountPercent: z.preprocess(
      emptyStringToUndefined,
      z.coerce.number().min(0).max(100).optional()
    ),
    labUpdatedTestIds: uuidArraySchema('Invalid lab updated test id'),
    labUpdatedTestPackageIds: uuidArraySchema(
      'Invalid lab updated test package id'
    ),
    testIds: uuidArraySchema('Invalid lab updated test id'),
    packageIds: uuidArraySchema('Invalid lab updated test package id'),
    labOrderGroupId: optionalUuid('Invalid lab order group id'),
  })
  .transform((data) => ({
    ...data,
    labUpdatedTestIds: Array.from(
      new Set([...(data.labUpdatedTestIds ?? []), ...(data.testIds ?? [])])
    ),
    labUpdatedTestPackageIds: Array.from(
      new Set([
        ...(data.labUpdatedTestPackageIds ?? []),
        ...(data.packageIds ?? []),
      ])
    ),
  }))
  .refine(
    (data) =>
      data.labUpdatedTestIds.length > 0 ||
      data.labUpdatedTestPackageIds.length > 0,
    {
      message:
        'At least one labUpdatedTestId or labUpdatedTestPackageId is required',
    }
  );

export type GetLabOrdersQueryInput = z.infer<typeof getLabOrdersQuerySchema>;
export type AddWalkinLabOrderInput = z.infer<typeof addWalkinLabOrderSchema>;
export type HomeSampleInput = z.infer<typeof homeSampleSchema>;
export type UpdateLabOrdersInput = z.infer<typeof updateLabOrdersSchema>;
/** The two per-order update shapes always normalize to this before the service sees them. */
export type UpdateLabOrdersBulkInput = {
  orders: {
    labOrderId: string;
    updates: z.infer<typeof updateLabOrderFieldsSchema>;
  }[];
};
export type DistributeLabOrderPaymentInput = z.infer<
  typeof distributeLabOrderPaymentSchema
>;
export type BulkUploadLabOrderReportInput = z.infer<
  typeof bulkUploadLabOrderReportSchema
>;
export type SaveLabUpdatedResultsInput = z.infer<
  typeof saveLabUpdatedResultsSchema
>;
