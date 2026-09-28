/**
 * Typed helper for declaring a module's events.
 *
 * It is an identity function: it exists purely so each entry is checked against
 * NotificationEventDefinition at its definition site while the object keeps its
 * literal key types, which is what lets the event key union be derived from the
 * registry rather than maintained by hand beside it.
 */

import type { NotificationEventDefinition } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function defineEvents<
  T extends Record<string, NotificationEventDefinition<any>>,
>(events: T): T {
  return events;
}
