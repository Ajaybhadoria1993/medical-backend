import type { TemplatePreviewInput } from '../schemas/template.schema';
import type { TemplatePreview } from '../types/template.types';
import { fromPaise, toPaise } from './money.utils';
import { daysBetween, packageGaps, sampleDates } from './timing.utils';

/** Sample dates (every step on its earliest day), total price and length of a template. */
export function buildPreview(
  input: TemplatePreviewInput,
  start: string
): TemplatePreview {
  const isPackage = input.planType === 'package';
  const isReview = input.planType === 'review';
  const gaps =
    isPackage || isReview
      ? packageGaps(input.sessionCount ?? 0, input.intervalDays ?? 0)
      : input.steps.map((s) => s.gapDays);
  const dates = sampleDates(start, gaps).map((date, i) => ({
    seq: i + 1,
    name: isPackage
      ? `Session ${i + 1}`
      : isReview
        ? `Review ${i + 1}`
        : (input.steps[i].name ?? null),
    date,
  }));

  // A running total while fees are being entered; feesMissing says how many are still blank.
  let totalAmount: string | null;
  let feesMissing: number;
  if (input.pricingMode === 'package') {
    totalAmount = input.packagePrice ?? null;
    feesMissing = totalAmount === null ? 1 : 0;
  } else if (isReview) {
    // Same fee every review (Q28).
    const fee = input.steps[0]?.fee;
    totalAmount = fee != null ? fromPaise(toPaise(fee) * dates.length) : null;
    feesMissing = fee == null ? 1 : 0;
  } else {
    const priced = input.steps.filter((s) => s.fee != null);
    totalAmount = priced.length
      ? fromPaise(priced.reduce((sum, s) => sum + toPaise(s.fee!), 0))
      : null;
    feesMissing = input.steps.length - priced.length;
  }

  return {
    dates,
    totalAmount,
    feesMissing,
    durationDays: dates.length
      ? daysBetween(start, dates[dates.length - 1].date)
      : 0,
  };
}
