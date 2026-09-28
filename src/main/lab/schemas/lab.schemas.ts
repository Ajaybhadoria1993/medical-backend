import { z } from 'zod';

/* =====================================================
   ENUMS
===================================================== */

export const labStatusEnumZod = z.enum([
  'Active',
  'Inactive',
  'Blocked',
  'New',
]);

export const labCatalogStatusEnumZod = z.enum([
  'active',
  'inactive',
  'deactive',
]);

const optionalNullableString = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : value));

const optionalEmail = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().email('Invalid email address').max(255).optional()
);

/* =====================================================
   LAB SCHEMAS
===================================================== */

// ✅ Create Lab
export const createLabSchema = z
  .object({
    clinicId: z.string().uuid('Invalid clinic id').optional(),
    name: z.string().trim().min(1).max(255).optional(),
    labName: z.string().trim().min(1).max(255).optional(),
    address: z.string().trim().min(1, 'Address is required'),
    contactNo: z.string().trim().min(5).max(20).optional(),
    phone: z.string().trim().min(5).max(20).optional(),
    email: optionalEmail,
    logo: optionalNullableString(1000),
    gstNumber: optionalNullableString(50),
    reportFooter: optionalNullableString(2000),
    labStatus: labStatusEnumZod.optional().default('New'),
  })
  .refine((data) => Boolean(data.name ?? data.labName), {
    path: ['name'],
    message: 'Lab name is required',
  })
  .refine((data) => Boolean(data.contactNo ?? data.phone), {
    path: ['contactNo'],
    message: 'Contact number is required',
  });

// ✅ Update Lab (Partial Update)
export const updateLabSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    labName: z.string().trim().min(1).max(255).optional(),
    address: z.string().trim().min(1).optional(),
    contactNo: z.string().trim().min(5).max(20).optional(),
    phone: z.string().trim().min(5).max(20).optional(),
    email: optionalEmail,
    logo: optionalNullableString(1000),
    gstNumber: optionalNullableString(50),
    reportFooter: optionalNullableString(2000),
    labStatus: labStatusEnumZod.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be updated',
  });

// ✅ Soft Delete Lab
export const softDeleteLabSchema = z.object({
  deletedAt: z
    .date()
    .optional()
    .default(() => new Date()),
});

/* =====================================================
   USER ↔ LAB ASSIGNMENT SCHEMAS
===================================================== */

// ✅ Assign User to Lab
export const assignUserToLabSchema = z.object({
  userId: z.string().uuid('Invalid user id'),
  labId: z.string().uuid('Invalid lab id'),
  clinicId: z.string().uuid('Invalid clinic id'),
});

// ✅ Update Assignment (future-proof)
export const updateUserLabAssignmentSchema = z
  .object({
    userId: z.string().uuid().optional(),
    labId: z.string().uuid().optional(),
    clinicId: z.string().uuid().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be updated',
  });

/* =====================================================
   PARAM / ID SCHEMAS (ROUTES)
===================================================== */

export const labIdParamSchema = z.object({
  labId: z.string().uuid(),
});

export const labIdRouteParamSchema = z.object({
  id: z.string().uuid('Invalid lab id'),
});

export const labTestIdParamSchema = z.object({
  testId: z.string().uuid('Invalid lab test id'),
});

export const createLabDepartmentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Department name must be at least 2 characters')
    .max(60, 'Department name must be 60 characters or fewer')
    .transform((value) => value.replace(/\s+/g, ' ')),
});

export const userLabAssignmentIdParamSchema = z.object({
  assignmentId: z.string().uuid(),
});

export const labOrderIdParamSchema = z.object({
  labOrderId: z.string().uuid('Invalid lab order id'),
});

export const labResultIdParamSchema = z.object({
  resultId: z.string().uuid('Invalid lab result id'),
});

export const labTemplateIdParamSchema = z.object({
  templateId: z.string().uuid('Invalid report template id'),
});

export const labCustomFieldIdParamSchema = z.object({
  fieldId: z.string().uuid('Invalid custom field id'),
});

export const labTemplateParameterIdParamSchema = z.object({
  parameterId: z.string().uuid('Invalid report template parameter id'),
});

