/**
 * Unit tests for the tentative appointment time in the patient payload.
 *
 * The number itself is just `projectedStartTime` republished. What is worth
 * pinning down is the honesty around it: the band must widen with the queue
 * ahead, and `isTentative` must never be true without a time or false with one
 * — a client that renders the time as a commitment because the flag was
 * missing is the failure this field exists to prevent.
 */

import { buildPayloadFromQueue } from '../services/liveQueueHelper';
import { QueueDelayData } from '../types/engine.types';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const DATE = '2026-08-14';

function entry(over: Partial<QueueDelayData['appointments'][number]> = {}) {
  return {
    appointmentId: 'a1',
    patientId: 'p1',
    userId: 'u1',
    status: 'Upcoming' as QueueDelayData['appointments'][number]['status'],
    scheduledTime: '09:00',
    tokenNo: null,
    projectedStartTime: '09:00',
    estimatedWaitMinutes: 0,
    durationMinutes: 20,
    ...over,
  };
}

function queue(entries: Array<ReturnType<typeof entry>>): QueueDelayData {
  return {
    clinicId: CLINIC,
    doctorId: DOCTOR,
    date: DATE,
    cumulativeDelayMinutes: 0,
    lastCalculatedAt: new Date().toISOString(),
    appointments: entries,
  };
}

/** A queue of `n` 20-minute appointments; the caller picks which one is theirs. */
function queueOf(n: number) {
  return queue(
    Array.from({ length: n }, (_, i) =>
      entry({
        appointmentId: `a${i + 1}`,
        patientId: `p${i + 1}`,
        userId: `u${i + 1}`,
        scheduledTime: `09:${String(i * 20).padStart(2, '0')}`,
        projectedStartTime: `09:${String(i * 20).padStart(2, '0')}`,
      })
    )
  );
}

describe('tentative start time', () => {
  it('republishes the projected start', () => {
    const out = buildPayloadFromQueue(
      'a1',
      queue([entry({ projectedStartTime: '13:45' })])
    );

    expect(out.tentativeStartTime).toBe('13:45');
    expect(out.isTentative).toBe(true);
  });

  it('is withheld for a terminal appointment', () => {
    // Nothing left to predict for a completed visit.
    const out = buildPayloadFromQueue(
      'a1',
      queue([entry({ status: 'Completed', projectedStartTime: '13:45' })])
    );

    expect(out.tentativeStartTime).toBeNull();
    expect(out.tentativeRangeMinutes).toBeNull();
    expect(out.isTentative).toBe(false);
  });

  it('never claims to be tentative without a time', () => {
    // The unknown-appointment path: a client must not show a band around
    // nothing.
    const out = buildPayloadFromQueue('not-in-queue', queueOf(3));

    expect(out.tentativeStartTime).toBeNull();
    expect(out.isTentative).toBe(false);
  });
});

describe('confidence band', () => {
  const rangeFor = (position: number, size: number) =>
    buildPayloadFromQueue(`a${position + 1}`, queueOf(size))
      .tentativeRangeMinutes;

  it('is tightest for the patient who is next', () => {
    // No one ahead: only the irreducible base uncertainty.
    expect(rangeFor(0, 5)).toBe(5);
  });

  it('widens with each patient ahead', () => {
    // 20-minute consultations at a 0.25 ratio → +5 minutes per patient ahead.
    expect(rangeFor(1, 5)).toBe(10);
    expect(rangeFor(2, 5)).toBe(15);
    expect(rangeFor(4, 5)).toBe(25);
  });

  it('grows monotonically down the queue', () => {
    const ranges = [0, 1, 2, 3, 4].map((i) => rangeFor(i, 5) ?? 0);
    const sorted = [...ranges].sort((a, b) => a - b);

    expect(ranges).toEqual(sorted);
  });

  it('caps rather than growing without bound', () => {
    // A 60-patient queue must not tell someone "give or take five hours" —
    // past a point the band stops being information.
    expect(rangeFor(59, 60)).toBe(60);
  });
});
