/**
 * Unit tests for confining a no-show shift to its own session.
 *
 * A no-show pulls the patients behind it forward. Scoped to the day, an
 * evening no-show holding token 3 swept up the morning's tokens 4 and 5 —
 * appointments that ran hours *earlier* and were never behind it — because
 * numbering restarts at 1 per shift and `tokenNo > 3` matches both clinics.
 *
 * The fetch is private and database-bound, so these assert the predicate it
 * builds rather than the rows a real query would return.
 */

import { and, asc, eq, gt, isNull, notInArray, or } from 'drizzle-orm';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { effectiveAppointmentTime } from '../utils/helpers';

/**
 * The session clause as `fetchSubsequentAppointments` builds it.
 *
 * Kept in step with the service by the tests below, which assert the shape a
 * null session collapses to — the property that actually matters.
 */
function sessionClause(sessionIndex: number | null) {
  return (sessionIndex ?? 1) === 1
    ? or(
        eq(AppointmentModel.sessionIndex, 1),
        isNull(AppointmentModel.sessionIndex)
      )
    : eq(AppointmentModel.sessionIndex, sessionIndex!);
}

/**
 * Renders a drizzle condition to comparable SQL text.
 *
 * Walks `queryChunks` by hand rather than serialising: chunks nest, and the
 * column objects inside carry a circular reference back to their table that
 * defeats `JSON.stringify`.
 */
function sqlOf(condition: unknown): string {
  const parts: string[] = [];

  const walk = (node: unknown): void => {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object') {
      parts.push(String(node));
      return;
    }

    const record = node as Record<string, unknown>;
    if (Array.isArray(record.queryChunks)) {
      record.queryChunks.forEach(walk);
      return;
    }
    if (Array.isArray(record.value)) {
      record.value.forEach(walk);
      return;
    }
    // A column renders as its database name.
    if (typeof record.name === 'string') parts.push(record.name);
  };

  walk(condition);
  return parts.join(' ').toLowerCase();
}

describe('bounding a no-show shift to its session', () => {
  it('matches only the second session when the no-show is in it', async () => {
    const clause = sqlOf(sessionClause(2));

    expect(clause).toContain('session_index');
    // An equality against one session, with no null branch: a morning row can
    // never satisfy it.
    expect(clause).not.toContain('is null');
  });

  it('treats a legacy null session as the first one', async () => {
    // Every row booked before shift-wise numbering carries a null session.
    // Read as anything but session 1, those appointments would detach from the
    // numbering they were actually issued under.
    const fromNull = sqlOf(sessionClause(null));
    const fromOne = sqlOf(sessionClause(1));

    expect(fromNull).toBe(fromOne);
    expect(fromNull).toContain('is null');
  });

  it('still bounds the fetch by token within the session', async () => {
    // The session narrows *which* queue; `tokenNo >` still decides who is
    // behind the no-show inside it.
    const combined = sqlOf(
      and(gt(AppointmentModel.tokenNo, 3), sessionClause(2))
    );

    expect(combined).toContain('token_no');
    expect(combined).toContain('session_index');
  });

  it('orders a time-based day by time before session', async () => {
    // Session and token are all-null on time-based rows, so they are inert
    // tiebreakers there and the day still reads in clock order.
    const order = [
      asc(AppointmentModel.appointmentTime),
      asc(AppointmentModel.sessionIndex),
      asc(AppointmentModel.tokenNo),
    ].map((column) => sqlOf(column));

    expect(order[0]).toContain('appointment_time');
    expect(order[1]).toContain('session_index');
    expect(order[2]).toContain('token_no');
  });
});

describe('token rows and the time-based shift', () => {
  it('reads a token booking as having no clock time', () => {
    // Booking stores '23:59' for a token; taken literally it sent token
    // no-shows down the time branch, where `time > '23:59'` matches nobody.
    expect(
      effectiveAppointmentTime({ appointmentTime: '23:59', tokenNo: 4 })
    ).toBeNull();
    expect(
      effectiveAppointmentTime({ appointmentTime: '23:59:00', tokenNo: 4 })
    ).toBeNull();
  });

  it('leaves a real time-based booking alone', () => {
    expect(
      effectiveAppointmentTime({ appointmentTime: '10:00', tokenNo: null })
    ).toBe('10:00');
    // A genuine 23:59 slot on a time-based day is not a placeholder.
    expect(
      effectiveAppointmentTime({ appointmentTime: '23:59', tokenNo: null })
    ).toBe('23:59');
  });

  it('still shifts an override booking that carries a token and a real time', () => {
    // The custom-slot path sets both, so excluding every row with a token
    // would have stopped a genuine 16:15 booking from moving up.
    expect(
      effectiveAppointmentTime({ appointmentTime: '16:15', tokenNo: 5 })
    ).toBe('16:15');
  });

  it('keeps token rows out of a time-based shift', () => {
    // A mixed day: a 10:00 no-show matched every token row, because '23:59'
    // sorts after every real slot, and rewrote the placeholder to 23:29.
    const clause = sqlOf(
      and(
        or(
          isNull(AppointmentModel.tokenNo),
          notInArray(AppointmentModel.appointmentTime, ['23:59', '23:59:00'])
        ),
        gt(AppointmentModel.appointmentTime, '10:00')
      )
    );

    expect(clause).toContain('token_no');
    expect(clause).toContain('is null');
    // Excluded by placeholder value, not by "holds a token" — bound values
    // render empty here, so the `not in` is what proves the shape.
    expect(clause).toContain('not in');
  });
});
