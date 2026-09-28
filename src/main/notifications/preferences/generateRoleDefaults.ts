/** Per-role preference defaults, generated from the registry. */

import {
  NON_CONFIGURABLE_NOTIFICATIONS,
  type RolePreferences,
} from './notificationPreferences.constants';
import { listEvents } from '../registry';
import type { ConfigurableChannel } from '../registry/types';

const CHANNELS: ConfigurableChannel[] = ['inApp', 'push'];

/** @param keyStyle 'legacy' emits the first alias, matching stored preferences. */
export function generateRoleDefaults(
  keyStyle: 'canonical' | 'legacy' = 'canonical'
): Record<string, RolePreferences> {
  const byRole: Record<string, RolePreferences> = {};

  for (const [canonicalKey, event] of Object.entries(listEvents())) {
    const key =
      keyStyle === 'legacy'
        ? (event.aliases?.[0] ?? canonicalKey)
        : canonicalKey;

    const roles = new Set(event.audiences.flatMap((a) => a.roles));

    for (const role of roles) {
      byRole[role] ??= { inApp: {}, push: {} };

      for (const channel of CHANNELS) {
        if (!event.channels.includes(channel)) continue;

        const enabled =
          event.roleDefaults?.[role]?.[channel] ?? event.defaults[channel];

        byRole[role][channel][key] = {
          enabled,
          configurable: event.configurable,
        };
      }
    }
  }

  return byRole;
}

export interface ParityMismatch {
  role: string;
  channel: ConfigurableChannel;
  event: string;
  /** 'value' — both sides have it and disagree. 'missing' — the registry dropped a role. */
  kind: 'value' | 'missing';
  legacy: { enabled: boolean; configurable: boolean } | undefined;
  generated: { enabled: boolean; configurable: boolean } | undefined;
}

/**
 * Proves the registry reproduces ROLE_DEFAULTS for events present in both.
 * Both sides are normalised through NON_CONFIGURABLE_NOTIFICATIONS first —
 * without it, four differences show up that resolution overrides anyway.
 */
/** Toggles the old map offered for notifications that role never received.
 *  Declared so they don't show as mismatches on every run. */
const INTENTIONAL_DROPS = new Set([
  'Doctor:pdf_ready',
  // Reception performs these status changes themselves; the row restated what
  // they had just done and buried the events they act on. Admin and the
  // treating doctor still receive both.
  'Receptionist:appointment_confirmed',
  'Receptionist:appointment_rescheduled',
]);

export function checkRoleDefaultsParity(
  legacyDefaults: Record<string, RolePreferences>
): ParityMismatch[] {
  const generated = generateRoleDefaults('legacy');
  const mismatches: ParityMismatch[] = [];

  for (const [role, rolePrefs] of Object.entries(generated)) {
    for (const channel of CHANNELS) {
      for (const [event, gen] of Object.entries(rolePrefs[channel])) {
        const raw = legacyDefaults[role]?.[channel]?.[event];
        if (!raw) continue; // not present in the old map: nothing to compare

        const legacy = asResolved(event, raw);
        const generated = asResolved(event, gen);

        if (
          legacy.enabled !== generated.enabled ||
          legacy.configurable !== generated.configurable
        ) {
          mismatches.push({
            role,
            channel,
            event,
            kind: 'value',
            legacy,
            generated,
          });
        }
      }
    }
  }

  /**
   * Dropped roles, which the comparison above cannot see.
   *
   * Iterating the generated map only ever finds entries that exist on both
   * sides, so an event the registry forgot to give a role simply never comes
   * up — the check reports a clean run while a whole audience has silently
   * stopped being notified. Walking the legacy map for events the registry has
   * claimed is what catches it.
   */
  const migrated = new Set(
    Object.entries(listEvents()).flatMap(([key, def]) => [
      key,
      ...(def.aliases ?? []),
    ])
  );

  for (const [role, rolePrefs] of Object.entries(legacyDefaults)) {
    for (const channel of CHANNELS) {
      for (const [event, legacy] of Object.entries(rolePrefs[channel])) {
        if (!migrated.has(event)) continue; // not migrated yet: not a regression
        if (generated[role]?.[channel]?.[event]) continue;
        if (INTENTIONAL_DROPS.has(`${role}:${event}`)) continue;

        mismatches.push({
          role,
          channel,
          event,
          kind: 'missing',
          legacy,
          generated: undefined,
        });
      }
    }
  }

  return mismatches;
}

/** What resolveNotificationPreferences would actually hand the settings screen. */
function asResolved(
  event: string,
  value: { enabled: boolean; configurable: boolean }
): { enabled: boolean; configurable: boolean } {
  return NON_CONFIGURABLE_NOTIFICATIONS.includes(event)
    ? { enabled: true, configurable: false }
    : value;
}
