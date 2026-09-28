export interface PreferenceSetting {
  enabled: boolean;
  configurable: boolean;
}

export interface RolePreferences {
  inApp: Record<string, PreferenceSetting>;
  push: Record<string, PreferenceSetting>;
}

export const NON_CONFIGURABLE_NOTIFICATIONS = [
  'appointment_canceled',
  'payment_received',
  'appointment_no_show',
];

export const ROLE_DEFAULTS: Record<string, RolePreferences> = {
  Super_Admin: {
    inApp: {
      clinic_created: { enabled: true, configurable: true },
      doctor_profile_update_requested: { enabled: true, configurable: true },
    },
    push: {
      clinic_created: { enabled: true, configurable: true },
      doctor_profile_update_requested: { enabled: true, configurable: true },
    },
  },
  Admin: {
    inApp: {
      appointment_created: { enabled: true, configurable: true },
      appointment_rescheduled: { enabled: true, configurable: true },
      appointment_confirmed: { enabled: false, configurable: true },
      appointment_canceled: { enabled: true, configurable: false },
      appointment_no_show: { enabled: true, configurable: false },
      payment_received: { enabled: true, configurable: false },
      test_log_created: { enabled: false, configurable: true },
      test_report_uploaded: { enabled: false, configurable: true },
      user_created: { enabled: true, configurable: true },
    },
    push: {
      appointment_created: { enabled: true, configurable: true },
      appointment_rescheduled: { enabled: true, configurable: true },
      appointment_confirmed: { enabled: false, configurable: true },
      appointment_canceled: { enabled: true, configurable: false },
      appointment_no_show: { enabled: true, configurable: false },
      payment_received: { enabled: true, configurable: true },
      test_log_created: { enabled: false, configurable: true },
      test_report_uploaded: { enabled: false, configurable: true },
      user_created: { enabled: true, configurable: true },
    },
  },
  Doctor: {
    inApp: {
      appointment_created: { enabled: true, configurable: true },
      appointment_rescheduled: { enabled: true, configurable: true },
      appointment_confirmed: { enabled: false, configurable: true },
      appointment_canceled: { enabled: true, configurable: false },
      appointment_no_show: { enabled: true, configurable: false },
      test_assigned_to_lab: { enabled: true, configurable: true },
      test_report_uploaded: { enabled: true, configurable: true },
      pdf_ready: { enabled: true, configurable: true },
    },
    push: {
      appointment_created: { enabled: true, configurable: true },
      appointment_rescheduled: { enabled: true, configurable: true },
      appointment_confirmed: { enabled: false, configurable: true },
      appointment_canceled: { enabled: true, configurable: false },
      appointment_no_show: { enabled: true, configurable: false },
      test_assigned_to_lab: { enabled: false, configurable: true },
      test_report_uploaded: { enabled: true, configurable: true },
      pdf_ready: { enabled: false, configurable: true },
    },
  },
  Patient: {
    inApp: {
      appointment_created: { enabled: true, configurable: true },
      appointment_rescheduled: { enabled: true, configurable: true },
      appointment_confirmed: { enabled: true, configurable: true },
      appointment_canceled: { enabled: true, configurable: false },
      payment_received: { enabled: true, configurable: false },
      test_report_uploaded: { enabled: true, configurable: true },
      pdf_ready: { enabled: true, configurable: true },
    },
    push: {
      appointment_created: { enabled: true, configurable: true },
      appointment_rescheduled: { enabled: true, configurable: true },
      appointment_confirmed: { enabled: true, configurable: true },
      appointment_canceled: { enabled: true, configurable: false },
      payment_received: { enabled: true, configurable: false },
      test_report_uploaded: { enabled: true, configurable: true },
      pdf_ready: { enabled: true, configurable: true },
    },
  },
  Receptionist: {
    inApp: {
      appointment_created: { enabled: true, configurable: true },
      appointment_rescheduled: { enabled: true, configurable: true },
      appointment_confirmed: { enabled: true, configurable: true },
      appointment_canceled: { enabled: true, configurable: false },
      appointment_no_show: { enabled: true, configurable: false },
      payment_received: { enabled: true, configurable: true },
    },
    push: {
      appointment_created: { enabled: true, configurable: true },
      appointment_rescheduled: { enabled: false, configurable: true },
      appointment_confirmed: { enabled: false, configurable: true },
      appointment_canceled: { enabled: true, configurable: false },
      appointment_no_show: { enabled: true, configurable: true },
      payment_received: { enabled: false, configurable: true },
    },
  },
  Lab_Assistant: {
    inApp: {
      test_log_created: { enabled: true, configurable: true },
      test_assigned_to_lab: { enabled: true, configurable: true },
      test_report_uploaded: { enabled: true, configurable: true },
    },
    push: {
      test_log_created: { enabled: true, configurable: true },
      test_assigned_to_lab: { enabled: true, configurable: true },
      test_report_uploaded: { enabled: false, configurable: true },
    },
  },
};

/**
 * Role defaults, with the registry layered over the hand-written map.
 *
 * The registry is generated in *legacy* key style — `appointment_created`, not
 * `appointment.created` — because stored user preferences are JSONB keyed by
 * those names. Emitting canonical keys here would leave every saved override
 * unmatched, and an unmatched key falls through to "enabled": every user who
 * had muted something would quietly start receiving it again.
 *
 * Merge order is deliberate. The static map goes down first so events that have
 * not been migrated keep their entries, then the generated map overrides for
 * the ones that have. Parity is verified at zero mismatches, so nothing visibly
 * changes today — what changes is that new events now appear in settings
 * automatically instead of needing a second hand-edit here.
 */
function mergeRolePrefs(
  base: RolePreferences | undefined,
  over: RolePreferences | undefined
): RolePreferences {
  return {
    inApp: { ...(base?.inApp ?? {}), ...(over?.inApp ?? {}) },
    push: { ...(base?.push ?? {}), ...(over?.push ?? {}) },
  };
}

export function getRoleDefaults(role: string): RolePreferences {
  // Imported lazily: this module is loaded by the registry's own type imports,
  // and a top-level import back into it would close the cycle.
  const { generateRoleDefaults } = require('./generateRoleDefaults') as {
    generateRoleDefaults: (
      keyStyle: 'canonical' | 'legacy'
    ) => Record<string, RolePreferences>;
  };

  const generated = generateRoleDefaults('legacy');
  const resolved = (r: string) =>
    mergeRolePrefs(ROLE_DEFAULTS[r], generated[r]);

  if (role === 'Super_Admin') {
    // Super_Admin inherits everything Admin gets, then its own on top. The
    // generator does not reproduce this — it emits only what an audience names
    // a role for — so dropping the merge here would cut a Super_Admin's
    // settings screen down to the single event that targets them directly.
    return mergeRolePrefs(resolved('Admin'), resolved('Super_Admin'));
  }

  return resolved(role);
}
