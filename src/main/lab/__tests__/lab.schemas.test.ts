// Request validation for Add/Edit Lab Test: department names and result fields.

import {
  createLabDepartmentSchema,
  createLabTestPackageSchema,
  createMyLabTestSchema,
  getLabDepartmentsQuerySchema,
  getLabTestPackagesQuerySchema,
  updateLabDepartmentSchema,
  updateLabTestPackageSchema,
  updateLabCatalogTestSchema,
} from '../schemas/lab.schemas';
import { updateLabTestSchema } from '../schemas/labTests.schemas';
import { updateLabTestResultParameterSchema } from '../schemas/labTestResultParameters.schemas';

const DEPARTMENT_ID = '3f1c2a4e-8b7d-4c1a-9e2f-5a6b7c8d9e0f';
const FIELD_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LAB_TEST_ID = '1f1c2a4e-8b7d-4c1a-9e2f-5a6b7c8d9e0f';
const SECOND_LAB_TEST_ID = '2f1c2a4e-8b7d-4c1a-9e2f-5a6b7c8d9e0f';

const newTest = {
  departmentId: DEPARTMENT_ID,
  testName: 'Complete blood count',
  sampleType: 'Blood',
  price: 250,
};

describe('createLabDepartmentSchema', () => {
  it('trims the name and collapses repeated spaces', () => {
    expect(createLabDepartmentSchema.parse({ name: '  Uro   logy ' })).toEqual({
      name: 'Uro logy',
    });
  });

  it('rejects names shorter than 2 or longer than 60 characters', () => {
    expect(createLabDepartmentSchema.safeParse({ name: 'U' }).success).toBe(
      false
    );
    expect(
      createLabDepartmentSchema.safeParse({ name: 'U'.repeat(61) }).success
    ).toBe(false);
  });
});

describe('updateLabDepartmentSchema', () => {
  it('allows updating name and status', () => {
    expect(
      updateLabDepartmentSchema.parse({
        name: '  Radio   logy ',
        status: 'active',
      })
    ).toEqual({
      name: 'Radio logy',
      status: 'active',
    });
  });

  it('requires at least one field', () => {
    expect(updateLabDepartmentSchema.safeParse({}).success).toBe(false);
  });
});

describe('lab catalog partial update schemas', () => {
  it('does not add create defaults to partial lab test updates', () => {
    expect(updateLabTestSchema.parse({ method: 'X' })).toEqual({ method: 'X' });
  });

  it('does not add create defaults to partial result parameter updates', () => {
    expect(
      updateLabTestResultParameterSchema.parse({ isActive: false })
    ).toEqual({ isActive: false });
  });
});

describe('getLabDepartmentsQuerySchema', () => {
  it('parses optional page, limit, and status query params', () => {
    expect(getLabDepartmentsQuerySchema.parse({})).toEqual({});

    expect(
      getLabDepartmentsQuerySchema.parse({
        page: '2',
        limit: '25',
        status: 'inactive',
      })
    ).toEqual({
      page: 2,
      limit: 25,
      status: 'inactive',
    });
  });

  it('rejects invalid department pagination params', () => {
    expect(getLabDepartmentsQuerySchema.safeParse({ page: '0' }).success).toBe(
      false
    );
    expect(
      getLabDepartmentsQuerySchema.safeParse({ limit: '101' }).success
    ).toBe(false);
    expect(
      getLabDepartmentsQuerySchema.safeParse({ status: 'blocked' }).success
    ).toBe(false);
  });
});

describe('createMyLabTestSchema', () => {
  it('defaults result fields to an empty list', () => {
    expect(createMyLabTestSchema.parse(newTest).customFields).toEqual([]);
  });

  it('fills the same defaults as Manage Fields for each result field', () => {
    const [field] = createMyLabTestSchema.parse({
      ...newTest,
      customFields: [{ parameterName: 'Haemoglobin' }],
    }).customFields;

    expect(field).toMatchObject({
      parameterName: 'Haemoglobin',
      unit: '-',
      referenceRange: '-',
      inputType: 'text',
      isRequired: false,
    });
  });

  it('caps a test at 50 result fields', () => {
    const customFields = Array.from({ length: 51 }, (_, i) => ({
      parameterName: `Field ${i}`,
    }));
    expect(
      createMyLabTestSchema.safeParse({ ...newTest, customFields }).success
    ).toBe(false);
  });
});

