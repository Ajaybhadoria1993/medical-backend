/** Razorpay's default bank payout schedule: T+2 working days. */
const BANK_DAYS = 2;

/** Indian bank day: not Sunday, 2nd or 4th Saturday; public holidays are not known here. */
function isBankWorkingDay(d: Date): boolean {
  const day = d.getUTCDay();
  const week = Math.ceil(d.getUTCDate() / 7);
  return day !== 0 && !(day === 6 && (week === 2 || week === 4));
}

/** Expected payout date for a capture day (YYYY-MM-DD): same day for UPI, else T+2 bank days. */
export function expectedPayoutDate(
  captureDay: string,
  paysToUpi: boolean
): Date {
  const d = new Date(captureDay + 'T12:00:00Z');
  for (let left = paysToUpi ? 0 : BANK_DAYS; left > 0;) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isBankWorkingDay(d)) left -= 1;
  }
  return d;
}
