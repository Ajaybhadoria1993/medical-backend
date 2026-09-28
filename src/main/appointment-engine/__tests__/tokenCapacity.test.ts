/**
 * Unit tests for per-shift token capacity.
 *
 * Capacity used to be a single `clinic_availability.noOfPatients` for the whole
 * day, which cannot express "10 tokens in the morning, 20 in the evening" —
 * a doctor running two clinics of different sizes had no way to say so.
 *
 * Resolution now runs most-specific first: a same-day session override, then a
 * standing per-shift number on the date's own time-slot row, then the weekly
 * number applied **per shift**.
 */

jest.mock('../../../utils/istDateTime', () => {
  const actual = jest.requireActual('../../../utils/istDateTime');
  return { ...actual, getISTDayName: () => 'Friday' };
});

import { TokenCapacityService } from '../services/tokenCapacity.service';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const DATE = '2026-08-14';

/**
 * A drizzle-shaped executor handing back queued results in order.
 *
 * Resolution reads in a fixed sequence — the session override, then the
 * time-slot row when the segment has one, then the weekly row — so a FIFO
 * queue stands in for the database.
 */
function executorReturning(results: unknown[][]) {
  const queue = [...results];
  const builder = () => {
    const chain: Record<string, unknown> = {};
    const step = () => chain;
    chain.from = step;
    chain.orderBy = step;
    chain.limit = () => Promise.resolve(queue.shift() ?? []);
    chain.where = () => {
      // `.limit()` ends the override query; everything else ends at `.where()`.
      const result = queue.shift() ?? [];
      const thenable = Promise.resolve(result) as unknown as Record<
        string,
        unknown
      >;
      thenable.orderBy = () => ({ limit: () => Promise.resolve(result) });
      return thenable;
    };
    return chain;
  };
  return { select: builder } as never;
}

const NONE: unknown[] = [];

describe('resolving a session"s token capacity', () => {
  it('takes a same-day session override over anything standing', async () => {
    const resolved = await TokenCapacityService.resolveForSession(
      CLINIC,
      DOCTOR,
      DATE,
      '17:00',
      'slot-2',
      executorReturning([
        [{ noOfPatients: 5 }], // override for this session
        [{ noOfPatients: 20 }], // standing per-shift, ignored
        [{ noOfPatients: 30 }], // weekly, ignored
      ])
    );

    expect(resolved).toEqual({ capacity: 5, source: 'session_override' });
  });

  it('falls back to the shift"s own standing capacity', async () => {
    const resolved = await TokenCapacityService.resolveForSession(
      CLINIC,
      DOCTOR,
      DATE,
      '17:00',
      'slot-2',
      executorReturning([NONE, [{ noOfPatients: 20 }], [{ noOfPatients: 30 }]])
    );

    expect(resolved).toEqual({ capacity: 20, source: 'date_time_slot' });
  });

  it('uses the doctor"s standing per-shift capacity for the weekday', async () => {
    // The recurring form of 20/30: set once, applies every Monday, so it does
    // not have to be re-entered per date.
    const resolved = await TokenCapacityService.resolveForSession(
      CLINIC,
      DOCTOR,
      DATE,
      '17:00',
      undefined,
      executorReturning([
        NONE, // no same-day override
        [{ noOfPatients: 30 }], // standing weekly capacity for this shift
        [{ noOfPatients: 20 }], // day-wide number, outranked
      ]),
      2
    );

    expect(resolved).toEqual({ capacity: 30, source: 'weekly_shift' });
  });

  it('prefers this date"s shift over the standing weekly one', async () => {
    // A one-off change to a single date must win over the usual pattern.
    const resolved = await TokenCapacityService.resolveForSession(
      CLINIC,
      DOCTOR,
      DATE,
      '17:00',
      'slot-2',
      executorReturning([
        NONE,
        [{ noOfPatients: 12 }], // this date's shift
        [{ noOfPatients: 30 }], // standing weekly, outranked
      ]),
      2
    );

    expect(resolved).toEqual({ capacity: 12, source: 'date_time_slot' });
  });

  it('skips the weekly-shift step when no session is given', async () => {
    // Callers predating per-shift capacity pass no session and must keep
    // falling through to the day-wide number.
    const resolved = await TokenCapacityService.resolveForSession(
      CLINIC,
      DOCTOR,
      DATE,
      '17:00',
      undefined,
      executorReturning([NONE, [{ noOfPatients: 20 }]])
    );

    expect(resolved).toEqual({ capacity: 20, source: 'weekly' });
  });

  it('falls back to the weekly number when the shift sets none', async () => {
    const resolved = await TokenCapacityService.resolveForSession(
      CLINIC,
      DOCTOR,
      DATE,
      '09:00',
      'slot-1',
      executorReturning([NONE, NONE, [{ noOfPatients: 30 }]])
    );

    expect(resolved).toEqual({ capacity: 30, source: 'weekly' });
  });

  it('reports no capacity when the doctor is not on tokens', async () => {
    const resolved = await TokenCapacityService.resolveForSession(
      CLINIC,
      DOCTOR,
      DATE,
      '09:00',
      undefined,
      executorReturning([NONE, [{ noOfPatients: null }]])
    );

    expect(resolved).toEqual({ capacity: 0, source: 'none' });
  });

  it('gives a split-shift day 10 in the morning and 20 in the evening', async () => {
    // The requirement this feature exists for: two clinics of different sizes
    // on one day, each numbering its own tokens from 1.
    const morning = await TokenCapacityService.resolveForSession(
      CLINIC,
      DOCTOR,
      DATE,
      '09:00',
      'slot-1',
      executorReturning([NONE, [{ noOfPatients: 10 }]])
    );

    const evening = await TokenCapacityService.resolveForSession(
      CLINIC,
      DOCTOR,
      DATE,
      '17:00',
      'slot-2',
      executorReturning([NONE, [{ noOfPatients: 20 }]])
    );

    expect(morning.capacity).toBe(10);
    expect(evening.capacity).toBe(20);
  });

  it('gives a 10:00 shift 20 tokens and a 17:00 shift 30', async () => {
    // The configuration this feature was asked for: two clinics on one day
    // with different sizes, each numbering 1..N from its own start.
    const morning = await TokenCapacityService.resolveForSession(
      CLINIC,
      DOCTOR,
      DATE,
      '10:00',
      'slot-morning',
      executorReturning([NONE, [{ noOfPatients: 20 }]])
    );

    const evening = await TokenCapacityService.resolveForSession(
      CLINIC,
      DOCTOR,
      DATE,
      '17:00',
      'slot-evening',
      executorReturning([NONE, [{ noOfPatients: 30 }]])
    );

    expect(morning).toEqual({ capacity: 20, source: 'date_time_slot' });
    expect(evening).toEqual({ capacity: 30, source: 'date_time_slot' });
  });

  it('applies the weekly number per shift, not split across the day', async () => {
    // A doctor set to 20 on a split-shift day holds 20 in the morning AND 20 in
    // the evening. The number describes how many patients they see in a
    // sitting, and a split-shift day is two sittings.
    const morning = await TokenCapacityService.resolveForSession(
      CLINIC,
      DOCTOR,
      DATE,
      '09:00',
      undefined,
      executorReturning([NONE, [{ noOfPatients: 20 }]])
    );

    const evening = await TokenCapacityService.resolveForSession(
      CLINIC,
      DOCTOR,
      DATE,
      '17:00',
      undefined,
      executorReturning([NONE, [{ noOfPatients: 20 }]])
    );

    expect(morning.capacity).toBe(20);
    expect(evening.capacity).toBe(20);
  });
});
