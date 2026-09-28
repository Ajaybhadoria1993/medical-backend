/**
 * Legacy in-app kill switch. Suppresses the bell row, socket emit and push —
 * never SMS/WhatsApp/email. Rollback is `NOTIFICATIONS_INAPP_ENABLED=true`.
 * Reasoning: docs/playbook/NOTIFICATION_REBUILD.md, Phase 0 Step 0.
 */

import { envConfig } from '../../../utils/envConfig';

/**
 * Events that keep delivering while the switch is off — functional rather than
 * informational, so suppressing them breaks a feature instead of removing noise.
 * Matched against `metadata.action`, `metadata.source` or `event`, whichever the
 * dispatch path sets.
 */
export const KILL_SWITCH_ALLOWLIST: ReadonlySet<string> = new Set([
  'upload_manual_prescription', // carries the OTP and upload URL
  'subscription-renewal', // a missed renewal deactivates every staff account
  // Patient-facing, already targeted at one patient, and actionable.
  'running_late',
  'appointment_shifted',
  'queue_my_turn',
  'queue_patients_ahead',
  'queue_doctor_active',
]);

/** Allowed if the switch is on, or if any identifier the caller has is listed. */
export function isLegacyInAppAllowed(
  ...identifiers: Array<string | undefined | null>
): boolean {
  if (envConfig.NOTIFICATIONS_INAPP_ENABLED) return true;
  return identifiers.some(
    (id): id is string =>
      typeof id === 'string' && KILL_SWITCH_ALLOWLIST.has(id)
  );
}
