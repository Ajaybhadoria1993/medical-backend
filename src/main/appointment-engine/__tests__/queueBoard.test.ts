/**
 * Queue classification tests.
 *
 * These encode the requirement directly: after the doctor completes A, with B
 * held and C sent in, the board must read A completed / B on hold / C with the
 * doctor — and, critically, B must never be offered as "next" while held.
 *
 * The rules live in a pure function precisely so they can be asserted without
 * a database, because the previous implementation (`find(status ===
 * 'Confirmed')`) had no way to be tested at all.
 */

import {
  buildBoard,
  orderLikeBoard,
  type BoardInput,
} from '../utils/queueBoard';
import type { HoldReason } from '../services/queueHoldStore.service';

const CLINIC = 'clinic-7';
const DOCTOR = 'doctor-3';
const DATE = '2026-08-21';

const names = new Map([
  ['p-a', 'Patient A'],
  ['p-b', 'Patient B'],
  ['p-c', 'Patient C'],
  ['p-d', 'Patient D'],
]);

const row = (
  id: string,
  patientId: string,
  tokenNo: number,
  appointmentStatus: string
): BoardInput => ({
  id,
  patientId,
  tokenNo,
  appointmentTime: null,
  appointmentStatus,
});

/**
 * `held` accepts ids (parked by Hold) or [id, reason] pairs, so the existing
 * cases stay readable while skip's reason can be asserted.
 */
const board = (
  rows: BoardInput[],
  held: (string | [string, HoldReason])[] = [],
  /** Whoever the queue's pointer names as being in the room. */
  currentId: string | null = null,
  /** Reception's order override — most recently promoted first. */
  priorityIds: string[] = []
) =>
  buildBoard(
    CLINIC,
    DOCTOR,
    DATE,
    rows,
    new Map<string, HoldReason>(
      held.map((entry) => (typeof entry === 'string' ? [entry, 'held'] : entry))
    ),
    currentId,
    priorityIds,
    names
  );

describe('the requirement, end to end', () => {
  it('reads A completed, B on hold, C with the doctor', () => {
    const result = board(
      [
        row('a', 'p-a', 1, 'Completed'),
        row('b', 'p-b', 2, 'Patient Arrived'),
        row('c', 'p-c', 3, 'Patient Arrived'),
      ],
      ['b'],
      'c'
    );

    expect(result.completed.map((e) => e.patientName)).toEqual(['Patient A']);
    expect(result.onHold.map((e) => e.patientName)).toEqual(['Patient B']);
    expect(result.onHold[0].holdReason).toBe('held');
    expect(result.currentPatient?.patientName).toBe('Patient C');
    expect(result.currentPatient?.position).toBe('with_doctor');
  });

  it('does not offer a held patient as next', () => {
    // The whole point of a hold: B is not in the building, so sending them in
    // is impossible. If B were still "next", reception would be told to call
    // someone who cannot come.
    const result = board(
      [
        row('b', 'p-b', 1, 'Patient Arrived'),
        row('d', 'p-d', 2, 'Patient Arrived'),
      ],
      ['b']
    );

    expect(result.nextPatient?.patientName).toBe('Patient D');
    expect(result.waiting.map((e) => e.appointmentId)).not.toContain('b');
  });

  it('promotes the next waiting patient once the doctor completes', () => {
    // Completing is the only thing that happens — nothing writes "B is now
    // next". Ready-ness is derived, so it cannot drift out of sync.
    const duringConsult = board(
      [
        row('c', 'p-c', 1, 'Patient Arrived'),
        row('d', 'p-d', 2, 'Patient Arrived'),
      ],
      [],
      'c'
    );
    expect(duringConsult.currentPatient?.patientName).toBe('Patient C');
    expect(duringConsult.nextPatient?.patientName).toBe('Patient D');

    // The pointer still names C, but a completed row can never be in the room —
    // so the board reads empty without anything having to clear the pointer.
    const afterComplete = board(
      [row('c', 'p-c', 1, 'Completed'), row('d', 'p-d', 2, 'Patient Arrived')],
      [],
      'c'
    );
    expect(afterComplete.currentPatient).toBeNull();
    expect(afterComplete.nextPatient?.patientName).toBe('Patient D');
    expect(afterComplete.nextPatient?.position).toBe('next');
  });
});

