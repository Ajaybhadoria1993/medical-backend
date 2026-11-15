import type { FieldDef } from '../types/specialty.types';
import { buildSpecialtyDataSchema } from '../utils/specialtyFields.utils';

const fields: FieldDef[] = [
  {
    key: 'tooth',
    label: 'Tooth number',
    type: 'number',
    min: 11,
    max: 48,
    required: true,
  },
  {
    key: 'material',
    label: 'Crown material',
    type: 'select',
    options: ['PFM', 'Zirconia'],
    required: false,
  },
  {
    key: 'areas',
    label: 'Body areas',
    type: 'multiselect',
    options: ['Face', 'Arms'],
    required: false,
  },
];

describe('buildSpecialtyDataSchema', () => {
  const schema = buildSpecialtyDataSchema(fields);

  it('accepts valid values and leaves optional ones out', () => {
    expect(schema.safeParse({ tooth: 36 }).success).toBe(true);
    expect(
      schema.safeParse({ tooth: 36, material: 'Zirconia', areas: ['Face'] })
        .success
    ).toBe(true);
  });

  it('refuses a number outside min/max with a how-to-fix message (S3)', () => {
    const result = schema.safeParse({ tooth: 50 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(
      'Tooth number: enter at most 48'
    );
  });

  it('refuses a missing required field, a wrong type and an unknown option', () => {
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ tooth: '36' }).success).toBe(false);
    expect(schema.safeParse({ tooth: 36, material: 'Gold' }).success).toBe(
      false
    );
  });

  it('refuses keys the specialty does not define', () => {
    expect(schema.safeParse({ tooth: 36, colour: 'A2' }).success).toBe(false);
  });

  it('with no fields, accepts only an empty object (S1)', () => {
    const empty = buildSpecialtyDataSchema([]);
    expect(empty.safeParse({}).success).toBe(true);
    expect(empty.safeParse({ tooth: 36 }).success).toBe(false);
  });
});
