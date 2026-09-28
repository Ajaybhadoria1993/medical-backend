import { getMedicineFormPrefix } from '../handlebarsHelpers';

describe('getMedicineFormPrefix', () => {
  it('uses the standard abbreviation for a known form', () => {
    expect(getMedicineFormPrefix('Tablet')).toBe('Tab.');
  });

  it('abbreviates a variant by its base form', () => {
    expect(getMedicineFormPrefix('Effervescent Tablet')).toBe('Tab.');
    expect(getMedicineFormPrefix('oral suspension')).toBe('Susp.');
  });

  it('falls back to the title-cased form when no abbreviation exists', () => {
    expect(getMedicineFormPrefix('eye drops')).toBe('Eye Drops');
    expect(getMedicineFormPrefix('')).toBe('');
  });
});