describe('skip', () => {
  it('leaves the skipped patient held and the next one with the doctor', () => {
    // Skip is a hold plus an advance, so the board it produces is the same
    // board a hold-then-send-in would produce. Encoding it here is what stops
    // the two halves drifting apart: whatever QueueService.skip does, this is
    // the state it has to land on.
    //
    // The patient being skipped is a *waiting* one — B here is next, not in
    // the room. Skipping the patient with the doctor is refused by the service
    // (409), because reception cannot end a consultation from the front desk.
    const beforeSkip = board([
      row('b', 'p-b', 1, 'Patient Arrived'),
      row('c', 'p-c', 2, 'Patient Arrived'),
    ]);
    expect(beforeSkip.currentPatient).toBeNull();
    expect(beforeSkip.nextPatient?.patientName).toBe('Patient B');

    const afterSkip = board(
      [
        row('b', 'p-b', 1, 'Patient Arrived'),
        row('c', 'p-c', 2, 'Patient Arrived'),
      ],
      [['b', 'skipped']],
      'c'
    );

    expect(afterSkip.onHold.map((e) => e.patientName)).toEqual(['Patient B']);
    // The one thing that separates a skip from a hold once it has happened:
    // both park the patient identically, so without the reason the board
    // cannot say which action did it.
    expect(afterSkip.onHold[0].holdReason).toBe('skipped');
    expect(afterSkip.currentPatient?.patientName).toBe('Patient C');
    // The skipped patient is parked, not lost — Resume is the way back, and
    // until then they must never be offered as next.
    expect(afterSkip.nextPatient).toBeNull();
  });

  it('leaves the room empty when there is nobody behind the skipped patient', () => {
    // A real outcome, not a failure: the doctor is free and reception checks
    // the next arrival in when they turn up.
    const result = board([row('b', 'p-b', 1, 'Patient Arrived')], ['b']);

    expect(result.currentPatient).toBeNull();
    expect(result.nextPatient).toBeNull();
    expect(result.onHold.map((e) => e.patientName)).toEqual(['Patient B']);
  });
});

describe('a doctor confirming another patient', () => {
  it('parks the one they were with, even though that row still reads Confirmed', () => {
    // The doctor confirms B from the appointment page: the pointer moves to B
    // and A is held. A's row is still `Confirmed` from when *they* were
    // confirmed, so classifying by status alone dropped them into notArrived
    // and the hold was never read — they vanished from Paused entirely.
    const result = board(
      [row('a', 'p-a', 1, 'Confirmed'), row('b', 'p-b', 2, 'Confirmed')],
      ['a'],
      'b'
    );

    expect(result.currentPatient?.patientName).toBe('Patient B');
    expect(result.onHold.map((e) => e.patientName)).toEqual(['Patient A']);
    expect(result.notArrived).toEqual([]);
  });
});

