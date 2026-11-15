import { SPECIALTY_CATALOG } from '../../../utils/specialtyCatalog';
import {
  applySpecialtyOrder,
  isFullCatalogOrder,
} from '../utils/specialtyOrder.utils';

const names = SPECIALTY_CATALOG.map((g) => g.mainSpecialty);

describe('specialty order', () => {
  it('accepts only a full permutation of the catalog', () => {
    expect(isFullCatalogOrder([...names].reverse())).toBe(true);
    expect(isFullCatalogOrder(names.slice(1))).toBe(false);
    expect(isFullCatalogOrder([...names.slice(1), names[1]])).toBe(false);
    expect(isFullCatalogOrder([...names.slice(1), 'Astrologer'])).toBe(false);
  });

  it('puts saved names first and the rest in catalog order', () => {
    const sorted = applySpecialtyOrder(SPECIALTY_CATALOG, [names[2], names[0]]);
    expect(sorted.map((g) => g.mainSpecialty)).toEqual([
      names[2],
      names[0],
      ...names.filter((n) => n !== names[0] && n !== names[2]),
    ]);
  });
});
