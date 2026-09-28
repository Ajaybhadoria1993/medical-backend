/**
 * Unit tests for the two entry points into day-segment resolution.
 *
 * `resolveDaySegments` must keep returning null for a token doctor — the
 * slot-grid features (extra slots, missed slots, slot config) read it and have
 * no grid to work with — while `resolveDaySegmentsForTokens` must return that
 * doctor's real blocks, because "which session is this token in?" is exactly
 * the question shift-wise numbering has to answer.
 *
 * The split-shift case is the one that matters: a weekly row is a single
 * window, and a doctor's morning and evening clinics exist only as the gap a
 * break carves out of it.
 */

jest.mock('../services/queueHoldStore.service', () => ({
  // Reception's promotions, which the projection now walks in the same order.
  getNextAppointmentIds: jest.fn().mockResolvedValue([]),
  getCurrentAppointmentId: jest.fn().mockResolvedValue(null),
}));

import { ScheduleShiftService } from '../services/scheduleShift.service';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const DATE = '2026-08-14'; // a Friday

/**
 * A drizzle-shaped executor handing back queued results in order.
 *
 * Resolution reads in a fixed sequence — the date row, then (when there is
 * none) the weekly row and its breaks — so a FIFO queue stands in for the
 * database without pulling one up.
 */
function executorReturning(results: unknown[][]) {
  const queue = [...results];
  const builder = () => {
    const chain: Record<string, unknown> = {};
    const step = () => chain;
    chain.from = step;
    chain.leftJoin = step;
    chain.orderBy = step;
    chain.limit = step;
    chain.where = () => Promise.resolve(queue.shift() ?? []);
    return chain;
  };
  return { select: builder } as never;
}

/** No date-specific row, so resolution falls through to the weekly template. */
const NO_DATE_ROW: unknown[] = [];

const weeklyRow = (over: Record<string, unknown> = {}) => ({
  id: 'avail-1',
  isAvailable: true,
  startTime: '09:00 AM',
  endTime: '09:00 PM',
  breaksStart: null,
  breaksEnd: null,
  slotMinutes: 15,
  stepMinutes: 15,
  noOfPatients: null,
  ...over,
});

/** 09:00–21:00 with a 13:00–17:00 break: a morning and an evening clinic. */
const SPLIT_BREAKS = [{ startTime: '01:00 PM', endTime: '05:00 PM' }];

describe('resolveDaySegments vs resolveDaySegmentsForTokens', () => {
  it('resolves a time-based doctor identically through both entry points', async () => {
    const gridDay = await ScheduleShiftService.resolveDaySegments(
      executorReturning([NO_DATE_ROW, [weeklyRow()], SPLIT_BREAKS]),
      CLINIC,
      DOCTOR,
      DATE
    );

    const tokenDay = await ScheduleShiftService.resolveDaySegmentsForTokens(
      executorReturning([NO_DATE_ROW, [weeklyRow()], SPLIT_BREAKS]),
      CLINIC,
      DOCTOR,
      DATE
    );

    expect(gridDay?.segments).toEqual([
      { start: 9 * 60, end: 13 * 60 },
      { start: 17 * 60, end: 21 * 60 },
    ]);
    // The flag must change nothing for a doctor who was never gated.
    expect(tokenDay).toEqual(gridDay);
  });

  it('keeps a token doctor invisible to the slot-grid entry point', async () => {
    const day = await ScheduleShiftService.resolveDaySegments(
      executorReturning([
        NO_DATE_ROW,
        [weeklyRow({ noOfPatients: 20 })],
        SPLIT_BREAKS,
      ]),
      CLINIC,
      DOCTOR,
      DATE
    );

    expect(day).toBeNull();
  });

  it("gives the token entry point a token doctor's split shift", async () => {
    const day = await ScheduleShiftService.resolveDaySegmentsForTokens(
      executorReturning([
        NO_DATE_ROW,
        [weeklyRow({ noOfPatients: 20 })],
        SPLIT_BREAKS,
      ]),
      CLINIC,
      DOCTOR,
      DATE
    );

    // Two blocks, sorted, so the morning is session 1 and the evening session 2
    // — the ordinal appointments.sessionIndex stores.
    expect(day?.segments).toEqual([
      { start: 9 * 60, end: 13 * 60 },
      { start: 17 * 60, end: 21 * 60 },
    ]);
  });

  it('gives a single-session token doctor exactly one segment', async () => {
    const day = await ScheduleShiftService.resolveDaySegmentsForTokens(
      executorReturning([NO_DATE_ROW, [weeklyRow({ noOfPatients: 20 })], []]),
      CLINIC,
      DOCTOR,
      DATE
    );

    expect(day?.segments).toEqual([{ start: 9 * 60, end: 21 * 60 }]);
  });

  it('still refuses a day the doctor is not available on', async () => {
    const day = await ScheduleShiftService.resolveDaySegmentsForTokens(
      executorReturning([
        NO_DATE_ROW,
        [weeklyRow({ noOfPatients: 20, isAvailable: false })],
        [],
      ]),
      CLINIC,
      DOCTOR,
      DATE
    );

    // Token mode is not a reason to book into a day the doctor does not work.
    expect(day).toBeNull();
  });
});
