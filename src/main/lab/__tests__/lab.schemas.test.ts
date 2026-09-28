// Request validation for Add/Edit Lab Test: department names and result fields.

import {
  createLabDepartmentSchema,
  createMyLabTestSchema,
  updateLabCatalogTestSchema,
} from '../schemas/lab.schemas';

const DEPARTMENT_ID = '3f1c2a4e-8b7d-4c1a-9e2f-5a6b7c8d9e0f';
const FIELD_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

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
