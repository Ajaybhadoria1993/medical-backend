import {
  dueOf,
  isPlanRow,
  push,
  toRawCall,
  withName,
} from '../utils/followUp.utils';
import type { People } from '../types/followUp.types';

describe('followUp.utils', () => {
  it('dueOf splits by the IST day string', () => {
    expect(dueOf('2026-10-15', '2026-10-16')).toBe('overdue');
    expect(dueOf('2026-10-16', '2026-10-16')).toBe('today');
    expect(dueOf('2026-10-17', '2026-10-16')).toBe('upcoming');
  });

  it('isPlanRow needs a plan kind and a planId', () => {
    const planId = '00000000-0000-0000-0000-000000000001';
    expect(isPlanRow({ kind: 'plan_step', planId })).toBe(true);
    expect(isPlanRow({ kind: 'plan_step' })).toBe(false);
    // A stray planId must never route a doctor follow-up to a plan.
    expect(isPlanRow({ kind: 'doctor_followup', planId })).toBe(false);
  });

  it('push groups values under one key in order', () => {
    const map = new Map<string, number[]>();
    push(map, 'a', 1);
    push(map, 'a', 2);
    push(map, 'b', 3);
    expect(map.get('a')).toEqual([1, 2]);
    expect(map.get('b')).toEqual([3]);
  });

  it('toRawCall and withName map a plan call to the list shape', () => {
    const at = new Date('2026-10-16T10:00:00Z');
    const raw = toRawCall({
      planId: 'p1',
      outcome: 'no_answer',
      notes: 'busy',
      nextCallDate: '2026-10-18',
      actorId: 'u1',
      at,
    });
    const people: People = new Map([
      [
        'u1',
        {
          name: 'Asha',
          mobile: null,
          alternateMobile: null,
          email: null,
          age: null,
          gender: null,
        },
      ],
    ]);
    expect(withName(raw, people)).toEqual({
      outcome: 'no_answer',
      notes: 'busy',
      nextCallDate: '2026-10-18',
      at,
      byName: 'Asha',
    });
    expect(withName({ ...raw, actorId: null }, people).byName).toBeNull();
  });
});