describe("reception's order override", () => {
  it('puts the named patient at the front of the queue', () => {
    // Reception pressing Set as Next never changes the room — who is with the
    // doctor is the doctor's call — so it means "this one goes in next"
    // instead, ahead of token order.
    const result = board(
      [
        row('c', 'p-c', 1, 'Patient Arrived'),
        row('d', 'p-d', 2, 'Patient Arrived'),
      ],
      [],
      null,
      ['d']
    );

    expect(result.nextPatient?.patientName).toBe('Patient D');
    expect(result.waiting.map((e) => e.patientName)).toEqual([
      'Patient D',
      'Patient C',
    ]);
  });

  it('pushes everyone else down one place, rather than swapping', () => {
    // Promoting the last of three moves them to the front and shifts the other
    // two down one each — their order relative to each other is untouched. A
    // swap would have produced C, D, B.
    const result = board(
      [
        row('b', 'p-b', 1, 'Patient Arrived'),
        row('c', 'p-c', 2, 'Patient Arrived'),
        row('d', 'p-d', 3, 'Patient Arrived'),
      ],
      [],
      null,
      ['d']
    );

    expect(result.waiting.map((e) => e.patientName)).toEqual([
      'Patient D',
      'Patient B',
      'Patient C',
    ]);
  });

  it('keeps an earlier promotion, one place behind the newer one', () => {
    // The list is an order, not a single slot. D was promoted first, then C:
    // C leads, and D drops exactly one place instead of falling back to token
    // order behind B — which is what the old single-id override did, silently
    // undoing reception's earlier decision.
    const result = board(
      [
        row('b', 'p-b', 1, 'Patient Arrived'),
        row('c', 'p-c', 2, 'Patient Arrived'),
        row('d', 'p-d', 3, 'Patient Arrived'),
      ],
      [],
      null,
      ['c', 'd']
    );

    expect(result.waiting.map((e) => e.patientName)).toEqual([
      'Patient C',
      'Patient D',
      'Patient B',
    ]);
  });

  it('ignores an override naming somebody no longer waiting', () => {
    // Called in, held or completed since — the id matches nothing and the
    // queue is back in plain order, with nothing to clean up.
    const result = board(
      [
        row('c', 'p-c', 1, 'Patient Arrived'),
        row('d', 'p-d', 2, 'Patient Arrived'),
      ],
      ['d'],
      null,
      ['d']
    );

    expect(result.nextPatient?.patientName).toBe('Patient C');
    expect(result.onHold.map((e) => e.patientName)).toEqual(['Patient D']);
  });

  it('drops stale ids from the middle of the order', () => {
    // C has gone in to the doctor since being promoted. D's promotion still
    // stands and simply moves up — the rest of the order is not discarded.
    const result = board(
      [
        row('b', 'p-b', 1, 'Patient Arrived'),
        row('c', 'p-c', 2, 'Patient Arrived'),
        row('d', 'p-d', 3, 'Patient Arrived'),
      ],
      [],
      'c',
      ['c', 'd']
    );

    expect(result.currentPatient?.patientName).toBe('Patient C');
    expect(result.waiting.map((e) => e.patientName)).toEqual([
      'Patient D',
      'Patient B',
    ]);
  });
});

describe('current patient', () => {
  it('is null when the pointer names nobody', () => {
    const result = board([row('b', 'p-b', 1, 'Patient Arrived')]);
    expect(result.currentPatient).toBeNull();
  });

  it('cannot report two patients in the room at once', () => {
    // The old rule keyed off `appointmentStatus === 'Confirmed'` and had to
    // break ties when two rows carried it — which is how the doctor's screen
    // and reception came to show different patients. A pointer names one
    // appointment, so the ambiguity is not representable.
    const result = board(
      [
        row('c', 'p-c', 1, 'Patient Arrived'),
        row('d', 'p-d', 2, 'Patient Arrived'),
      ],
      [],
      'c'
    );

    expect(result.currentPatient?.patientName).toBe('Patient C');
    expect(result.waiting.map((e) => e.patientName)).toEqual(['Patient D']);
  });

  it('never reports a completed patient as being with the doctor', () => {
    const result = board([row('a', 'p-a', 1, 'Completed')], [], 'a');
    expect(result.currentPatient).toBeNull();
    expect(result.completed).toHaveLength(1);
  });
});

