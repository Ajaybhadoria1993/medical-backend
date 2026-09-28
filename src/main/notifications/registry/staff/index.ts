/**
 * Staff and account events. The eight staff-action alerts all shipped under
 * `user_created`, so muting the welcome silenced the clinic's audit trail;
 * each has its own key now, as kind='activity'.
 */

import { defineEvents } from '../defineEvents';
import type { RecipientDeps } from '../types';

export interface StaffActionCtx extends Record<string, unknown> {
  clinicId: string;
  /** Who performed the action being recorded. Excluded from recipients. */
  performerUserId?: string | null;
  /** The complete sentence describing what happened. */
  detail: string;
  /**
   * The appointment the action was performed on, where there is one.
   *
   * Optional because not every staff action has one — a password change or a
   * profile edit belongs to no appointment. When it is present the entry opens
   * that appointment instead of the activity list, which is what the reader
   * wants next after "a refund of ₹45 for X's appointment".
   */
  appointmentId?: string | null;
}

export interface AccountCtx extends Record<string, unknown> {
  userId: string;
  userName?: string;
  userRole?: string;
}

export interface ClinicCreatedCtx extends Record<string, unknown> {
  clinicId: string;
  clinicName: string;
  performerUserId?: string | null;
  performerName?: string;
  performerRole?: string;
}

export interface DoctorProfileUpdateRequestedCtx extends Record<
  string,
  unknown
> {
  requestId: string;
  doctorId: string;
  doctorName: string;
  clinicId?: string | null;
  clinicName?: string | null;
}

async function clinicAdmins(
  ctx: StaffActionCtx,
  { directory }: RecipientDeps
): Promise<string[]> {
  const admins = await directory.getStaffByRole(ctx.clinicId, ['Admin']);
  return admins.map((a) => a.id).filter((id) => id !== ctx.performerUserId);
}

/** One activity entry per kind of staff action. Never collapsed — two
 *  discounts are two facts. */
function staffActivity(
  /** Kept for call-site readability; the click target no longer filters by it. */
  _key: string,
  label: string,
  description: string,
  title: string
) {
  return {
    label,
    description,
    category: 'staff' as const,
    priority: 'low' as const,
    kind: 'activity' as const,
    configurable: true,
    defaults: { inApp: true, push: false },
    channels: ['inApp' as const],
    tenant: (ctx: StaffActionCtx) => ({
      type: 'clinic' as const,
      id: ctx.clinicId,
    }),
    /**
     * Open the appointment the action was performed on when the caller passed
     * one. The previous destination was always '/notifications?tab=activity' —
     * the page the entry is already being read on, so clicking it went
     * nowhere; and the query string was never a route the client could
     * resolve, since route building only substitutes `:params`.
     */
    clickAction: (ctx: StaffActionCtx) =>
      ctx.appointmentId
        ? { route: '/appointment/:id', params: { id: ctx.appointmentId } }
        : // No appointment to open. Null would be cleaner than a self-link, but
          // clickAction is required by the contract, so this stays the inert
          // destination it already was for actions that own no record.
          { route: '/notifications' },
    audiences: [
      {
        key: 'admins',
        roles: ['Admin'],
        recipients: clinicAdmins,
        message: {
          // `detail` is the whole sentence, written at the call site where the
          // amounts and names are actually known. The registry supplies the
          // heading; it does not try to reassemble the fact from parts.
          inApp: (ctx: StaffActionCtx) => ({ title, body: ctx.detail }),
        },
      },
    ],
  };
}

