import type { PlanDeskCall } from '../../treatmentPlan';
import type {
  FollowUpCall,
  FollowUpItem,
  People,
  RawCall,
} from '../types/followUp.types';

export function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function toRawCall(c: PlanDeskCall): RawCall {
  return {
    outcome: c.outcome,
    notes: c.notes,
    nextCallDate: c.nextCallDate,
    actorId: c.actorId,
    at: c.at,
  };
}

export function withName(c: RawCall, people: People): FollowUpCall {
  const { actorId, ...rest } = c;
  return {
    ...rest,
    byName: actorId ? (people.get(actorId)?.name ?? null) : null,
  };
}

export function dueOf(dueDate: string, today: string): FollowUpItem['due'] {
  if (dueDate < today) return 'overdue';
  return dueDate === today ? 'today' : 'upcoming';
}

/** Plan rows carry their planId; the schema requires it for every kind but doctor_followup. */
export function isPlanRow<T extends { kind: string; planId?: string }>(
  ref: T
): ref is T & { planId: string } {
  return ref.kind !== 'doctor_followup' && !!ref.planId;
}

/** Visits still ahead of the patient; arrived, finished and dead ones don't count as booked. */
export const WAITING_STATUSES = [
  'Upcoming',
  'Pending',
  'Rescheduled',
  'Confirmed',
] as const;

/** YYYY-MM-DD plus whole days, in calendar terms (no clock, no timezone). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
