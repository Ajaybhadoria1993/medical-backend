export interface AddOnRenewalQuantityInput {
  quantity: number;
  cancelAtPeriodEnd?: boolean | null;
  scheduledReductionBy?: number | null;
}

/**
 * Quantity that should be billed and carried into the next subscription period.
 * The current quantity remains usable until the paid period ends.
 */
export function addOnRenewalQuantity({
  quantity,
  cancelAtPeriodEnd,
  scheduledReductionBy,
}: AddOnRenewalQuantityInput): number {
  if (cancelAtPeriodEnd) return 0;

  const reduction = Math.max(0, scheduledReductionBy ?? 0);
  return Math.max(0, quantity - reduction);
}

/** Maximum renewable units allowed by a plan's add-on cap.
 * `undefined` means the add-on is not available; `null` means unlimited.
 * maxCap is capacity (for example MB for storage), while quantity is units.
 */
export function capAddOnRenewalQuantity(
  quantity: number,
  unitValue: number,
  maxCap: number | null | undefined
): number {
  if (maxCap === null) return Math.max(0, quantity);
  if (maxCap === undefined || maxCap <= 0) return 0;
  return Math.min(
    Math.max(0, quantity),
    Math.floor(maxCap / Math.max(1, unitValue))
  );
}