export const staffEvents = defineEvents({
  // ── Activity: recorded for the admin, never interruptive ──────────────────
  'staff.discount_applied': staffActivity(
    'staff.discount_applied',
    'Discount Applied',
    'When a staff member applies a custom discount.',
    'Discount applied'
  ),
  'staff.refund_initiated': staffActivity(
    'staff.refund_initiated',
    'Refund Initiated',
    'When a staff member initiates a refund.',
    'Refund initiated'
  ),
  'staff.offline_payment_confirmed': staffActivity(
    'staff.offline_payment_confirmed',
    'Offline Payment Confirmed',
    'When a staff member confirms an offline payment.',
    'Offline payment confirmed'
  ),
  'staff.security_modified': staffActivity(
    'staff.security_modified',
    'Staff Security Modification',
    'When a staff member changes their password or security settings.',
    'Staff security modification'
  ),
  'staff.profile_updated': staffActivity(
    'staff.profile_updated',
    'Staff Profile Updated',
    'When a staff profile is edited.',
    'Staff profile updated'
  ),
  'staff.status_changed': staffActivity(
    'staff.status_changed',
    'Staff Status Changed',
    'When a staff member is activated or deactivated.',
    'Staff status changed'
  ),

  // ── Genuine notifications ─────────────────────────────────────────────────
  'account.welcome': {
    aliases: ['user_created'],
    label: 'User Account Created',
    description: 'When your account is created.',
    category: 'staff',
    priority: 'normal',
    kind: 'notification',
    configurable: true,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push'],
    // Account-level, not clinic-level: it follows the person, not a tenant.
    clickAction: () => ({ route: '/profile/my-notifications' }),
    audiences: [
      {
        key: 'self',
        roles: ['Admin', 'Doctor', 'Receptionist', 'Lab_Assistant', 'Patient'],
        recipients: (ctx: AccountCtx) => [ctx.userId],
        message: {
          // Patients get their own line; staff keep theirs, minus the raw role
          // value ("Your Lab_Assistant account…").
          inApp: (ctx: AccountCtx) => ({
            title: 'Welcome to Medisetu',
            body:
              ctx.userRole === 'Patient'
                ? 'Your account is ready. Book appointments and see your reports and prescriptions here.'
                : 'Your account is ready. Choose which notifications you want in Settings.',
          }),
        },
      },
    ],
  },

  'clinic.created': {
    aliases: ['clinic_created'],
    label: 'Clinic Created',
    description: 'When a new clinic is registered.',
    category: 'system',
    priority: 'normal',
    kind: 'notification',
    configurable: true,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push'],
    // No tenant: a platform-level event that belongs to no clinic. This is the
    // null/null case the tenant columns exist to allow.
    clickAction: (ctx: ClinicCreatedCtx) => ({
      route: '/clinics/:id',
      params: { id: ctx.clinicId },
    }),
    audiences: [
      {
        key: 'superadmins',
        roles: ['Super_Admin'],
        // Resolved by the platform, not by clinic membership — Super_Admins
        // belong to no clinic, so the staff-scope lookup cannot find them.
        recipients: async (ctx: ClinicCreatedCtx, { directory }) => {
          const admins = await directory.getSuperAdmins();
          return admins
            .map((a) => a.id)
            .filter((id) => id !== ctx.performerUserId);
        },
        message: {
          inApp: (ctx: ClinicCreatedCtx) => ({
            title: `New clinic – ${ctx.clinicName}`,
            body: `Registered by ${ctx.performerName ?? 'someone'}${
              ctx.performerRole ? ` (${ctx.performerRole})` : ''
            }.`,
          }),
        },
      },
    ],
  },

  'doctor.profile_update_requested': {
    aliases: ['doctor_profile_update_requested'],
    label: 'Doctor Profile Update Requested',
    description: 'When a doctor submits a profile change for approval.',
    category: 'staff',
    priority: 'action_required',
    kind: 'notification',
    configurable: true,
    defaults: { inApp: true, push: true },
    channels: ['inApp', 'push'],
    // Platform-level queue, like clinic.created: superadmins review it from
    // outside any clinic, so there is no tenant to scope this to.
    clickAction: () => ({ route: '/request' }),
    // One row per request: edits to a still-pending request should update the
    // existing unread item rather than stack a duplicate action item.
    collapseKey: (ctx: DoctorProfileUpdateRequestedCtx) =>
      `doctor-profile-update-request:${ctx.requestId}`,
    audiences: [
      {
        key: 'superadmins',
        roles: ['Super_Admin'],
        // Resolved by the platform, not by clinic membership — Super_Admins
        // belong to no clinic, so the staff-scope lookup cannot find them.
        recipients: async (
          _ctx: DoctorProfileUpdateRequestedCtx,
          { directory }
        ) => {
          const admins = await directory.getSuperAdmins();
          return admins.map((a) => a.id);
        },
        message: {
          inApp: (ctx: DoctorProfileUpdateRequestedCtx) => ({
            title: `Profile update requested – ${ctx.doctorName}`,
            body: `${ctx.doctorName} requested a profile change${
              ctx.clinicName ? ` at ${ctx.clinicName}` : ''
            }. Review it to approve or reject.`,
          }),
        },
      },
    ],
  },
});
