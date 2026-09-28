import {
  normaliseMedicineForm,
  createMedicineSchema,
} from '../schemas/medine.schemas';

describe('normaliseMedicineForm', () => {
  it('collapses the case variants that would otherwise become separate forms', () => {
    for (const input of ['tablet', 'TABLET', 'TaBlEt', '  Tablet  ']) {
      expect(normaliseMedicineForm(input)).toBe('Tablet');
    }
  });

  it('title-cases every word of a multi-word form', () => {
    expect(normaliseMedicineForm('eye drops')).toBe('Eye Drops');
    expect(normaliseMedicineForm('NASAL SPRAY')).toBe('Nasal Spray');
    expect(normaliseMedicineForm('chewable  tablet')).toBe('Chewable Tablet');
  });

  it('capitalises after a hyphen or slash, not only after a space', () => {
    expect(normaliseMedicineForm('pre-filled syringe')).toBe(
      'Pre-Filled Syringe'
    );
    expect(normaliseMedicineForm('cream/gel')).toBe('Cream/Gel');
  });

  it('accepts a form outside any list — the point of not using an enum', () => {
    expect(normaliseMedicineForm('respule')).toBe('Respule');
    expect(normaliseMedicineForm('bottle')).toBe('Bottle');
  });

  it('returns empty for nothing usable, so the required check still fires', () => {
    expect(normaliseMedicineForm('')).toBe('');
    expect(normaliseMedicineForm('   ')).toBe('');
    expect(normaliseMedicineForm(null)).toBe('');
    expect(normaliseMedicineForm(undefined)).toBe('');
  });

  it('normalises through the create schema', () => {
    const result = createMedicineSchema.safeParse({
      name: 'Dolo 650',
      form: '  eye   DROPS ',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.form).toBe('Eye Drops');
  });

  it('still rejects a blank form', () => {
    expect(
      createMedicineSchema.safeParse({ name: 'X', form: '   ' }).success
    ).toBe(false);
  });
});