describe('status buckets', () => {
  it('separates not-yet-arrived patients from the waiting queue', () => {
    // Someone who has not walked in cannot be sent to the doctor, so they must
    // not be counted as waiting or offered as next.
    const result = board([
      row('u', 'p-a', 1, 'Upcoming'),
      row('p', 'p-b', 2, 'Pending'),
      row('d', 'p-d', 3, 'Patient Arrived'),
    ]);

    expect(result.notArrived.map((e) => e.appointmentId).sort()).toEqual([
      'p',
      'u',
    ]);
    expect(result.nextPatient?.patientName).toBe('Patient D');
  });

  it('treats Cancelled and NoShow as done, not waiting', () => {
    const result = board([
      row('a', 'p-a', 1, 'Cancelled'),
      row('b', 'p-b', 2, 'NoShow'),
    ]);

    expect(result.completed).toHaveLength(2);
    expect(result.waiting).toHaveLength(0);
    expect(result.nextPatient).toBeNull();
  });

  it('keeps the untouched lifecycle status on every entry', () => {
    // Callers must never have to infer status from position — the appointment
    // status is reported as-is, because the queue does not own it.
    const result = board([row('b', 'p-b', 1, 'Patient Arrived')], ['b']);
    expect(result.onHold[0].appointmentStatus).toBe('Patient Arrived');
    expect(result.onHold[0].position).toBe('on_hold');
  });
});

/** A sitting the doctor has worked past must not supply "next" — but its
 * unseen patients stay on the board, because they are still in the building. */
describe('a doctor who has moved on to the next sitting', () => {
  const sessioned = (
    id: string,
    patientId: string,
    tokenNo: number,
    appointmentStatus: string,
    sessionIndex: number
  ): BoardInput => ({
    ...row(id, patientId, tokenNo, appointmentStatus),
    sessionIndex,
  });

  it('stops offering an unseen morning patient once the evening is in the room', () => {
    const result = board(
      [
        sessioned('m', 'p-b', 1, 'Patient Arrived', 1),
        sessioned('e1', 'p-c', 1, 'Patient Arrived', 2),
        sessioned('e2', 'p-d', 2, 'Patient Arrived', 2),
      ],
      [],
      'e1'
    );

    expect(result.nextPatient?.appointmentId).toBe('e2');
    // Never dropped: nobody has seen them, and they are sitting outside.
    expect(result.waiting.map((e) => e.appointmentId)).toContain('m');
  });

  it('leaves the morning running while the morning is the sitting being worked', () => {
    const result = board(
      [
        sessioned('m1', 'p-b', 1, 'Patient Arrived', 1),
        sessioned('m2', 'p-c', 2, 'Patient Arrived', 1),
      ],
      [],
      'm1'
    );

    expect(result.nextPatient?.appointmentId).toBe('m2');
  });

  it('still lets reception name someone from the earlier sitting', () => {
    const result = board(
      [
        sessioned('m', 'p-b', 1, 'Patient Arrived', 1),
        sessioned('e1', 'p-c', 1, 'Patient Arrived', 2),
        sessioned('e2', 'p-d', 2, 'Patient Arrived', 2),
      ],
      [],
      'e1',
      ['m']
    );

    expect(result.nextPatient?.appointmentId).toBe('m');
  });

  it('does not revert to the closed sitting when the room empties', () => {
    // The evening patient is finished and the doctor is free. Keyed on the
    // room alone this would offer the morning patient again.
    const result = board([
      sessioned('m', 'p-b', 1, 'Patient Arrived', 1),
      sessioned('e1', 'p-c', 1, 'Completed', 2),
    ]);

    expect(result.nextPatient).toBeNull();
    expect(result.waiting.map((e) => e.appointmentId)).toEqual(['m']);
  });
});

