import { listEvents, resolveEventKey } from '../registry';
import { formatSchedule } from '../registry/appointment/schedule';
import type { AppointmentContext } from '../ports';

/**
 * Contract tests for the event registry.
 *
 * These are deliberately data-driven: every check runs against every event, so
 * a new registry entry is covered the moment it is added rather than when
 * somebody remembers to write a test for it.
 *
 * No database, no Redis — the registry is code.
 */

const events = Object.entries(listEvents());

/** Enough context that every builder can render without reaching for a lookup. */
const sampleCtx = {
  appointmentId: 'a1',
  clinicId: 'c1',
  doctorId: 'd1',
  patientId: 'p1',
  testId: 't1',
  reportId: 'r1',
  userId: 'u1',
  performerUserId: 'perf',
  patientName: 'sunil',
  doctorName: 'anita mehta',
  clinicName: 'Sunrise Clinic',
  performerName: 'Harshit Sharma',
  performerRole: 'Receptionist',
  userRole: 'Receptionist',
  testName: 'Blood count',
  labName: 'Sunrise Lab',
  planName: 'CareHub',
  totalAmount: '1000',
  daysRemaining: 3,
  amount: '1000',
  when: 'Sat 12 Sept at 4:30 PM',
  detail: 'something happened',
} as never;

describe('registry contract', () => {
  it('has events', () => {
    expect(events.length).toBeGreaterThan(0);
  });

  describe.each(events)('%s', (key, event) => {
    it('declares at least one audience', () => {
      expect(event.audiences.length).toBeGreaterThan(0);
    });

    it('gives every audience recipients and a role list', () => {
      for (const audience of event.audiences) {
        expect(typeof audience.recipients).toBe('function');
        expect(audience.roles.length).toBeGreaterThan(0);
        expect(audience.key).toBeTruthy();
      }
    });

    it('has a click action that produces a route', () => {
      const click = event.clickAction(sampleCtx);
      expect(click.route).toMatch(/^\//);
    });

    it('resolves every :param in its click route', () => {
      // A route left holding ":id" navigates the user to a literal colon-id.
      for (const audience of event.audiences) {
        const click = (audience.clickAction ?? event.clickAction)(sampleCtx);
        const params = click.params ?? {};
        const unresolved = (
          click.route.match(/:([A-Za-z0-9_]+)/g) ?? []
        ).filter((token) => params[token.slice(1)] === undefined);
        expect(unresolved).toEqual([]);
      }
    });

    it('declares a category, priority and kind', () => {
      expect(event.category).toBeTruthy();
      expect(['action_required', 'normal', 'low']).toContain(event.priority);
      expect(['notification', 'activity']).toContain(event.kind);
    });

    it('lists only channels it can actually build copy for', () => {
      // A channel with no builder is a silent no-op at delivery time.
      for (const audience of event.audiences) {
        if (event.channels.includes('inApp')) {
          expect(audience.message.inApp).toBeDefined();
        }
      }
    });

    it('never pushes when it is activity', () => {
      // Activity is browsable history. History that interrupts is not history.
      if (event.kind === 'activity') {
        expect(event.channels).not.toContain('push');
      }
    });

    it('resolves its own key and each alias back to itself', () => {
      // Stored preferences use the pre-rebuild names, and a lookup miss
      // resolves to "enabled" — a broken alias silently un-mutes everyone.
      expect(resolveEventKey(key)).toBe(key);
      for (const alias of event.aliases ?? []) {
        expect(resolveEventKey(alias)).toBe(key);
      }
    });
  });

  it('has no duplicate aliases across events', () => {
    const seen = new Map<string, string>();
    for (const [key, event] of events) {
      for (const alias of event.aliases ?? []) {
        expect(seen.get(alias)).toBeUndefined();
        seen.set(alias, key);
      }
    }
  });
});

describe('copy', () => {
  const audiences = events.flatMap(([key, event]) =>
    event.audiences.map(
      (audience) => [`${key} → ${audience.key}`, audience] as const
    )
  );

  describe.each(audiences)('%s', (_label, audience) => {
    const built = audience.message.inApp?.(sampleCtx);

    it('renders a title and body', () => {
      if (!built) return;
      expect(built.title.trim().length).toBeGreaterThan(0);
      expect(built.body.trim().length).toBeGreaterThan(0);
    });

    it('leaves no placeholder in the rendered text', () => {
      // Catches `${ctx.missing}` reaching a user as "undefined", and the double
      // space a bare `${ctx.userRole ?? ''}` leaves behind.
      if (!built) return;
      const text = `${built.title} ${built.body}`;
      expect(text).not.toMatch(/undefined|null|\[object Object\]/);
      expect(text).not.toMatch(/\s{2,}/);
      expect(text).not.toMatch(/\$\{/);
    });

    it('does not tell the reader to open what they just clicked', () => {
      // The whole row is a link; "Open it to see the details" spends the line
      // that should carry the fact.
      if (!built) return;
      expect(`${built.title} ${built.body}`.toLowerCase()).not.toContain(
        'open it'
      );
    });
  });
});

describe('formatSchedule', () => {
  const base: AppointmentContext = {
    patientName: 'x',
    doctorName: 'y',
    patientMobile: null,
    clinicName: null,
    appointmentDate: '2026-09-12',
    appointmentTime: '16:30',
    tokenNo: null,
  };

  it('renders a date and time for a slot appointment', () => {
    const out = formatSchedule(base);
    expect(out).toContain('12 Sept');
    expect(out).toMatch(/4:30/);
  });

  it('renders a token instead of a time for a token clinic', () => {
    // Printing a slot time there would promise something the queue does not.
    const out = formatSchedule({ ...base, appointmentTime: null, tokenNo: 14 });
    expect(out).toContain('token 14');
    expect(out).not.toMatch(/\d:\d\d/);
  });

  it('returns undefined rather than a partial string with no date', () => {
    // The copy has its own fallback; "at undefined" is worse than either.
    expect(formatSchedule({ ...base, appointmentDate: null })).toBeUndefined();
  });

  it('returns undefined for an unparseable date', () => {
    expect(
      formatSchedule({ ...base, appointmentDate: 'not-a-date' })
    ).toBeUndefined();
  });
});