export const labParameterInputTypeEnum = z.enum([
  'text',
  'number',
  'textarea',
  'select',
  'date',
  'boolean',
]);

const optionalNullableTrimmedString = (maxLength: number) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? null : value,
    z.string().trim().max(maxLength).nullable().optional()
  );

const labResultValueSchema = z.object({
  parameterId: z.string().uuid('Invalid parameter id'),
  value: z.preprocess((value) => {
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return value;
  }, z.string()),
});

export const saveLabResultSchema = z.object({
  templateId: z.string().uuid('templateId is required'),
  appointmentTestId: z.string().uuid('Invalid appointment test id').optional(),
  status: z.enum(['Draft', 'Completed']).optional().default('Completed'),
  remarks: z.string().trim().max(1000).optional(),
  values: z.array(labResultValueSchema).min(1, 'values array is required'),
});

export const updateLabResultSchema = z
  .object({
    status: z.enum(['Draft', 'Completed']).optional(),
    remarks: z.string().trim().max(1000).optional(),
    values: z
      .array(labResultValueSchema)
      .min(1, 'values array is required')
      .optional(),
  })
  .refine(
    (data) =>
      data.status !== undefined ||
      data.remarks !== undefined ||
      data.values !== undefined,
    {
      message: 'At least one field must be updated',
    }
  );

export const addLabCustomFieldSchema = z.object({
  sectionName: z.string().trim().min(1).max(255).optional().default('Custom'),
  parameterName: z.string().trim().min(1, 'parameterName is required').max(255),
  unit: z.string().trim().max(80).optional().default('-'),
  referenceRange: z.string().trim().max(255).optional().default('-'),
  inputType: labParameterInputTypeEnum.optional().default('text'),
  sortOrder: z.coerce.number().int().min(0).optional().default(100),
  isRequired: z.boolean().optional().default(false),
});

// Declared after addLabCustomFieldSchema because it embeds it.
export const createMyLabTestSchema = z.object({
  departmentId: z.string().uuid('Invalid department id'),
  testName: z.string().trim().min(1, 'testName is required').max(255),
  testCode: z.string().trim().max(100).optional().nullable(),
  sampleType: z.string().trim().min(1, 'sampleType is required').max(100),
  price: z.coerce.number().min(0, 'price cannot be negative'),
  status: labCatalogStatusEnumZod.optional().default('active'),
  masterTestId: z.string().uuid('Invalid master test id').optional().nullable(),
  // Result fields typed on the Add Test screen, saved with the test.
  customFields: z.array(addLabCustomFieldSchema).max(50).optional().default([]),
});

// A result field as sent from the Edit Test screen: `id` marks one that exists.
export const labCustomFieldSyncSchema = addLabCustomFieldSchema.extend({
  id: z.string().uuid('Invalid custom field id').optional(),
});

// Declared after labCustomFieldSyncSchema because it embeds it.
export const updateLabCatalogTestSchema = z
  .object({
    departmentId: z.string().uuid('Invalid department id').optional(),
    testName: z.string().trim().min(1).max(255).optional(),
    testCode: z.string().trim().max(100).optional().nullable(),
    sampleType: z.string().trim().min(1).max(100).optional(),
    price: z.coerce.number().min(0, 'price cannot be negative').optional(),
    status: labCatalogStatusEnumZod.optional(),
    masterTestId: z
      .string()
      .uuid('Invalid master test id')
      .optional()
      .nullable(),
    // The lab's full result-field list for this test; omit to leave it untouched.
    customFields: z.array(labCustomFieldSyncSchema).max(50).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be updated',
  });

export const updateLabCustomFieldSchema = z
  .object({
    sectionName: z.string().trim().min(1).max(255).optional(),
    parameterName: z.string().trim().min(1).max(255).optional(),
    unit: z.string().trim().max(80).optional(),
    referenceRange: z.string().trim().max(255).optional(),
    inputType: labParameterInputTypeEnum.optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
    isRequired: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be updated',
  });

