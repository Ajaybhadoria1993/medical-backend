/** The My Notifications rows, derived from the registry (A8). */

import { listEvents } from '../registry';
import type {
  ConfigurableChannel,
  NotificationCategory,
  NotificationKind,
  NotificationPriority,
} from '../registry/types';

const CONFIGURABLE_CHANNELS: ConfigurableChannel[] = ['inApp', 'push'];

// Server-owned so the frontend keeps no second copy to drift. Icons stay there.
const CATEGORY_TITLES: Record<NotificationCategory, string> = {
  appointments: 'Appointments & Queue',
  payments: 'Payments',
  prescription: 'Prescriptions',
  lab: 'Laboratory',
  staff: 'Staff & Accounts',
  system: 'System',
};

const CATEGORY_ORDER = Object.keys(CATEGORY_TITLES) as NotificationCategory[];

export interface CatalogEvent {
  /** Preference key (legacy alias), not `eventKey` — a miss resolves to
   *  "enabled", so canonical keys here would un-mute what users had muted. */
  key: string;
  eventKey: string;
  label: string;
  description: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  kind: NotificationKind;
  /** false renders the toggle locked: the user may not turn this off. */
  configurable: boolean;
  channels: ConfigurableChannel[];
  defaults: Partial<Record<ConfigurableChannel, boolean>>;
}

export interface CatalogCategory {
  id: NotificationCategory;
  title: string;
  eventCount: number;
}

export interface EventCatalog {
  events: CatalogEvent[];
  categories: CatalogCategory[];
}

/**
 * Events this role can receive. Super_Admin inherits Admin, mirroring
 * getRoleDefaults() — without it the screen collapses to 1 event instead of 17.
 */
export function getEventCatalog(role: string): EventCatalog {
  const inheritedRoles =
    role === 'Super_Admin' ? ['Admin', 'Super_Admin'] : [role];
  const events: CatalogEvent[] = [];

  for (const [eventKey, event] of Object.entries(listEvents())) {
    const roles = new Set(event.audiences.flatMap((a) => a.roles));
    const matched = inheritedRoles.filter((r) => roles.has(r));
    if (matched.length === 0) continue;

    const channels = CONFIGURABLE_CHANNELS.filter((c) =>
      event.channels.includes(c)
    );
    if (channels.length === 0) continue; // nothing to toggle on this screen

    // Most specific role wins, as mergeRolePrefs layers them.
    const defaultsRole = matched[matched.length - 1];
    const defaults: Partial<Record<ConfigurableChannel, boolean>> = {};
    for (const channel of channels) {
      defaults[channel] =
        event.roleDefaults?.[defaultsRole]?.[channel] ??
        event.defaults[channel];
    }

    events.push({
      key: event.aliases?.[0] ?? eventKey,
      eventKey,
      label: event.label,
      description: event.description,
      category: event.category,
      priority: event.priority,
      kind: event.kind,
      configurable: event.configurable,
      channels,
      defaults,
    });
  }

  events.sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      a.label.localeCompare(b.label)
  );

  // Only categories with events: an empty section reads as broken.
  const categories: CatalogCategory[] = CATEGORY_ORDER.filter((id) =>
    events.some((e) => e.category === id)
  ).map((id) => ({
    id,
    title: CATEGORY_TITLES[id],
    eventCount: events.filter((e) => e.category === id).length,
  }));

  return { events, categories };
}
