# Notification Events

<!-- GENERATED FILE — do not edit by hand.
     Run `npm run notifications:docs` after changing the registry. -->

21 events, generated from `src/main/notifications/registry`.

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
| `doctor.profile_update_requested` | staff | notification | action_required | **superadmins** (Super_Admin) | — | `/request` | yes |
| `lab.report_uploaded` | lab | notification | action_required | **doctor** (Doctor)<br>**lab** (Lab_Assistant)<br>**admins** (Admin)<br>**patient** (Patient) | —<br>lab_test:view<br>—<br>— | `/lab-tests`<br>`/lab/assigned`<br>`/lab-tests`<br>`/reports` | yes |
| `lab.test_assigned` | lab | notification | action_required | **lab** (Lab_Assistant, Doctor) | lab_test:view | `/lab/assigned` | yes |
| `lab.test_logged` | lab | notification | normal | **lab** (Lab_Assistant)<br>**doctors** (Doctor)<br>**admins** (Admin) | lab_test:view<br>—<br>— | `/lab/assigned`<br>`/lab-tests`<br>`/lab-tests` | yes |
| `payment.received` | payments | notification | normal | **staff** (Admin, Receptionist)<br>**patient** (Patient) | payment:manage<br>— | `/appointment/:id`<br>`/appointment/:id` | no |
| `prescription.ready` | prescription | notification | normal | **patient** (Patient) | — | `/appointment/:id` | yes |
| `staff.discount_applied` | staff | activity | low | **admins** (Admin) | — | `/appointment/:id` | yes |
| `staff.offline_payment_confirmed` | staff | activity | low | **admins** (Admin) | — | `/appointment/:id` | yes |
| `staff.profile_updated` | staff | activity | low | **admins** (Admin) | — | `/appointment/:id` | yes |
| `staff.refund_initiated` | staff | activity | low | **admins** (Admin) | — | `/appointment/:id` | yes |
| `staff.security_modified` | staff | activity | low | **admins** (Admin) | — | `/appointment/:id` | yes |
| `staff.status_changed` | staff | activity | low | **admins** (Admin) | — | `/appointment/:id` | yes |
| `subscription.expiring` | system | notification | action_required | **admin** (Admin) | — | `/subscription` | no |

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
- **Doctor Profile Update Requested** (`doctor.profile_update_requested`) — When a doctor submits a profile change for approval.
- **Test Report Uploaded** (`lab.report_uploaded`) — When a report PDF is uploaded.
- **Test Assigned to Lab** (`lab.test_assigned`) — When a new lab test is assigned.
- **Test Log Created** (`lab.test_logged`) — When a lab test is added for a patient.
- **Payment Received** (`payment.received`) — When an invoice is paid.
- **Prescription Ready** (`prescription.ready`) — When your prescription PDF is available.
- **Discount Applied** (`staff.discount_applied`) — When a staff member applies a custom discount.
- **Offline Payment Confirmed** (`staff.offline_payment_confirmed`) — When a staff member confirms an offline payment.
- **Staff Profile Updated** (`staff.profile_updated`) — When a staff profile is edited.
- **Refund Initiated** (`staff.refund_initiated`) — When a staff member initiates a refund.
- **Staff Security Modification** (`staff.security_modified`) — When a staff member changes their password or security settings.
- **Staff Status Changed** (`staff.status_changed`) — When a staff member is activated or deactivated.
- **Subscription Expiring** (`subscription.expiring`) — When your plan is close to expiry.
