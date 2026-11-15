# Super Admin Analytics API

Platform-wide business figures for the Infinity Medisetu Super Admin. Replaces the old
`/api/v1/dashboard/super-admin/*` endpoints (removed 2026-09-29).

- **Auth:** Bearer token, `Super_Admin` only (`requireAuth` + `requireSuperAdmin` on every route).
- **Data rule:** counts and money only. No patient names, contact details or clinical content.
- **Envelope:** `{ success, message, data }` via `sendOk`.
- **Module:** `src/main/superadminAnalytics` (formulas in `utils/metrics.utils.ts`). Other features are read only
  through `ports/`, implemented in `src/adapters/superadminAnalytics`.

## `GET /api/v1/superadmin-analytics/overview?from=YYYY-MM-DD&to=YYYY-MM-DD`

Both dates or neither (default: last 30 IST days). Max range 366 days. Cached 5 minutes.

| Field | Meaning |
|---|---|
| `kpis.mrr` / `mrrPrevious` | Monthly recurring subscription revenue at the period end / start. Yearly plans ÷ 12; trials, free plans and booking fees excluded |
| `kpis.paidClinics` / `paidClinicsPrevious` | Clinics with MRR > 0 at period end / start |
| `kpis.activePaidClinics` | Paying clinics whose stage is Active or Declining today |
| `kpis.newRegistrations` / `…Previous` | Clinics created in the period / the equal-length period before |
| `kpis.freeToPaid` | Of clinics reaching First Value in the period, how many were paying by its end |
| `kpis.trialToPaid` | Of trials started in the period, how many moved to a paid plan |
| `kpis.lostMrr` | Contraction + churned MRR in the period |
| `mrrBridge` | `opening + newMrr + expansion − contraction − churned = closing` (always exact) |
| `trend` | Jan → this month of the current year: `mrr`, `paidClinics` (at month end), `registrations`, `appointments` (non-cancelled, all clinics) |
| `funnel` | Clinics registered in the period → setup done → first value → active → paid |
| `stages` | Clinics per usage stage today |
| `attention` | Paying + dormant, declining, setup stuck (3+ days), no first value (7+ days) |

## `GET /api/v1/superadmin-analytics/revenue?from=&to=`

Same period rules and cache as `/overview`.

| Field | Meaning |
|---|---|
| `mrr` / `mrrPrevious`, `mrrBridge` | As in `/overview` |
| `arpc` | Closing MRR ÷ paying clinics at period end |
| `movement` | Clinic counts behind the bridge: `newPaid`, `upgrades`, `downgrades`, `churned` |
| `collected` | Money received: `subscriptions` (sum of `subscription_activity.amount`, excluding failures) + `bookingFees` (paid `payment_transactions.platform_commission`), with payment counts and `total` |
| `planMix` | Paying clinics and MRR per plan at period end, with % share of MRR |
| `failedPayments` | Up to 50 `payment_failed` events in the period, newest first, with clinic name and MED-ID |

## `GET /api/v1/superadmin-analytics/growth?from=&to=`

Cohort = clinics registered in the period. Same period rules and cache as `/overview`.

| Field | Meaning |
|---|---|
| `registrations` / `registrationsPrevious` | Cohort size / the equal-length period before |
| `funnel`, `setupRate`, `firstValueRate` | Cohort funnel and its setup / First Value % |
| `freeToPaid`, `trialToPaid` | As in `/overview` |
| `timeToFirstValue` | Median days registration → First Value, plus buckets (< 1, 1–3, 3–7, > 7 days, not yet) |
| `sources` | Per `acquisition_source`: registered, First Value, paying now, MRR now |

## `GET /api/v1/superadmin-analytics/clinics`

Query: `q` (name, MED-ID, phone or city; ranked), `status` (Active · Inactive · Blocked · Deleted),
`stage`, `billing` (Paid · Trial · Free), `source`, `city`, `state` (trimmed, case-insensitive exact match),
`pageNumber`, `pageSize` (≤ 500). The response also returns `locations: { cities, states }`, the distinct values for
the filter dropdowns.

Same clinic set as Clinic Management: approved clinics whose owner finished signup; soft-deleted clinics only under
`status=Deleted`. Returns `{ stats, items, pageNumber, pageSize, total }`; `stats` counts the whole set by account status.

