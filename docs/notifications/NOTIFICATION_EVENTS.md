# Notification Events

<!-- GENERATED FILE — do not edit by hand.
     Run `npm run notifications:docs` after changing the registry. -->

50 events, generated from `src/main/notifications/registry`.

| Event | Category | Type | Priority | Who receives it | Permission | Opens | Mutable |
|---|---|---|---|---|---|---|---|
| `account.welcome` | staff | notification | normal | **self** (Admin, Doctor, Receptionist, Lab_Assistant, Patient) | — | `/profile/my-notifications` | yes |
| `appointment.cancelled` | appointments | notification | action_required | **staff** (Admin, Doctor, Receptionist)<br>**patient** (Patient) | appointment:view<br>— | `/appointment/:id`<br>`/appointment/:id` | no |
| `appointment.confirmed` | appointments | notification | normal | **staff** (Admin, Doctor)<br>**patient** (Patient) | appointment:view<br>— | `/appointment/:id`<br>`/appointment/:id` | yes |
| `appointment.created` | appointments | notification | normal | **staff** (Admin, Doctor, Receptionist)<br>**patient** (Patient) | appointment:view<br>— | `/appointment/:id`<br>`/appointment/:id` | yes |
| `appointment.no_show` | appointments | notification | action_required | **staff** (Admin, Doctor, Receptionist) | appointment:view | `/appointment/:id` | no |
| `appointment.rescheduled` | appointments | notification | action_required | **staff** (Admin, Doctor)<br>**patient** (Patient) | appointment:view<br>— | `/appointment/:id`<br>`/appointment/:id` | yes |
| `clinic.created` | system | notification | normal | **superadmins** (Super_Admin) | — | `/clinics/:id` | yes |
| `consultation.completed` | appointments | notification | normal | **staff** (Admin, Receptionist) | appointment:view | `/appointment/:id` | yes |
| `credits.expiring` | system | notification | normal | **admin** (Admin) | — | `/settings/notifications` | no |
| `credits.usage_paused` | system | notification | action_required | **admin** (Admin) | — | `/settings/notifications` | no |
| `credits.usage_warning` | system | notification | normal | **admin** (Admin) | — | `/settings/notifications` | no |
| `doctor.profile_update_requested` | staff | notification | action_required | **superadmins** (Super_Admin) | — | `/request` | yes |
| `lab.report_uploaded` | lab | notification | action_required | **doctor** (Doctor)<br>**lab** (Lab_Assistant)<br>**admins** (Admin)<br>**patient** (Patient) | —<br>lab_test:view<br>—<br>— | `/lab-tests`<br>`/lab/assigned`<br>`/lab-tests`<br>`/reports` | yes |
| `lab.test_assigned` | lab | notification | action_required | **lab** (Lab_Assistant, Doctor) | lab_test:view | `/lab/assigned` | yes |
| `lab.test_logged` | lab | notification | normal | **lab** (Lab_Assistant)<br>**doctors** (Doctor)<br>**admins** (Admin) | lab_test:view<br>—<br>— | `/lab/assigned`<br>`/lab-tests`<br>`/lab-tests` | yes |
| `payment.payout_action_needed` | payments | notification | action_required | **admins** (Admin)<br>**superadmins** (Super_Admin) | —<br>— | `/link-clinic-account`<br>`/link-clinic-account` | no |
| `payment.payouts_ready` | payments | notification | normal | **admins** (Admin) | — | `/finance?tab=payouts` | no |
| `payment.received` | payments | notification | normal | **staff** (Admin, Receptionist)<br>**patient** (Patient) | payment:manage<br>— | `/appointment/:id`<br>`/appointment/:id` | no |
| `payment.transfer_failed` | payments | notification | action_required | **admins** (Admin)<br>**superadmins** (Super_Admin) | —<br>— | `/finance?tab=payouts`<br>`/finance?tab=payouts` | no |
| `platform.billing_alert` | payments | notification | action_required | **superadmins** (Super_Admin) | — | `/business/revenue` | no |
| `platform.message` | system | notification | normal | **owner** (Admin) | — | `/dashboard` | no |
| `platform.webhook_stuck` | payments | notification | action_required | **superadmins** (Super_Admin) | — | `/business/revenue?tab=checks` | no |
| `prescription.ready` | prescription | notification | normal | **patient** (Patient) | — | `/appointment/:id` | yes |
| `staff.discount_applied` | staff | activity | low | **admins** (Admin) | — | `/appointment/:id` | yes |
| `staff.offline_payment_confirmed` | staff | activity | low | **admins** (Admin) | — | `/appointment/:id` | yes |
| `staff.profile_updated` | staff | activity | low | **admins** (Admin) | — | `/appointment/:id` | yes |
| `staff.refund_initiated` | staff | activity | low | **admins** (Admin) | — | `/appointment/:id` | yes |
| `staff.security_modified` | staff | activity | low | **admins** (Admin) | — | `/appointment/:id` | yes |
| `staff.status_changed` | staff | activity | low | **admins** (Admin) | — | `/appointment/:id` | yes |
| `subscription.addon_receipt` | payments | notification | normal | **owner** (Admin) | — | `/subscription` | no |
| `subscription.addon_reduction_scheduled` | payments | notification | normal | **owner** (Admin) | — | `/subscription` | no |
| `subscription.addon_removal_scheduled` | payments | notification | normal | **owner** (Admin) | — | `/subscription` | no |
| `subscription.autopay_changed` | payments | notification | normal | **owner** (Admin) | — | `/subscription` | no |
| `subscription.change_applied` | payments | notification | normal | **owner** (Admin) | — | `/subscription` | no |
| `subscription.change_scheduled` | payments | notification | normal | **owner** (Admin) | — | `/subscription` | no |
| `subscription.change_undone` | payments | notification | normal | **owner** (Admin) | — | `/subscription` | no |
| `subscription.expired` | payments | notification | action_required | **owner** (Admin) | — | `/subscription` | no |
| `subscription.expiring` | system | notification | action_required | **admin** (Admin) | — | `/subscription` | no |
| `subscription.payment_failed` | payments | notification | action_required | **owner** (Admin) | — | `/subscription` | no |
| `subscription.payment_receipt` | payments | notification | normal | **owner** (Admin) | — | `/subscription` | no |
| `subscription.plan_ending` | payments | notification | normal | **owner** (Admin) | — | `/subscription` | no |
| `subscription.plan_extended` | payments | notification | normal | **owner** (Admin) | — | `/subscription` | no |
| `subscription.price_change` | payments | notification | normal | **owner** (Admin) | — | `/subscription` | no |
| `subscription.refund_issued` | payments | notification | normal | **owner** (Admin) | — | `/subscription` | no |
| `subscription.renewal_reminder` | payments | notification | action_required | **owner** (Admin) | — | `/subscription` | no |
| `subscription.staff_access_ending` | staff | notification | action_required | **staff** (Doctor, Receptionist, Pharmacist) | — | `/dashboard` | no |
| `subscription.staff_access_kept` | staff | notification | action_required | **staff** (Doctor, Receptionist, Pharmacist) | — | `/dashboard` | no |
| `subscription.staff_access_scheduled` | staff | notification | action_required | **staff** (Doctor, Receptionist, Pharmacist) | — | `/dashboard` | no |
| `subscription.trial_ending` | payments | notification | action_required | **owner** (Admin) | — | `/subscription` | no |
| `subscription.trial_started` | payments | notification | normal | **owner** (Admin) | — | `/subscription` | no |

