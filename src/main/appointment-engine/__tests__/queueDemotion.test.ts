/**
 * Unit tests for late-arrival queue demotions.
 *
 * This decides who waits longer, so the invariants matter more than the
 * mechanics: an untouched queue must come back unchanged, nobody may be
 * demoted twice, and terminal appointments must not absorb a penalty — being
 * "moved back two places" past two cancelled slots would look like a punishment
 * in the data while changing nothing in the room.
 */

import { applyQueueDemotions } from '../utils/helpers';

type Row = {
  id: string;
  appointmentStatus: string;
  lateQueueDemotion?: number | null;
};

const row = (
  id: string,
  lateQueueDemotion = 0,
  appointmentStatus = 'Upcoming'
): Row => ({ id, appointmentStatus, lateQueueDemotion });

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

describe('applyQueueDemotions', () => {
  it('returns the queue untouched when nobody is late', () => {
    const queue = [row('a'), row('b'), row('c')];
    const out = applyQueueDemotions(queue);

    expect(ids(out)).toEqual(['a', 'b', 'c']);
    // Same array reference — a queue with no late arrivals must not pay for
    // this feature at all.
    expect(out).toBe(queue);
  });

  it('moves a late patient back by the configured number of places', () => {
    const out = applyQueueDemotions([
      row('a', 2),
      row('b'),
      row('c'),
      row('d'),
    ]);

    expect(ids(out)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves back by one', () => {
    const out = applyQueueDemotions([row('a', 1), row('b'), row('c')]);

    expect(ids(out)).toEqual(['b', 'a', 'c']);
  });

  it('lands at the end when the demotion exceeds the queue', () => {
    // This is how the "move to end" policy is expressed — an oversized count
    // rather than a separate concept in the reorder.
    const out = applyQueueDemotions([row('a', 999), row('b'), row('c')]);

    expect(ids(out)).toEqual(['b', 'c', 'a']);
  });

  it('does not count terminal appointments as places moved', () => {
    // Moving back two places past two cancelled slots would demote nobody in
    // practice while appearing, in the data, to have applied a penalty.
    const out = applyQueueDemotions([
      row('late', 2),
      row('x', 0, 'Cancelled'),
      row('y', 0, 'NoShow'),
      row('b'),
      row('c'),
      row('d'),
    ]);

    expect(ids(out)).toEqual(['x', 'y', 'b', 'c', 'late', 'd']);
  });

  it('never demotes the same appointment twice', () => {
    // The reorder revisits indices as rows slide forward. Without a guard the
    // moved appointment is seen again at its new position, demoted again, and
    // walks to the back of the queue one pass at a time.
    const out = applyQueueDemotions([
      row('a', 1),
      row('b'),
      row('c'),
      row('d'),
    ]);

    expect(ids(out)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('does not let two late patients cancel each other out', () => {
    // Both are late by one place. If a demotion counted *any* appointment, `a`
    // would step over `b` and `b` back over `a`, the two penalties would cancel,
    // and the queue would come back in its original order — a demotion visible
    // in the data and meaningless in the room.
    //
    // Only on-time patients count as places moved, so both end up behind `c`.
    const out = applyQueueDemotions([
      row('a', 1),
      row('b', 1),
      row('c'),
      row('d'),
    ]);

    expect(ids(out)).toEqual(['c', 'b', 'a', 'd']);
  });

  it('keeps the queue complete and unique whatever the input', () => {
    const queue = [row('a', 3), row('b'), row('c', 1), row('d'), row('e', 999)];
    const out = applyQueueDemotions(queue);

    expect(out).toHaveLength(5);
    expect(new Set(ids(out))).toEqual(new Set(['a', 'b', 'c', 'd', 'e']));
  });

  it('treats a null demotion as none', () => {
    const out = applyQueueDemotions([
      { id: 'a', appointmentStatus: 'Upcoming', lateQueueDemotion: null },
      row('b'),
    ]);

    expect(ids(out)).toEqual(['a', 'b']);
  });

  it('reads the engine-side `status` field as well as `appointmentStatus`', () => {
    // Queue entries arrive shaped both ways depending on the caller.
    const out = applyQueueDemotions([
      { id: 'late', status: 'Upcoming', lateQueueDemotion: 1 },
      { id: 'x', status: 'Cancelled', lateQueueDemotion: 0 },
      { id: 'b', status: 'Upcoming', lateQueueDemotion: 0 },
    ]);

    expect(ids(out)).toEqual(['x', 'b', 'late']);
  });
});
