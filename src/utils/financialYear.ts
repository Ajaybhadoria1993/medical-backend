const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Indian financial year (1 April – 31 March, IST) as "2026-27". */
export function financialYearOf(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const year =
    ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
}