export const overrideLabDefaultFieldSchema = z
  .object({
    templateId: z.string().uuid('templateId is required'),
    displayNameOverride: optionalNullableTrimmedString(255),
    unitOverride: optionalNullableTrimmedString(80),
    referenceRangeOverride: optionalNullableTrimmedString(255),
    inputTypeOverride: labParameterInputTypeEnum.nullable().optional(),
    sectionNameOverride: optionalNullableTrimmedString(255),
    sortOrderOverride: z.coerce.number().int().min(0).nullable().optional(),
    isRequiredOverride: z.boolean().nullable().optional(),
  })
  .refine((data) => Object.keys(data).some((key) => key !== 'templateId'), {
    message: 'At least one override field must be provided',
  });

// Normalize a missing/empty body (undefined | null) to {} so an empty PATCH
// does not fail at the root with "expected object, received undefined".
const emptyBodyToObject = (value: unknown) =>
  value === undefined || value === null ? {} : value;

// `templateId` is OPTIONAL on these three endpoints: the parameter is fully
// identified by :parameterId, and the backend derives the templateId from it.
// When the frontend does send { templateId }, it is validated against the
// parameter's real template and rejected on mismatch.
export const hideLabDefaultFieldSchema = z.preprocess(
  emptyBodyToObject,
  z.object({
    templateId: z.string().uuid('Invalid report template id').optional(),
    isHidden: z.boolean().optional().default(true),
  })
);

export const unhideLabDefaultFieldSchema = z.preprocess(
  emptyBodyToObject,
  z.object({
    templateId: z.string().uuid('Invalid report template id').optional(),
  })
);

export const resetLabDefaultFieldOverrideSchema = z.preprocess(
  emptyBodyToObject,
  z.object({
    templateId: z.string().uuid('Invalid report template id').optional(),
  })
);

/* =====================================================
   TYPES (INFERRED)
===================================================== */

export type CreateLabInput = z.infer<typeof createLabSchema>;
export type UpdateLabInput = z.infer<typeof updateLabSchema>;

export type CreateMyLabTestInput = z.infer<typeof createMyLabTestSchema>;
export type UpdateLabCatalogTestInput = z.infer<
  typeof updateLabCatalogTestSchema
>;
export type AssignUserToLabInput = z.infer<typeof assignUserToLabSchema>;
export type SaveLabResultInput = z.infer<typeof saveLabResultSchema>;
export type UpdateLabResultInput = z.infer<typeof updateLabResultSchema>;
export type AddLabCustomFieldInput = z.infer<typeof addLabCustomFieldSchema>;
export type LabCustomFieldSyncInput = z.infer<typeof labCustomFieldSyncSchema>;
export type UpdateLabCustomFieldInput = z.infer<
  typeof updateLabCustomFieldSchema
>;
export type OverrideLabDefaultFieldInput = z.infer<
  typeof overrideLabDefaultFieldSchema
>;
export type HideLabDefaultFieldInput = z.infer<
  typeof hideLabDefaultFieldSchema
>;
export type UnhideLabDefaultFieldInput = z.infer<
  typeof unhideLabDefaultFieldSchema
>;
export type ResetLabDefaultFieldOverrideInput = z.infer<
  typeof resetLabDefaultFieldOverrideSchema
>;

export const updateLabDepartmentsSchema = z.object({
  departmentIds: z.array(z.string().uuid('Invalid department id')),
  departmentTestIds: z
    .record(
      z.string().uuid('Invalid department id'),
      z.array(z.string().uuid('Invalid master test id'))
    )
    .optional(),
});

export type UpdateLabDepartmentsInput = z.infer<
  typeof updateLabDepartmentsSchema
>;

export const getMyLabCatalogQuerySchema = z.object({
  page: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.coerce.number().int().positive().optional().default(1)
  ),
  limit: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.coerce.number().int().positive().max(1000).optional().default(10)
  ),
  search: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().max(100).optional()
  ),
  status: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().optional()
  ),
  departmentId: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().uuid('Invalid department id').optional()
  ),
});

export const labReportTemplateSchema = z.object({
  templateName: z.enum(['template1', 'template2', 'template3', 'template4']),
  fontFamily: z.string().min(1),
  color1: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  color2: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  color3: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  color4: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  color5: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  color6: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  color7: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  color8: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  color9: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  color10: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
});

export type LabReportTemplateDto = z.infer<typeof labReportTemplateSchema>;