## `GET /api/v1/superadmin-analytics/clinics/:clinicId`

One clinic's summary for Clinic 360°: identity (incl. `clinicCode`), stage, billing, plan, MRR, 30-day appointments
vs the previous 30, active days, last activity, first value, first paid date. 404 if the clinic doesn't exist.

## `GET /api/v1/superadmin-analytics/clinics/:clinicId/timeline`

One clinic's account history for Clinic 360° → Timeline: subscription events, plan periods and follow-up notes,
newest first, max 100. Counts only.

## `GET /api/v1/superadmin-analytics/usage?from=&to=`

Cached 5 min. KPIs: appointments (vs previous period), completed %, no-show %, new patients (first-ever
appointment in range), clinics with bookings, staff actions. Also `appointmentsByDay: { day, count, app }[]`
(`app` = `booking_source = 'mobile_app'`), `byStatus`, `bySource`, `topClinics` (top 5, cancelled excluded),
`staffByRole` (from the audit log).

## `GET /api/v1/superadmin-analytics/patient-app?from=&to=`

Cached 5 min. Distinct patients signed in on the app (`refresh_tokens` platform android/ios, unexpired),
push-enabled phones (`user_devices`), app bookings with share and `bookingsByDay: { day, app, all }[]`, top clinics.
DAU/MAU and app versions are not available (the app doesn't send them).

## `GET /api/v1/superadmin-analytics/audit`

`audit_log` across clinics. Query: `from`/`to` (both or neither; default last 30 days), `clinicId`, `type`
(action prefix, e.g. `appointment`), `role` (staff role), `pageNumber`, `pageSize` (≤ 100, default 25).
Rows carry the action label, clinic, staff name and role, entity id and IP. Written by the audit module in batches,
so an action can take up to 10 s to appear.

## `GET /api/v1/superadmin-analytics/sessions`

Who is signed in now: one row per staff user per platform from `refresh_tokens` (patients and Super Admins excluded).
Query: `q` (name/email), `platform` (`web` | `mobile` = anything not web), `activeOnly` (default `true`), paging (≤ 100).
Returns device (from the user agent), IP, signed-in and expiry times. Never tokens.

## `POST /api/v1/superadmin-analytics/sessions/:userId/sign-out`

Signs a clinic staff member out on every device: deletes their refresh tokens and sets the Redis cut-off
`user:password_changed_at:<id>` so existing access tokens stop working. 404 for patients, Super Admins or unknown ids.
Logged with the acting Super Admin's id.

## Definitions

| Term | Rule |
|---|---|
| Paid subscription | `clinic_subscriptions.payment_status` in (`success`, `paid`), price > 0, not a trial plan |
| First Value | First Completed appointment |
| Active | ≥ 5 non-cancelled appointments on ≥ 4 distinct days in the last 30 |
| Declining | Active, but appointments ≤ 50% of the previous 30 days |
| Dormant / Churned | No activity for 14+ / 60+ days, or the clinic is soft-deleted (Churned) |

## Follow-ups (UI name; "Action Center" in code and the `/action-center` route) — Step 8

Tables owned by the module: `followup_tasks`, `followup_notes` (`src/main/superadminAnalytics/models/followup.model.ts`).
Rules in `utils/followupRules.utils.ts`, run nightly at 02:30 IST (`cron/jobs/followupRules.cron.ts`) or on demand.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/superadmin-analytics/followups` | `status` (open·snoozed·resolved, default open), `type`, `priority`, `owner` (me·unassigned·uuid), `clinicId`, paging. Returns `items`, `counts`, `owners`. |
| POST | `/api/v1/superadmin-analytics/followups/run` | Runs the rules now. Idempotent. |
| GET | `/api/v1/superadmin-analytics/followups/:taskId` | Task + note history. |
| PATCH | `/api/v1/superadmin-analytics/followups/:taskId` | `{ action: assign·note·contacted·snooze·resolve·reopen, ... }` |

Rules (skip deleted, Rejected, Blocked): setup_stuck (≥3d, not set up) · no_first_value (≥7d, set up, no completed appointment) ·
usage_drop (Declining stage) · dormant (14d idle) · churn_risk (60d idle) · trial_ending (≤3d left, unpaid).
Paid clinics get high priority. A task auto-closes (`auto_cleared`) when its rule stops firing. Counts only, no patient data.
