/** IST calendar day (YYYY-MM-DD) plus n days; date-only maths, so no time zone shift. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole days from one IST day to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000
  );
}

/** Earliest date of each step when every step is booked on its earliest day (DEV_PLAN §5). */
export function sampleDates(start: string, gaps: number[]): string[] {
  const dates: string[] = [];
  let anchor = start;
  for (const gap of gaps) {
    anchor = addDays(anchor, gap);
    dates.push(anchor);
  }
  return dates;
}

/** Package sessions are steps sharing one gap; the first session is on the start day. */
export function packageGaps(sessionCount: number, intervalDays: number) {
  return Array.from({ length: sessionCount }, (_, i) =>
    i === 0 ? 0 : intervalDays
  );
}

/** What the timing rule needs from one step, in order. Days are IST YYYY-MM-DD. */
export interface StepTiming {
  gapDays: number;
  status: string;
  /** The day the step was done, if it was. */
  doneOn: string | null;
  /** The day of its live booking, if it has one. */
  bookedOn: string | null;
}

/** DEV_PLAN §5: earliest(1) = start + gap; earliest(n) = anchor(n-1) + gap(n), where the anchor
 *  is the day the step was done, else its booked day, else none (later steps not bookable yet).
 *  A skipped step anchors on its own earliest day so it never blocks the rest. */
export function earliestDates(
  start: string,
  steps: StepTiming[]
): (string | null)[] {
  let anchor: string | null = start;
  return steps.map((s, i) => {
    // Step 1 is the "First visit": bookable from the start day, whatever gap was saved on it.
    const earliest: string | null =
      anchor === null ? null : addDays(anchor, i === 0 ? 0 : s.gapDays);
    anchor =
      s.doneOn ?? s.bookedOn ?? (s.status === 'skipped' ? earliest : null);
    return earliest;
  });
}

/** The last on-time day of each step: the step before's anchor (as earliestDates) plus its "late after"
 *  days; null for step 1, a step with no limit, or one whose step before has no day yet. */
export function lateAfterDates(
  start: string,
  steps: (StepTiming & { maxGapDays: number | null })[]
): (string | null)[] {
  const earliest = earliestDates(start, steps);
  return steps.map((s, i) => {
    if (i === 0 || s.maxGapDays == null) return null;
    const prev = steps[i - 1];
    const anchor =
      prev.doneOn ??
      prev.bookedOn ??
      (prev.status === 'skipped' ? earliest[i - 1] : null);
    return anchor ? addDays(anchor, s.maxGapDays) : null;
  });
}
