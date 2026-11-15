import { SPECIALTY_CATALOG } from '../../../utils/specialtyCatalog';

const CATALOG_NAMES = SPECIALTY_CATALOG.map((g) => g.mainSpecialty);

/** True when `order` lists every catalog main speciality exactly once and nothing else. */
export const isFullCatalogOrder = (order: readonly string[]) =>
  order.length === CATALOG_NAMES.length &&
  new Set(order).size === order.length &&
  order.every((name) => CATALOG_NAMES.includes(name));

/** Sorts groups by the saved order; names missing from it keep catalog order at the end. */
export const applySpecialtyOrder = <T extends { mainSpecialty: string }>(
  groups: readonly T[],
  order: readonly string[]
): T[] => {
  const rank = (name: string) => {
    const i = order.indexOf(name);
    return i === -1 ? order.length + CATALOG_NAMES.indexOf(name) : i;
  };
  return [...groups].sort(
    (a, b) => rank(a.mainSpecialty) - rank(b.mainSpecialty)
  );
};
