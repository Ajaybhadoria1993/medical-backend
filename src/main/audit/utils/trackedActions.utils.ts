import type { TrackedAction } from '../types/auditLog.types';

/** The only routes the audit log records, keyed `METHOD /mount/path`.
 *  Adding one line here starts tracking that action; no migration needed. */
export const TRACKED_ACTIONS: Record<string, TrackedAction> = {
  // Super Admin billing tools (the reason is on the clinic's billing timeline)
  'POST /api/v2/subscription/billing-checks/clinic/:clinicId/payments/:paymentId/refund':
    {
      action: 'subscription.refunded',
      label: 'Refunded a clinic payment',
      idParam: 'clinicId',
    },
  'POST /api/v2/subscription/billing-checks/clinic/:clinicId/extend': {
    action: 'subscription.plan_extended',
    label: "Extended a clinic's plan",
    idParam: 'clinicId',
  },
  'POST /api/v2/subscription/billing-checks/clinic/:clinicId/autopay/cancel': {
    action: 'subscription.autopay_cancelled',
    label: "Turned off a clinic's AutoPay",
    idParam: 'clinicId',
  },
  'POST /api/v2/subscription/billing-checks/clinic/:clinicId/invoices/:invoiceId/resend':
    {
      action: 'subscription.invoice_resent',
      label: 'Resent a clinic invoice',
      idParam: 'clinicId',
    },
  'POST /api/v2/subscription/billing-checks/:id/resolve': {
    action: 'subscription.difference_resolved',
    label: 'Resolved a Razorpay difference',
    idParam: 'id',
  },

  'POST /api/v2/subscription/tax-rates': {
    action: 'subscription.gst_changed',
    label: 'Changed the GST setting',
  },
  'DELETE /api/v2/subscription/tax-rates/:id': {
    action: 'subscription.gst_change_undone',
    label: 'Undid a scheduled GST change',
    idParam: 'id',
  },

  // Appointments
  'POST /api/v1/appointments': {
    action: 'appointment.booked',
    label: 'Booked appointment',
  },
  'POST /api/v1/appointments/custom': {
    action: 'appointment.booked_custom',
    label: 'Booked appointment outside schedule',
  },
  'POST /api/v1/appointments/:appointmentId/cancel': {
    action: 'appointment.cancelled',
    label: 'Cancelled appointment',
    idParam: 'appointmentId',
  },
  // The web app cancels through the policy route (refund rules apply there).
  'POST /api/v1/cancellation-policy/appointment/:appointmentId/cancel': {
    action: 'appointment.cancelled',
    label: 'Cancelled appointment',
    idParam: 'appointmentId',
  },
  'POST /api/v1/appointments/:appointmentId/no-show': {
    action: 'appointment.no_show',
    label: 'Marked no-show',
    idParam: 'appointmentId',
  },
  'POST /api/v1/appointments/multiple-service/:appointmentId': {
    action: 'appointment.services_added',
    label: 'Added services to visit',
    idParam: 'appointmentId',
  },

  // Staff & access
  'POST /api/v1/users/adduser': {
    action: 'staff.added',
    label: 'Added staff member',
  },
  'PATCH /api/v1/users/:userId': {
    action: 'staff.updated',
    label: 'Edited staff profile',
    idParam: 'userId',
  },
  'POST /api/v1/users/change-password': {
    action: 'account.password_changed',
    label: 'Changed password',
  },
  'POST /api/v1/mfa/verify-enrollment': {
    action: 'account.mfa_enabled',
    label: 'Turned on 2-step login',
  },
  'PUT /api/v1/permissions/users/:userId': {
    action: 'staff.permissions_changed',
    label: 'Changed staff permissions',
    idParam: 'userId',
  },
  'PUT /api/v1/permissions/users/:userId/assignment': {
    action: 'staff.assignment_changed',
    label: 'Changed staff assignment',
    idParam: 'userId',
  },
  'PUT /api/v1/users/update-admin-permission-to-doctor': {
    action: 'staff.admin_access_changed',
    label: "Changed doctor's admin access",
  },
  'POST /api/v1/mfa/regenerate-recovery': {
    action: 'account.recovery_regenerated',
    label: 'Regenerated recovery codes',
  },
  'POST /api/v1/mfa/disable': {
    action: 'account.mfa_disabled',
    label: 'Turned off 2-step login',
  },
  'POST /api/v1/users/login': { action: 'account.login', label: 'Logged in' },
  'POST /api/v1/users/social-login': {
    action: 'account.login',
    label: 'Logged in',
  },
  'POST /api/v1/mfa/verify-login': {
    action: 'account.login',
    label: 'Logged in',
  },
  'POST /api/v1/mfa/recovery-login': {
    action: 'account.login',
    label: 'Logged in',
  },

  // Subscription: paid purchases log at verify, when payment is confirmed
  'POST /api/v1/subscription/verify-subscription': {
    action: 'subscription.purchased',
    label: 'Bought plan',
  },
  'POST /api/v1/subscription/addons/verify-purchase': {
    action: 'subscription.addon_purchased',
    label: 'Bought add-on',
  },
  'POST /api/v1/subscription/subscribe-autopay': {
    action: 'subscription.autopay_enabled',
    label: 'Turned on AutoPay',
  },
  'PUT /api/v1/subscription/schedule-cancel': {
    action: 'subscription.cancel_scheduled',
    label: 'Scheduled plan cancellation',
  },
  'PUT /api/v1/subscription/undo-cancel': {
    action: 'subscription.cancel_undone',
    label: 'Undid plan cancellation',
  },
  'PUT /api/v1/subscription/addons/schedule-cancel/:clinicAddOnId': {
    action: 'subscription.addon_cancel_scheduled',
    label: 'Scheduled add-on removal',
    idParam: 'clinicAddOnId',
  },

  // Patient records
  'POST /api/v1/patient': { action: 'patient.added', label: 'Added patient' },
  'PUT /api/v1/patient': {
    action: 'patient.updated',
    label: 'Edited patient',
    idParam: 'peteintId',
  },

  // Treatment plans (accept / think / decline; the plan's own history says which)
  'POST /api/v1/treatment-plan/:planId/decision': {
    action: 'treatment_plan.decision',
    label: 'Recorded treatment plan decision',
    idParam: 'planId',
  },
  'POST /api/v1/treatment-plan': {
    action: 'treatment_plan.created',
    label: 'Proposed a treatment plan',
  },
  'POST /api/v1/treatment-plan/:planId/payments': {
    action: 'treatment_plan.payment',
    label: 'Collected treatment plan payment',
    idParam: 'planId',
  },
  'POST /api/v1/treatment-plan/:planId/refunds': {
    action: 'treatment_plan.refund',
    label: 'Refunded treatment plan money',
    idParam: 'planId',
  },
  'POST /api/v1/treatment-plan/:planId/write-offs': {
    action: 'treatment_plan.write_off',
    label: 'Wrote off treatment plan balance',
    idParam: 'planId',
  },
  'POST /api/v1/treatment-plan/:planId/discount': {
    action: 'treatment_plan.discount',
    label: 'Discounted a treatment plan',
    idParam: 'planId',
  },
  'POST /api/v1/treatment-plan/:planId/pause': {
    action: 'treatment_plan.pause',
    label: 'Paused a treatment plan',
    idParam: 'planId',
  },
  'POST /api/v1/treatment-plan/:planId/resume': {
    action: 'treatment_plan.resume',
    label: 'Resumed a treatment plan',
    idParam: 'planId',
  },
  'POST /api/v1/treatment-plan/:planId/end': {
    action: 'treatment_plan.end_early',
    label: 'Ended a treatment plan early',
    idParam: 'planId',
  },
  'POST /api/v1/treatment-plan/:planId/extend': {
    action: 'treatment_plan.extend',
    label: 'Extended a treatment package',
    idParam: 'planId',
  },

  // Medical records
  'POST /api/v1/reports/card': {
    action: 'record.prescription_written',
    label: 'Wrote prescription',
  },
  'PUT /api/v1/reports/card/update': {
    action: 'record.prescription_edited',
    label: 'Edited prescription',
    idParam: 'reportCardId',
  },
  'POST /api/v1/appointments/update-doctor-manual-prescription/:appointmentId':
    {
      action: 'record.prescription_uploaded',
      label: 'Uploaded handwritten prescription',
      idParam: 'appointmentId',
    },
  'POST /api/v1/reports': {
    action: 'record.report_added',
    label: 'Added diagnostic report',
  },
  'PUT /api/v1/reports/:reportId': {
    action: 'record.report_edited',
    label: 'Edited diagnostic report',
    idParam: 'reportId',
  },
  'POST /api/v1/appointments/medical-certificate/:appointmentId': {
    action: 'record.certificate_saved',
    label: 'Saved medical certificate',
    idParam: 'appointmentId',
  },
  'PUT /api/v1/appointments/consent/:appointmentId': {
    action: 'record.consent_uploaded',
    label: 'Uploaded signed consent form',
    idParam: 'appointmentId',
  },
  'POST /api/v1/lab/results/:resultId/report-upload': {
    action: 'record.lab_report_uploaded',
    label: 'Uploaded lab report',
    idParam: 'resultId',
  },

  // Clinic setup
  'PUT /api/v1/clinic': {
    action: 'clinic.profile_edited',
    label: 'Edited clinic profile',
  },
  'PUT /api/v1/settings': {
    action: 'clinic.settings_changed',
    label: 'Changed clinic settings',
  },
  'POST /api/v1/appointments/slot-config': {
    action: 'clinic.slots_changed',
    label: 'Changed slots for a date',
  },
  'POST /api/v1/appointments/extra-slots': {
    action: 'clinic.extra_slots_changed',
    label: 'Changed extra slots',
  },
  'PATCH /api/v1/clinic/doctors/:doctorId/consultation-duration': {
    action: 'clinic.duration_changed',
    label: 'Changed consultation duration',
    idParam: 'doctorId',
  },
  'PUT /api/v1/doctor/update-service/:serviceId': {
    action: 'clinic.service_edited',
    label: 'Edited service',
    idParam: 'serviceId',
  },
  'PATCH /api/v1/doctor/toggle-service/:serviceId': {
    action: 'clinic.service_toggled',
    label: 'Turned service on/off',
    idParam: 'serviceId',
  },
  'DELETE /api/v1/doctor/delete-service/:serviceId': {
    action: 'clinic.service_deleted',
    label: 'Deleted service',
    idParam: 'serviceId',
  },
  // App versions: a wrong minimum can force-block every app user, so record who changed it.
  'POST /api/v1/app-update': {
    action: 'app_update.created',
    label: 'Added app version settings',
    idParam: 'app_name',
  },
  'PUT /api/v1/app-update': {
    action: 'app_update.changed',
    label: 'Changed app version settings',
    idParam: 'app_name',
  },
};

/** Outcomes a controller reports via `res.locals.auditAction` when its route alone
 *  can't say what happened (e.g. /subscribe activates free plans but only starts paid ones). */
export const REPORTED_ACTIONS: Record<string, TrackedAction> = {
  'subscription.activated_free': {
    action: 'subscription.activated_free',
    label: 'Activated plan (nothing to pay)',
  },
};

const LABELS = new Map(
  [...Object.values(TRACKED_ACTIONS), ...Object.values(REPORTED_ACTIONS)].map(
    (t) => [t.action, t.label]
  )
);

export function findTrackedAction(
  method: string,
  routePath: string
): TrackedAction | undefined {
  const path = routePath.length > 1 ? routePath.replace(/\/$/, '') : routePath;
  return TRACKED_ACTIONS[`${method} ${path}`];
}

/** An action dropped from the list still renders, as its raw key. */
export function auditActionLabel(action: string): string {
  return LABELS.get(action) ?? action;
}