describe('updateLabCatalogTestSchema', () => {
  it('accepts existing fields (with an id) alongside new ones', () => {
    const parsed = updateLabCatalogTestSchema.parse({
      customFields: [
        { id: FIELD_ID, parameterName: 'Haemoglobin' },
        { parameterName: 'RBC' },
      ],
    });

    expect(parsed.customFields?.[0]).toMatchObject({ id: FIELD_ID });
    expect(parsed.customFields?.[1]).not.toHaveProperty('id');
  });

  it('rejects a field id that is not a uuid', () => {
    expect(
      updateLabCatalogTestSchema.safeParse({
        customFields: [{ id: 'not-a-uuid', parameterName: 'Haemoglobin' }],
      }).success
    ).toBe(false);
  });

  it('leaves customFields undefined when omitted, so saved fields are untouched', () => {
    expect(
      updateLabCatalogTestSchema.parse({ price: 300 }).customFields
    ).toBeUndefined();
  });
});

describe('lab test package schemas', () => {
  const createPackagePayload = {
    packageName: 'Full Body Package',
    packageCode: 'fbp-2026',
    packageDescription: 'Includes common lab screening tests',
    packagePrice: 999,
    labTest: [LAB_TEST_ID, SECOND_LAB_TEST_ID],
  };

  it('accepts create payloads and uppercases packageCode', () => {
    const parsed = createLabTestPackageSchema.parse(createPackagePayload);

    expect(parsed).toMatchObject({
      packageCode: 'FBP-2026',
      status: 'Active',
      labTest: [LAB_TEST_ID, SECOND_LAB_TEST_ID],
    });
  });

  it('allows packageName up to 50 and packageCode up to 30 characters', () => {
    const parsed = createLabTestPackageSchema.parse({
      ...createPackagePayload,
      packageName: 'P'.repeat(50),
      packageCode: 'C'.repeat(30),
    });

    expect(parsed.packageName).toHaveLength(50);
    expect(parsed.packageCode).toHaveLength(30);
  });

  it('rejects packageName above 50 and packageCode above 30 characters', () => {
    expect(
      createLabTestPackageSchema.safeParse({
        ...createPackagePayload,
        packageName: 'P'.repeat(51),
      }).success
    ).toBe(false);

    expect(
      createLabTestPackageSchema.safeParse({
        ...createPackagePayload,
        packageCode: 'C'.repeat(31),
      }).success
    ).toBe(false);
  });

  it('requires at least one lab test id and caps packagePrice at 1000000', () => {
    expect(
      createLabTestPackageSchema.safeParse({
        ...createPackagePayload,
        labTest: [],
      }).success
    ).toBe(false);

    expect(
      createLabTestPackageSchema.safeParse({
        ...createPackagePayload,
        packagePrice: 1000001,
      }).success
    ).toBe(false);
  });

  it('accepts partial update payloads and parses deletedAt=true for soft delete', () => {
    const updateParsed = updateLabTestPackageSchema.parse({
      packageName: 'Updated package',
      packageCode: 'upd-1',
      labTest: [LAB_TEST_ID],
    });

    expect(updateParsed).toMatchObject({
      packageName: 'Updated package',
      packageCode: 'UPD-1',
      labTest: [LAB_TEST_ID],
    });

    const deleteParsed = updateLabTestPackageSchema.parse({ deletedAt: true });
    expect(deleteParsed.deletedAt).toBeInstanceOf(Date);
  });

  it('parses list query pagination, search, and status filters', () => {
    expect(getLabTestPackagesQuerySchema.parse({})).toEqual({
      page: 1,
      limit: 10,
    });

    expect(
      getLabTestPackagesQuerySchema.parse({
        page: '2',
        limit: '25',
        search: '  body ',
        status: 'Active',
      })
    ).toEqual({
      page: 2,
      limit: 25,
      search: 'body',
      status: 'Active',
    });

    expect(
      getLabTestPackagesQuerySchema.safeParse({ limit: '101' }).success
    ).toBe(false);

    expect(
      getLabTestPackagesQuerySchema.safeParse({ status: 'Deleted' }).success
    ).toBe(false);
  });
});
