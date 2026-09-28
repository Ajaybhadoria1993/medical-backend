/**
 * Unit tests for the published time formats.
 *
 * These exist because a single patient payload was going out carrying
 * `appointmentTime: "15:00"` beside `nowServingTime: "13:00:00"` — the same
 * kind of value in two shapes, because `appointmentTime` is a varchar that
 * arrives with seconds from one code path and without from another.
 */

import {
  minutesUntil,
  normalizeTimeString,
  toDisplayTime,
} from '../utils/helpers';

describe('normalizeTimeString', () => {
  it('strips seconds', () => {
    expect(normalizeTimeString('13:00:00')).toBe('13:00');
  });

  it('leaves an already-normal time alone', () => {
    expect(normalizeTimeString('15:00')).toBe('15:00');
  });

  it('pads a single-digit hour', () => {
    expect(normalizeTimeString('9:05')).toBe('09:05');
  });

  it('returns null for anything unparseable', () => {
    // Null rather than a fallback: a caller can then derive the time properly
    // instead of publishing midnight, which is what a silent "00:00" default
    // did to token queues before.
    expect(normalizeTimeString(null)).toBeNull();
    expect(normalizeTimeString('')).toBeNull();
    expect(normalizeTimeString('not a time')).toBeNull();
    expect(normalizeTimeString('25:00')).toBeNull();
    expect(normalizeTimeString('12:75')).toBeNull();
  });
});

describe('toDisplayTime', () => {
  it('renders afternoon times as 12-hour', () => {
    expect(toDisplayTime('13:00:00')).toBe('1:00 PM');
    expect(toDisplayTime('15:30')).toBe('3:30 PM');
  });

  it('renders morning times as 12-hour', () => {
    expect(toDisplayTime('09:05')).toBe('9:05 AM');
  });

  it('handles both noon and midnight', () => {
    // The two cases a naive `hours % 12` gets wrong, rendering "0:00".
    expect(toDisplayTime('12:00')).toBe('12:00 PM');
    expect(toDisplayTime('00:30')).toBe('12:30 AM');
  });

  it('returns null rather than echoing junk back to a client', () => {
    expect(toDisplayTime(null)).toBeNull();
    expect(toDisplayTime('rubbish')).toBeNull();
  });
});

describe('minutesUntil', () => {
  it('counts forward to a later time', () => {
    // 13:10 → 15:00
    expect(minutesUntil('15:00', 13 * 60 + 10)).toBe(110);
  });

  it('floors at zero once the time has passed', () => {
    // A negative countdown would render as "in -20 minutes".
    expect(minutesUntil('13:00', 13 * 60 + 20)).toBe(0);
  });

  it('is zero at exactly the projected minute', () => {
    expect(minutesUntil('13:00', 13 * 60)).toBe(0);
  });

  it('tolerates a stored time with seconds', () => {
    expect(minutesUntil('15:00:00', 14 * 60)).toBe(60);
  });

  it('returns null when there is no time to measure to', () => {
    // Null, not 0 — "we do not know" is a far better answer to a patient than
    // "you are next".
    expect(minutesUntil(null, 600)).toBeNull();
    expect(minutesUntil('rubbish', 600)).toBeNull();
  });
});
