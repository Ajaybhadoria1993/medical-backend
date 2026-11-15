/** What a captured renewal keeps from the clinic's scheduled changes; changes made after the charge wait a period. */
export function renewalCaptureFields(input: {
  cancelAtPeriodEnd: boolean;
  cancelledAt: Date | null;
  scheduledPlanId: string | null;
  /** True when this renewal paid for the scheduled plan (the switch happens with it). */
  switching: boolean;
  /** When the renewal was priced and sent (the payment row's createdAt). */
  chargedAt: Date;
  /** End of the period this renewal pays for. */
  periodEnd: Date;
}) {
  // A cancel from before the charge is withdrawn by paying; one made after it ends this new period.
  const cancelAfterCharge =
    input.cancelAtPeriodEnd &&
    !!input.cancelledAt &&
    input.cancelledAt > input.chargedAt;
  return {
    ...(cancelAfterCharge
      ? {}
      : {
          cancelAtPeriodEnd: false,
          cancelledAt: null,
          cancellationReason: null,
        }),
    // A downgrade not paid for by this renewal moves to the end of the period just paid for.
    ...(input.scheduledPlanId && !input.switching
      ? { scheduledChangeAt: input.periodEnd }
      : {}),
  };
}
