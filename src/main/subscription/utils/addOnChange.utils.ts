/** Quantity for the next period after a reduce; counts from what is already scheduled. */
export function reducedQuantity(
  quantity: number,
  scheduledQuantity: number | null,
  reduceBy: number
): number | null {
  const from = scheduledQuantity ?? quantity;
  if (reduceBy < 1 || reduceBy > from) return null;
  return from - reduceBy;
}

/** Seat accounts that will be over the limit once the change applies. */
export const seatExcess = (
  activeCount: number,
  currentLimit: number,
  unitsRemoved: number,
  unitValue: number
) =>
  Math.max(
    0,
    activeCount - Math.max(0, currentLimit - unitsRemoved * unitValue)
  );