## Aliases

Preference keys these events were known by before the rebuild. Saved user
preferences are stored under the old names, so these keep resolving.

| Event | Aliases |
|---|---|
| `account.welcome` | `user_created` |
| `appointment.cancelled` | `appointment_canceled` |
| `appointment.confirmed` | `appointment_confirmed` |
| `appointment.created` | `appointment_created` |
| `appointment.no_show` | `appointment_no_show` |
| `appointment.rescheduled` | `appointment_rescheduled`, `rescheduled` |
| `clinic.created` | `clinic_created` |
| `doctor.profile_update_requested` | `doctor_profile_update_requested` |
| `lab.report_uploaded` | `test_report_uploaded` |
| `lab.test_assigned` | `test_assigned_to_lab` |
| `lab.test_logged` | `test_log_created` |
| `payment.received` | `payment_received` |
| `prescription.ready` | `pdf_ready`, `prescription_pdf_ready` |
| `subscription.expiring` | `subscription-renewal` |

## Descriptions

- **User Account Created** (`account.welcome`) — When your account is created.
- **Appointment Canceled** (`appointment.cancelled`) — When an appointment is canceled.
- **Appointment Confirmed** (`appointment.confirmed`) — When an appointment is confirmed.
- **Appointment Created** (`appointment.created`) — When a new appointment is booked.
- **Appointment No-Show** (`appointment.no_show`) — When a patient doesn't show up.
- **Appointment Rescheduled** (`appointment.rescheduled`) — When an appointment time is updated.
- **Clinic Created** (`clinic.created`) — When a new clinic is registered.
- **Consultation Completed** (`consultation.completed`) — When a doctor finishes a consultation.
- **WhatsApp credits expiring** (`credits.expiring`) — When WhatsApp credits are about to expire unused.
- **WhatsApp messages paused** (`credits.usage_paused`) — When this month’s free WhatsApp messages are used up.
- **WhatsApp messages running low** (`credits.usage_warning`) — When most of this month’s free WhatsApp messages are used.
- **Doctor Profile Update Requested** (`doctor.profile_update_requested`) — When a doctor submits a profile change for approval.
- **Test Report Uploaded** (`lab.report_uploaded`) — When a report PDF is uploaded.
- **Test Assigned to Lab** (`lab.test_assigned`) — When a new lab test is assigned.
- **Test Log Created** (`lab.test_logged`) — When a lab test is added for a patient.
- **Payout Account Needs A Change** (`payment.payout_action_needed`) — When Razorpay needs a change, rejects, pauses or locks the payout account.
- **Payouts Ready** (`payment.payouts_ready`) — When Razorpay finishes checking the payout account.
- **Payment Received** (`payment.received`) — When an invoice is paid.
- **Payout Failed** (`payment.transfer_failed`) — When money from an online payment does not reach the clinic bank.
- **Billing needs a look** (`platform.billing_alert`) — When the daily check finds Razorpay differences, a quiet webhook or many failed AutoPay charges.
- **Message from MediArogya** (`platform.message`) — When the MediArogya team sends you a message.
- **Razorpay event stuck** (`platform.webhook_stuck`) — When a Razorpay event could not be applied after every retry.
- **Prescription Ready** (`prescription.ready`) — When your prescription PDF is available.
- **Discount Applied** (`staff.discount_applied`) — When a staff member applies a custom discount.
- **Offline Payment Confirmed** (`staff.offline_payment_confirmed`) — When a staff member confirms an offline payment.
- **Staff Profile Updated** (`staff.profile_updated`) — When a staff profile is edited.
- **Refund Initiated** (`staff.refund_initiated`) — When a staff member initiates a refund.
- **Staff Security Modification** (`staff.security_modified`) — When a staff member changes their password or security settings.
- **Staff Status Changed** (`staff.status_changed`) — When a staff member is activated or deactivated.
- **Add-on receipt** (`subscription.addon_receipt`) — An add-on was paid; the GST invoice is attached.
- **Add-on reduction scheduled** (`subscription.addon_reduction_scheduled`) — An add-on goes down at the period end.
- **Add-on removal scheduled** (`subscription.addon_removal_scheduled`) — An add-on ends at the period end.
- **AutoPay turned on or off** (`subscription.autopay_changed`) — AutoPay was approved, or turned off by the clinic, the Medisetu team or the bank.
- **Scheduled changes applied** (`subscription.change_applied`) — Scheduled add-on changes took effect at renewal.
- **Plan change scheduled** (`subscription.change_scheduled`) — A downgrade or cycle change was scheduled for the period end.
- **Scheduled change undone** (`subscription.change_undone`) — A scheduled plan change was withdrawn.
- **Plan ended** (`subscription.expired`) — The plan ended and the clinic moved to the Free plan.
- **Subscription Expiring** (`subscription.expiring`) — When your plan is close to expiry.
- **Payment failed** (`subscription.payment_failed`) — A payment did not go through, or the payment window was closed.
- **Payment receipt** (`subscription.payment_receipt`) — A plan purchase, renewal or change was paid; the GST invoice is attached.
- **Plan ending** (`subscription.plan_ending`) — A Super Admin ended the plan; the clinic renews on the replacement after the end date.
- **Plan extended** (`subscription.plan_extended`) — The Medisetu team added days to the plan at no charge.
- **Price change at renewal** (`subscription.price_change`) — A new plan version raises the price at the next renewal.
- **Refund issued** (`subscription.refund_issued`) — A payment was refunded; the credit note is attached.
- **Renewal reminder** (`subscription.renewal_reminder`) — 7, 3 and 1 days before a plan renews, and on the first and last grace day if it is unpaid.
- **Your access ends soon** (`subscription.staff_access_ending`) — 3 days before the account is switched off.
- **Your access continues** (`subscription.staff_access_kept`) — The scheduled change was withdrawn, so this account stays on.
- **Your access is changing** (`subscription.staff_access_scheduled`) — The clinic scheduled a plan or add-on change that switches off this account.
- **Free trial ending** (`subscription.trial_ending`) — 3 days and 1 day before the trial ends.
- **Free trial started** (`subscription.trial_started`) — The clinic started its free trial.
