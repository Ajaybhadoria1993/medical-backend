/** Cost of one unit including tax, as the 4-decimal string `numeric(10,4)` stores. */
export function unitCostWithTax(
  unitCostInr: string,
  taxPercent: string
): string {
  const cost = Number(unitCostInr) * (1 + Number(taxPercent) / 100);
  return cost.toFixed(4);
}
