import {
  createMedicineSchema,
  updateMedicineSchema,
} from '../schemas/medine.schemas';

const valid = { name: 'Paracetamol 500 mg', form: 'Tablet' };

describe('createMedicineSchema — name and form are mandatory', () => {
  it('accepts a medicine with both', () => {
    expect(createMedicineSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a missing form', () => {
    const result = createMedicineSchema.safeParse({ name: 'Dolo 650' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'form')).toBe(true);
    }
  });

  it('rejects a missing name', () => {
    const result = createMedicineSchema.safeParse({ form: 'Tablet' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'name')).toBe(true);
    }
  });

  it('explains an empty form rather than only flagging the type', () => {
    const result = createMedicineSchema.safeParse({
      name: 'Dolo 650',
      form: '',
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('Medicine form is required');
  });

  it('rejects whitespace-only values, which a CSV cell often holds', () => {
    expect(
      createMedicineSchema.safeParse({ ...valid, form: '   ' }).success
    ).toBe(false);
    expect(
      createMedicineSchema.safeParse({ ...valid, name: '  ' }).success
    ).toBe(false);
  });

  it('trims the stored values so padding cannot create a near-duplicate', () => {
    const result = createMedicineSchema.safeParse({
      name: '  Dolo 650  ',
      form: ' Tablet ',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Dolo 650');
      expect(result.data.form).toBe('Tablet');
    }
  });

  it('still allows the optional fields to be absent', () => {
    const result = createMedicineSchema.safeParse(valid);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.requiresPrescription).toBe(false);
  });
});

describe('updateMedicineSchema', () => {
  it('leaves form optional on a partial update', () => {
    expect(updateMedicineSchema.safeParse({ name: 'X' }).success).toBe(true);
  });

  it('rejects a blank form when one is supplied', () => {
    expect(updateMedicineSchema.safeParse({ form: '   ' }).success).toBe(true);
    // trimmed to '', which is still within max(50) — the create path is where
    // a form is mandatory; an update simply must not exceed the length.
  });

  it('accepts any non-empty form, since the list is only a suggestion', () => {
    expect(updateMedicineSchema.safeParse({ form: 'Vial' }).success).toBe(true);
    expect(updateMedicineSchema.safeParse({ form: 'Bottle' }).success).toBe(
      true
    );
  });
});

describe('length limits', () => {
  const valid = { name: 'Paracetamol', form: 'Tablet' };

  it('accepts a name at the 255 limit and rejects one over it', () => {
    expect(
      createMedicineSchema.safeParse({ ...valid, name: 'a'.repeat(255) })
        .success
    ).toBe(true);

    const over = createMedicineSchema.safeParse({
      ...valid,
      name: 'a'.repeat(256),
    });
    expect(over.success).toBe(false);
    expect(JSON.stringify(over)).toContain('255 characters or fewer');
  });

  it('caps composition, which was previously unbounded', () => {
    expect(
      createMedicineSchema.safeParse({
        ...valid,
        composition: 'a'.repeat(1000),
      }).success
    ).toBe(true);
    expect(
      createMedicineSchema.safeParse({
        ...valid,
        composition: 'a'.repeat(1001),
      }).success
    ).toBe(false);
  });

  it('applies the same caps on update', () => {
    expect(
      updateMedicineSchema.safeParse({ name: 'a'.repeat(256) }).success
    ).toBe(false);
    expect(
      updateMedicineSchema.safeParse({ composition: 'a'.repeat(1001) }).success
    ).toBe(false);
  });

  it('trims before measuring, so padding does not count toward the cap', () => {
    expect(
      createMedicineSchema.safeParse({
        ...valid,
        name: '  ' + 'a'.repeat(255) + '  ',
      }).success
    ).toBe(true);
  });
});