describe('edge cases', () => {
  it('returns an empty board for a day with no appointments', () => {
    const result = board([]);
    expect(result.currentPatient).toBeNull();
    expect(result.nextPatient).toBeNull();
    expect(result.waiting).toEqual([]);
    expect(result.onHold).toEqual([]);
  });

  it('falls back to Unknown rather than dropping an unnamed patient', () => {
    const result = buildBoard(
      CLINIC,
      DOCTOR,
      DATE,
      [row('x', 'p-missing', 1, 'Patient Arrived')],
      new Map(),
      null,
      [],
      new Map()
    );
    expect(result.nextPatient?.patientName).toBe('Unknown');
  });

  it('ignores a hold on a patient who is not in the day at all', () => {
    const result = board([row('d', 'p-d', 1, 'Patient Arrived')], ['stale-id']);
    expect(result.onHold).toHaveLength(0);
    expect(result.nextPatient?.patientName).toBe('Patient D');
  });

  /**
   * Reception parks a patient who phoned to say they are late — before the
   * check-in. The hold used to be read only inside the "present" branch, so
   * the flag was written and then ignored, and the row stayed in `notArrived`.
   */
  it('parks a not-arrived patient reception put on hold', () => {
    const result = board(
      [row('a', 'p-a', 1, 'Scheduled'), row('b', 'p-b', 2, 'Patient Arrived')],
      ['a']
    );

    expect(result.onHold.map((e) => e.appointmentId)).toEqual(['a']);
    expect(result.onHold[0].holdReason).toBe('held');
    expect(result.notArrived).toHaveLength(0);
    // Held, so they must not be offered as next — same rule as an arrived hold.
    expect(result.nextPatient?.appointmentId).toBe('b');
  });

  it('leaves an unheld not-arrived patient in notArrived', () => {
    const result = board([row('a', 'p-a', 1, 'Scheduled')]);

    expect(result.notArrived.map((e) => e.appointmentId)).toEqual(['a']);
    expect(result.onHold).toHaveLength(0);
  });

  it('preserves the incoming queue order', () => {
    const result = board([
      row('x', 'p-b', 1, 'Patient Arrived'),
      row('y', 'p-c', 2, 'Patient Arrived'),
      row('z', 'p-d', 3, 'Patient Arrived'),
    ]);

    expect(result.waiting.map((e) => e.appointmentId)).toEqual(['x', 'y', 'z']);
    expect(result.waiting.map((e) => e.position)).toEqual([
      'next',
      'waiting',
      'waiting',
    ]);
  });
});

describe('orderLikeBoard — the order the patient app counts "ahead of you" in', () => {
  const ids = (rows: BoardInput[]) => rows.map((r) => r.id);

  it('puts checked-in patients first, then the rest by token', () => {
    const rows = [
      row('t1', 'p-a', 1, 'Upcoming'),
      row('t2', 'p-b', 2, 'Patient Arrived'),
      row('t3', 'p-c', 3, 'Upcoming'),
    ];
    expect(ids(orderLikeBoard(rows, null, new Set(), []))).toEqual([
      't2',
      't1',
      't3',
    ]);
  });

  it('agrees with the board on who is next', () => {
    const rows = [
      row('t1', 'p-a', 1, 'Upcoming'),
      row('t2', 'p-b', 2, 'Patient Arrived'),
      row('t3', 'p-c', 3, 'Patient Arrived'),
    ];
    const board = buildBoard(
      CLINIC,
      DOCTOR,
      DATE,
      rows,
      new Map(),
      null,
      [],
      names
    );
    const walked = orderLikeBoard(rows, null, new Set(), []);
    expect(walked[0].id).toBe(board.nextPatient?.appointmentId);
  });

  it('moves a late check-in back among checked-in patients only', () => {
    const rows: BoardInput[] = [
      { ...row('t1', 'p-a', 1, 'Patient Arrived'), lateQueueDemotion: 1 },
      row('t2', 'p-b', 2, 'Patient Arrived'),
      row('t3', 'p-c', 3, 'Upcoming'),
    ];
    expect(ids(orderLikeBoard(rows, null, new Set(), []))).toEqual([
      't2',
      't1',
      't3',
    ]);
  });

  it('keeps each shift together, with the patient in the room first', () => {
    const rows: BoardInput[] = [
      { ...row('m1', 'p-a', 1, 'Upcoming'), sessionIndex: 1 },
      { ...row('m2', 'p-b', 2, 'Confirmed'), sessionIndex: 1 },
      { ...row('e1', 'p-c', 1, 'Patient Arrived'), sessionIndex: 2 },
    ];
    expect(ids(orderLikeBoard(rows, 'm2', new Set(), []))).toEqual([
      'm2',
      'm1',
      'e1',
    ]);
  });
});
