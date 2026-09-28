/**
 * The event registry — every notification the system can send, in one place.
 *
 * Module registries are merged here. From this one object the system derives
 * the preference defaults per role, the labels and categories the My
 * Notifications screen renders, the recipient rules, the copy, and the click
 * targets. Adding an event is adding one entry; nothing else needs editing,
 * which is what stops the three hand-maintained lists this replaces from
 * drifting apart again.
 *
 * Module registries are added in Phases 3-8, one per module, each behind its own
 * flag. The registry is intentionally empty until then: Phase 0 lands the
 * contract, not the content.
 */

import type { EventRegistry, NotificationEventDefinition } from './types';
import { appointmentEvents, queueEvents } from './appointment';
import { labEvents } from './lab';
import { paymentEvents } from './payment';
import { prescriptionEvents } from './prescription';
import { staffEvents } from './staff';
import { subscriptionEvents } from './subscription';

export * from './types';
export { defineEvents } from './defineEvents';

const registry: EventRegistry = {
  ...appointmentEvents,
  ...queueEvents,
  ...prescriptionEvents,
  ...paymentEvents,
  ...labEvents,
  ...staffEvents,
  ...subscriptionEvents,
};

export type NotificationEventKey = string;

export function getEvent(
  key: string
): NotificationEventDefinition<never> | undefined {
  return registry[key] as NotificationEventDefinition<never> | undefined;
}

export function listEvents(): EventRegistry {
  return registry;
}

/**
 * Maps a legacy preference key to its current event.
 *
 * Saved preferences are JSONB keyed by the names events had before the rebuild,
 * so a rename without this lookup silently re-enables every notification a user
 * had turned off. Built once at module load.
 */
const aliasIndex: ReadonlyMap<string, string> = new Map(
  Object.entries(registry).flatMap(([key, def]) =>
    (def.aliases ?? []).map((alias) => [alias, key] as const)
  )
);

export function resolveEventKey(keyOrAlias: string): string | undefined {
  if (registry[keyOrAlias]) return keyOrAlias;
  return aliasIndex.get(keyOrAlias);
}
